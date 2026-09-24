import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { app, type NativeImage, shell } from "electron";

const execFileAsync = promisify(execFile);

export type OpenWithKind = "editor" | "fileManager" | "terminal";

/**
 * One entry in the "open with" catalog. The renderer shows these in order, so the
 * layout here is the menu layout.
 */
interface AppDefinition {
	id: string;
	name: string;
	kind: OpenWithKind;
	/** macOS application bundle, opened through `open -a`. */
	bundle?: string;
	/** CLI on PATH; used instead of the bundle when it is installed. */
	command?: string;
}

export interface OpenWithApp {
	id: string;
	name: string;
	kind: OpenWithKind;
	/** Real application icon, resolved in the main process. */
	iconDataUrl?: string;
}

/**
 * macOS catalog. File managers come first because that is the pinning the
 * reference app uses, and the rest keep that app's preference order.
 */
const MAC_APPS: readonly AppDefinition[] = [
	{
		id: "finder",
		name: "Finder",
		kind: "fileManager",
		bundle: "/System/Library/CoreServices/Finder.app",
	},
	{ id: "vscode", name: "Visual Studio Code", kind: "editor", bundle: "Visual Studio Code.app", command: "code" },
	{ id: "cursor", name: "Cursor", kind: "editor", bundle: "Cursor.app", command: "cursor" },
	{ id: "zed", name: "Zed", kind: "editor", bundle: "Zed.app", command: "zed" },
	{ id: "windsurf", name: "Windsurf", kind: "editor", bundle: "Windsurf.app", command: "windsurf" },
	{ id: "sublime", name: "Sublime Text", kind: "editor", bundle: "Sublime Text.app", command: "subl" },
	{ id: "terminal", name: "Terminal", kind: "terminal", bundle: "/System/Applications/Utilities/Terminal.app" },
	{ id: "iterm", name: "iTerm", kind: "terminal", bundle: "iTerm.app" },
	{ id: "ghostty", name: "Ghostty", kind: "terminal", bundle: "Ghostty.app" },
	{ id: "warp", name: "Warp", kind: "terminal", bundle: "Warp.app" },
];

const WINDOWS_APPS: readonly AppDefinition[] = [
	{
		id: "explorer",
		name: "资源管理器",
		kind: "fileManager",
		bundle: join(process.env.WINDIR ?? "C:\\Windows", "explorer.exe"),
	},
	{ id: "vscode", name: "Visual Studio Code", kind: "editor", command: "code.cmd" },
	{ id: "cursor", name: "Cursor", kind: "editor", command: "cursor.cmd" },
	{ id: "zed", name: "Zed", kind: "editor", command: "zed.exe" },
];

const LINUX_APPS: readonly AppDefinition[] = [
	{ id: "fileManager", name: "文件管理器", kind: "fileManager", command: "xdg-open" },
	{ id: "vscode", name: "Visual Studio Code", kind: "editor", command: "code" },
	{ id: "cursor", name: "Cursor", kind: "editor", command: "cursor" },
	{ id: "zed", name: "Zed", kind: "editor", command: "zed" },
	{ id: "terminal", name: "终端", kind: "terminal", command: "x-terminal-emulator" },
];

const MAC_BUNDLE_ROOTS = ["/Applications", join(homedir(), "Applications"), "/System/Applications"];

const iconCache = new Map<string, string | undefined>();

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
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
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Absolute bundle path when the app is installed, else undefined. */
function resolveBundle(bundle: string): string | undefined {
	if (bundle.startsWith("/")) return isDirectory(bundle) ? bundle : undefined;
	for (const root of MAC_BUNDLE_ROOTS) {
		const candidate = join(root, bundle);
		if (isDirectory(candidate)) return candidate;
	}
	return undefined;
}

interface ResolvedApp {
	definition: AppDefinition;
	/** Path used to launch the app. */
	launchPath: string;
	/** True when the launch goes through `open -a` rather than a CLI. */
	viaBundle: boolean;
	/** Bundle to read the icon from; preferred even when a CLI does the launch. */
	iconPath: string;
}

function resolveApp(definition: AppDefinition): ResolvedApp | undefined {
	const commandPath = definition.command ? findOnPath(definition.command) : undefined;
	if (process.platform === "darwin") {
		const bundlePath = definition.bundle ? resolveBundle(definition.bundle) : undefined;
		// A CLI on PATH is preferred when both exist: it opens in the running window.
		if (commandPath) {
			return { definition, launchPath: commandPath, viaBundle: false, iconPath: bundlePath ?? commandPath };
		}
		if (bundlePath) return { definition, launchPath: bundlePath, viaBundle: true, iconPath: bundlePath };
		return undefined;
	}
	if (definition.bundle && !definition.command) {
		if (!existsSync(definition.bundle)) return undefined;
		return { definition, launchPath: definition.bundle, viaBundle: true, iconPath: definition.bundle };
	}
	return commandPath ? { definition, launchPath: commandPath, viaBundle: false, iconPath: commandPath } : undefined;
}

