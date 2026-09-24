import { accessSync, chmodSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { app } from "electron";
import { type IPty, spawn } from "node-pty";

/** Upper bound on live shells, so a runaway renderer cannot fork the machine. */
const MAX_SESSIONS = 8;
/** Coalescing window for PTY output; a chatty program must not flood IPC. */
const OUTPUT_FLUSH_MS = 16;
/** Per-session buffered output ceiling while coalescing. */
const MAX_PENDING_CHARS = 256 * 1024;

/** A GUI-launched macOS app inherits a bare PATH, so shells need the usual bins. */
const DARWIN_PATH_FALLBACK = [
	"/opt/homebrew/bin",
	"/opt/homebrew/sbin",
	"/usr/local/bin",
	"/usr/local/sbin",
	"/usr/bin",
	"/bin",
	"/usr/sbin",
	"/sbin",
];

export interface TerminalSessionInfo {
	id: string;
	shell: string;
	cwd: string;
}

export interface TerminalServiceListeners {
	onData: (sessionId: string, data: string) => void;
	onExit: (sessionId: string, exitCode: number) => void;
}

interface LiveSession {
	pty: IPty;
	pending: string;
	flushTimer: NodeJS.Timeout | undefined;
	disposed: boolean;
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** Resolves a bare command name across PATH without spawning a probe. */
function findOnPath(command: string): string | undefined {
	const pathValue = process.env.PATH;
	if (!pathValue) return undefined;
	for (const directory of pathValue.split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, command);
		if (isExecutable(candidate)) return candidate;
	}
	return undefined;
}

/**
 * First candidate that is actually runnable wins: an unusable `$SHELL` must fall
 * back rather than leave the panel permanently empty.
 */
function resolveShell(): string {
	const candidates =
		process.platform === "win32"
			? [process.env.ComSpec, "pwsh.exe", "powershell.exe", "cmd.exe"]
			: [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const resolved = candidate.includes("/") || candidate.includes("\\") ? candidate : findOnPath(candidate);
		if (resolved && isExecutable(resolved)) return resolved;
	}
	throw new Error("未找到可用的 shell。");
}

function buildEnvironment(): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) environment[key] = value;
	}
	environment.TERM = "xterm-256color";
	if (!environment.COLORTERM) environment.COLORTERM = "truecolor";
	if (process.platform === "darwin") {
		const entries = (environment.PATH ?? "").split(delimiter).filter(Boolean);
		for (const candidate of DARWIN_PATH_FALLBACK) {
			if (!entries.includes(candidate)) entries.push(candidate);
		}
		environment.PATH = entries.join(delimiter);
	}
	const locale = environment.LC_ALL ?? environment.LC_CTYPE ?? environment.LANG;
	if (!locale || locale === "C" || locale === "POSIX") {
		const fallback = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
		environment.LANG = fallback;
		environment.LC_CTYPE = environment.LC_CTYPE ?? fallback;
	}
	return environment;
}

/**
 * node-pty ships its macOS `spawn-helper` without the executable bit, and a
 * packaged app additionally has to reach it through the unpacked asar directory.
 * Re-applying the mode here is what keeps `posix_spawnp` from failing.
 */
function ensureSpawnHelper(): void {
	if (process.platform === "win32") return;
	try {
		const require = createRequire(import.meta.url);
		const unixTerminalPath = require.resolve("node-pty/lib/unixTerminal.js");
		const helperPath = join(dirname(unixTerminalPath), "../build/Release/spawn-helper").replace(
			/\.asar([/\\])/u,
			".asar.unpacked$1",
		);
		const candidates = [
			helperPath,
			join(dirname(unixTerminalPath), "../prebuilds", `darwin-${process.arch}`, "spawn-helper"),
		];
		for (const candidate of candidates) {
			const resolved = candidate.replace(/\.asar([/\\])/u, ".asar.unpacked$1");
			if (!existsSync(resolved)) continue;
			if ((statSync(resolved).mode & 0o111) !== 0o111) chmodSync(resolved, 0o755);
			return;
		}
	} catch (error) {
		console.error("Failed to prepare the PTY spawn helper", error);
	}
}

/**
 * Owns the PTY processes behind the integrated terminal. Sessions are keyed per
 * renderer request, and every one of them is killed when the app quits.
 */
export class TerminalService {
	private readonly listeners: TerminalServiceListeners;
	private readonly sessions = new Map<string, LiveSession>();
	private nextId = 1;

	constructor(listeners: TerminalServiceListeners) {
		this.listeners = listeners;
	}

	create(cwd: string, cols: number, rows: number): TerminalSessionInfo {
		if (this.sessions.size >= MAX_SESSIONS) {
			throw new Error(`最多同时打开 ${MAX_SESSIONS} 个终端。`);
		}
		const workingDirectory = this.resolveCwd(cwd);
		const shell = resolveShell();
		ensureSpawnHelper();
		const id = `terminal-${this.nextId++}`;
		const pty = spawn(shell, [], {
			name: "xterm-256color",
			cols,
			rows,
			cwd: workingDirectory,
			env: buildEnvironment(),
			encoding: "utf8",
		});
		const session: LiveSession = { pty, pending: "", flushTimer: undefined, disposed: false };
		this.sessions.set(id, session);
		pty.onData((data) => this.queueOutput(id, session, data));
		pty.onExit(({ exitCode }) => {
			this.flush(id, session);
			this.sessions.delete(id);
			if (!session.disposed) this.listeners.onExit(id, exitCode);
		});
		return { id, shell, cwd: workingDirectory };
	}

	write(sessionId: string, data: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.pty.write(data);
	}

	resize(sessionId: string, cols: number, rows: number): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		try {
			session.pty.resize(cols, rows);
		} catch {
			// A shell that exited mid-resize is not an error worth surfacing.
		}
	}

	dispose(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.disposed = true;
		this.sessions.delete(sessionId);
		if (session.flushTimer) clearTimeout(session.flushTimer);
		try {
			session.pty.kill();
		} catch {
			// Already gone.
		}
	}

	disposeAll(): void {
		for (const sessionId of [...this.sessions.keys()]) this.dispose(sessionId);
	}

	private resolveCwd(cwd: string): string {
		if (cwd && statSync(cwd).isDirectory()) return resolve(cwd);
		const fallback = process.env.HOME ?? app.getPath("home");
		if (fallback && statSync(fallback).isDirectory()) return fallback;
		throw new Error("终端无法确定工作目录。");
	}

	/**
	 * Coalesces PTY output inside a short window. A single chatty command can emit
	 * thousands of chunks per second, and one IPC message per chunk starves the
	 * renderer; batching keeps the panel responsive without adding visible latency.
	 */
	private queueOutput(sessionId: string, session: LiveSession, data: string): void {
		session.pending += data;
		if (session.pending.length > MAX_PENDING_CHARS) {
			this.flush(sessionId, session);
			return;
		}
		if (session.flushTimer) return;
		session.flushTimer = setTimeout(() => this.flush(sessionId, session), OUTPUT_FLUSH_MS);
	}

	private flush(sessionId: string, session: LiveSession): void {
		if (session.flushTimer) {
			clearTimeout(session.flushTimer);
			session.flushTimer = undefined;
		}
		if (!session.pending) return;
		const data = session.pending;
		session.pending = "";
		this.listeners.onData(sessionId, data);
	}
}
