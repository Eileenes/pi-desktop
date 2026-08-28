import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow, screen } from "electron";

const SCHEMA_VERSION = 1;
const MAX_DIMENSION = 32767;
const THROTTLE_MS = 500;

interface WindowState {
	version: number;
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}

function stateFilePath(): string {
	return join(app.getPath("userData"), "window-state.json");
}

function sanitizeWidth(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 900 || value > MAX_DIMENSION) return undefined;
	return Math.round(value);
}

function sanitizeOffset(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_DIMENSION) return undefined;
	return Math.round(value);
}

function boundsOnVisibleArea(x: number, y: number, width: number, height: number): boolean {
	return screen.getAllDisplays().some((display) => {
		const area = display.workArea;
		return (
			x >= area.x - 40 &&
			y >= area.y - 40 &&
			x + width <= area.x + area.width + 40 &&
			y + height <= area.y + area.height + 40
		);
	});
}

function clampState(state: WindowState): WindowState {
	const primary = screen.getPrimaryDisplay().workArea;
	let { width, height } = state;
	width = Math.min(Math.max(width, 900), Math.max(900, primary.width));
	height = Math.min(Math.max(height, 600), Math.max(600, primary.height));
	if (state.x === undefined || state.y === undefined || !boundsOnVisibleArea(state.x, state.y, width, height)) {
		return { ...state, width, height, x: undefined, y: undefined };
	}
	return { ...state, width, height };
}

export function loadWindowState(): WindowState {
	const fallback: WindowState = { version: SCHEMA_VERSION, width: 1440, height: 920, maximized: false };
	try {
		const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8")) as Partial<WindowState>;
		if (parsed.version !== SCHEMA_VERSION) return fallback;
		const width = sanitizeWidth(parsed.width);
		const height = sanitizeWidth(parsed.height);
		if (!width || !height) return fallback;
		return clampState({
			version: SCHEMA_VERSION,
			width,
			height,
			maximized: parsed.maximized === true,
			...(sanitizeOffset(parsed.x) !== undefined && sanitizeOffset(parsed.y) !== undefined
				? { x: sanitizeOffset(parsed.x), y: sanitizeOffset(parsed.y) }
				: {}),
		});
	} catch {
		return fallback;
	}
}

function persist(state: WindowState): void {
	try {
		mkdirSync(app.getPath("userData"), { recursive: true });
		writeFileSync(stateFilePath(), `${JSON.stringify(state, null, "\t")}\n`, { mode: 0o600 });
	} catch {
		// Window state persistence is best-effort.
	}
}

export interface WindowStateTracker {
	flush(): void;
}

export function trackWindowState(window: BrowserWindow): WindowStateTracker {
	const write = (): void => {
		if (window.isDestroyed()) return;
		const bounds = window.getNormalBounds();
		persist({
			version: SCHEMA_VERSION,
			width: bounds.width,
			height: bounds.height,
			maximized: window.isMaximized(),
			...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
		});
	};
	let timer: NodeJS.Timeout | undefined;
	const schedule = (): void => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = undefined;
			write();
		}, THROTTLE_MS);
		timer.unref?.();
	};
	window.on("move", schedule);
	window.on("resize", schedule);
	window.on("maximize", schedule);
	window.on("unmaximize", schedule);
	window.on("close", () => {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
			write();
		}
	});
	return {
		flush(): void {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
			write();
		},
	};
}