function defineCatalog(): readonly AppDefinition[] {
	if (process.platform === "darwin") return MAC_APPS;
	if (process.platform === "win32") return WINDOWS_APPS;
	return LINUX_APPS;
}

/** Only apps that are actually installed appear, so no item is ever dead. */
function resolveCatalog(): ResolvedApp[] {
	const resolved: ResolvedApp[] = [];
	for (const definition of defineCatalog()) {
		const app = resolveApp(definition);
		if (app) resolved.push(app);
	}
	return resolved;
}

/**
 * The bundle's own icon file. Info.plist is a binary plist, so its declared
 * CFBundleIconFile is read through `plutil` rather than a text pattern; scanning
 * Resources would happily pick a file-type icon instead of the app icon.
 */
async function findBundleIcon(bundlePath: string): Promise<string | undefined> {
	if (!bundlePath.endsWith(".app")) return undefined;
	const contents = join(bundlePath, "Contents");
	const resources = join(contents, "Resources");
	const declared = await readDeclaredIconName(join(contents, "Info.plist"));
	const candidates: string[] = [];
	if (declared) {
		candidates.push(join(resources, declared.endsWith(".icns") ? declared : `${declared}.icns`));
	}
	const appName = bundlePath
		.split("/")
		.at(-1)
		?.replace(/\.app$/u, "");
	if (appName) candidates.push(join(resources, `${appName}.icns`));
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

async function readDeclaredIconName(plistPath: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", plistPath], {
			timeout: 5_000,
		});
		const parsed: unknown = JSON.parse(stdout);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const value = (parsed as Record<string, unknown>).CFBundleIconFile;
		return typeof value === "string" && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * `app.getFileIcon` returns the same generic document icon for every bundle, so
 * a bundle icon is decoded from its .icns with the system `sips` tool instead.
 * Anything that fails falls back to the generic icon rather than no icon.
 */
async function readIcon(iconPath: string): Promise<string | undefined> {
	if (iconCache.has(iconPath)) return iconCache.get(iconPath);
	const dataUrl = (await readBundleIcon(iconPath)) ?? (await readGenericIcon(iconPath));
	iconCache.set(iconPath, dataUrl);
	return dataUrl;
}

async function readBundleIcon(iconPath: string): Promise<string | undefined> {
	if (process.platform !== "darwin") return undefined;
	const icnsPath = await findBundleIcon(iconPath);
	if (!icnsPath) return undefined;
	// Icons resolve concurrently, so each conversion needs its own scratch file:
	// a shared name lets one run's cleanup delete another run's output.
	const output = join(app.getPath("temp"), `pi-desktop-icon-${randomUUID()}.png`);
	try {
		await execFileAsync("sips", ["-s", "format", "png", "-Z", "64", icnsPath, "--out", output], {
			timeout: 5_000,
		});
		const png = await readFile(output);
		return `data:image/png;base64,${png.toString("base64")}`;
	} catch {
		return undefined;
	} finally {
		await rm(output, { force: true });
	}
}

async function readGenericIcon(iconPath: string): Promise<string | undefined> {
	let icon: NativeImage | undefined;
	try {
		icon = await app.getFileIcon(iconPath, { size: "normal" });
	} catch {
		icon = undefined;
	}
	return icon && !icon.isEmpty() ? icon.toDataURL() : undefined;
}

export async function listOpenWithApps(): Promise<OpenWithApp[]> {
	const catalog = resolveCatalog();
	return Promise.all(
		catalog.map(async ({ definition, iconPath }) => ({
			id: definition.id,
			name: definition.name,
			kind: definition.kind,
			...(await readIcon(iconPath).then((iconDataUrl) => (iconDataUrl ? { iconDataUrl } : {}))),
		})),
	);
}

/** The catalog entry for an id, or undefined when it is not installed here. */
export function findOpenWithApp(appId: string): ResolvedApp | undefined {
	return resolveCatalog().find((app) => app.definition.id === appId);
}

export async function openWith(appId: string, path: string): Promise<void> {
	const resolved = findOpenWithApp(appId);
	if (!resolved) throw new Error("该应用未安装，无法打开项目。");
	if (resolved.definition.kind === "fileManager") {
		// `openPath` hands the folder to the desktop's default file manager.
		const error = await shell.openPath(path);
		if (error) throw new Error(error);
		return;
	}
	if (resolved.viaBundle) {
		await launchDetached("open", ["-a", resolved.launchPath, path]);
		return;
	}
	await launchDetached(resolved.launchPath, [path]);
}

/**
 * Launches a detached program and resolves once it has started. A GUI app may
 * outlive the handoff, so the IPC call must not wait for it to exit.
 */
function launchDetached(command: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], { detached: true, stdio: "ignore" });
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
		child.once("error", reject);
	});
}
