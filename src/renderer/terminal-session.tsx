import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import {
	closeTerminal,
	createTerminal,
	onTerminalData,
	onTerminalExit,
	resizeTerminal,
	writeTerminal,
} from "./desktop-store.ts";

/**
 * Terminal colours, read from the active theme at mount and whenever the theme
 * changes. xterm needs concrete values, so these tokens hold plain colours.
 */
const TOKEN_NAMES = {
	background: "--ds-terminal-bg",
	foreground: "--ds-terminal-fg",
	cursor: "--ds-terminal-cursor",
	cursorAccent: "--ds-terminal-cursor-accent",
	selectionBackground: "--ds-terminal-selection",
	black: "--ds-terminal-black",
	red: "--ds-terminal-red",
	green: "--ds-terminal-green",
	yellow: "--ds-terminal-yellow",
	blue: "--ds-terminal-blue",
	magenta: "--ds-terminal-magenta",
	cyan: "--ds-terminal-cyan",
	white: "--ds-terminal-white",
	brightBlack: "--ds-terminal-bright-black",
	brightRed: "--ds-terminal-bright-red",
	brightGreen: "--ds-terminal-bright-green",
	brightYellow: "--ds-terminal-bright-yellow",
	brightBlue: "--ds-terminal-bright-blue",
	brightMagenta: "--ds-terminal-bright-magenta",
	brightCyan: "--ds-terminal-bright-cyan",
	brightWhite: "--ds-terminal-bright-white",
} as const;

type TerminalTheme = Record<keyof typeof TOKEN_NAMES, string>;

function readTheme(): TerminalTheme {
	const styles = getComputedStyle(document.documentElement);
	const theme = {} as TerminalTheme;
	for (const [key, token] of Object.entries(TOKEN_NAMES)) {
		theme[key as keyof typeof TOKEN_NAMES] = styles.getPropertyValue(token).trim() || "#000";
	}
	return theme;
}

export interface TerminalSessionHandle {
	id: string;
	shell: string;
}

export interface TerminalSessionProps {
	onReady: (handle: TerminalSessionHandle) => void;
	onError: (message: string) => void;
	onExit: (exitCode: number) => void;
	/** The panel collapsed: keep the shell alive, just stop painting it. */
	visible: boolean;
}

/**
 * One xterm instance bound to one main-process shell. The shell is created here
 * rather than by the parent so it starts at the real measured size instead of
 * being resized a moment later. The instance stays mounted for the tab's whole
 * lifetime, so scrollback survives collapsing the panel.
 */
export function TerminalSession({ onReady, onError, onExit, visible }: TerminalSessionProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<XTerm | undefined>(undefined);
	const fitRef = useRef<FitAddon | undefined>(undefined);
	const callbacksRef = useRef({ onReady, onError, onExit });
	callbacksRef.current = { onReady, onError, onExit };

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const term = new XTerm({
			fontSize: 13,
			fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Cascadia Mono", monospace',
			lineHeight: 1.25,
			cursorBlink: true,
			scrollback: 5_000,
			theme: readTheme(),
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new ClipboardAddon());
		term.loadAddon(new WebLinksAddon());
		term.open(host);
		termRef.current = term;
		fitRef.current = fit;
		return () => {
			term.dispose();
			termRef.current = undefined;
			fitRef.current = undefined;
		};
	}, []);

	// The theme lives on the document element, so watching those attributes keeps
	// the emulator in step with light/dark and the accent presets without the
	// app having to thread a version counter through the panel.
	useEffect(() => {
		const observer = new MutationObserver(() => {
			const term = termRef.current;
			if (term) term.options.theme = readTheme();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "data-accent"],
		});
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const term = termRef.current;
		const fit = fitRef.current;
		if (!term || !fit) return;
		let disposed = false;
		let sessionId: string | undefined;
		let unsubscribers: Array<() => void> = [];

		// Only refit while the panel is laid out. A collapsed panel, or an inactive
		// tab the parent renders hidden, measures zero and would otherwise push a
		// degenerate size onto the shell.
		const refit = () => {
			if (!visible) return;
			const host = hostRef.current;
			if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
			try {
				fit.fit();
			} catch {
				// Mid-layout; the next observer tick fits again.
			}
		};
		refit();

		const input = term.onData((data) => {
			if (sessionId) void writeTerminal(sessionId, data).catch(() => undefined);
		});
		const resize = term.onResize(({ cols, rows }) => {
			if (sessionId) void resizeTerminal(sessionId, cols, rows).catch(() => undefined);
		});
		const observer = new ResizeObserver(refit);
		if (hostRef.current) observer.observe(hostRef.current);

		void (async () => {
			try {
				const created = await createTerminal(term.cols, term.rows);
				if (disposed) {
					// The tab closed while the shell was starting.
					await closeTerminal(created.id);
					return;
				}
				sessionId = created.id;
				unsubscribers = [
					onTerminalData((event) => {
						if (event.id === created.id) term.write(event.data);
					}),
					onTerminalExit((event) => {
						if (event.id === created.id) callbacksRef.current.onExit(event.exitCode);
					}),
				];
				callbacksRef.current.onReady({ id: created.id, shell: created.shell });
				term.focus();
			} catch (error) {
				if (!disposed) {
					callbacksRef.current.onError(error instanceof Error ? error.message : String(error));
				}
			}
		})();

		return () => {
			disposed = true;
			observer.disconnect();
			input.dispose();
			resize.dispose();
			for (const unsubscribe of unsubscribers) unsubscribe();
			// Closing a tab must not leave an orphaned shell behind; the panel itself
			// stays alive across collapse by never unmounting this component.
			if (sessionId) void closeTerminal(sessionId).catch(() => undefined);
		};
	}, [visible]);

	return <div className="terminal-host" ref={hostRef} />;
}
