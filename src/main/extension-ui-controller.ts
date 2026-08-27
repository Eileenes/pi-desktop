import { randomUUID } from "node:crypto";
import type { DesktopExtensionDialog, DesktopExtensionUiEvent } from "../shared/contracts.ts";

type DialogRequest =
	| { kind: "select"; title: string; options: string[] }
	| { kind: "confirm"; title: string; message: string }
	| { kind: "input"; title: string; placeholder?: string }
	| { kind: "editor"; title: string; prefill?: string };

interface DialogOptions {
	signal?: AbortSignal;
	timeout?: number;
}

interface PendingDialog {
	dialog: DesktopExtensionDialog;
	sessionId: string;
	resolve: (value: string) => void;
	timeout?: ReturnType<typeof setTimeout>;
	signal?: AbortSignal;
	onAbort?: () => void;
}

export class ExtensionDialogQueue {
	private readonly pending = new Map<string, PendingDialog>();
	private sequence = 0;
	private readonly emit: (event: DesktopExtensionUiEvent) => void;

	constructor(emit: (event: DesktopExtensionUiEvent) => void) {
		this.emit = emit;
	}

	request(sessionId: string, request: DialogRequest, options?: DialogOptions): Promise<string> {
		if (options?.signal?.aborted) return Promise.resolve("");
		const id = `ext-dialog-${++this.sequence}`;
		const dialog = { ...request, id } as DesktopExtensionDialog;
		return new Promise((resolve) => {
			const pending: PendingDialog = { dialog, sessionId, resolve };
			const settle = (): void => {
				if (!this.pending.has(id)) return;
				this.finish(id, "");
			};
			const timeoutMs = Math.max(0, options?.timeout ?? 120_000);
			if (timeoutMs > 0) pending.timeout = setTimeout(settle, timeoutMs);
			if (options?.signal) {
				pending.signal = options.signal;
				pending.onAbort = settle;
				options.signal.addEventListener("abort", settle, { once: true });
			}
			this.pending.set(id, pending);
			this.emit({ type: "dialog", sessionId, dialog });
		});
	}

	resolve(id: string, value: string): boolean {
		if (!this.pending.has(id)) return false;
		this.finish(id, value);
		return true;
	}

	reemitForSession(sessionId: string): void {
		for (const pending of this.pending.values()) {
			if (pending.sessionId === sessionId) {
				this.emit({ type: "dialog", sessionId, dialog: pending.dialog });
			}
		}
	}

	cancelSession(sessionId: string): void {
		for (const [id, pending] of this.pending) {
			if (pending.sessionId === sessionId) this.finish(id, "");
		}
	}

	private finish(id: string, value: string): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (pending.timeout) clearTimeout(pending.timeout);
		if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
		this.emit({ type: "dialogClosed", sessionId: pending.sessionId, id });
		pending.resolve(value);
	}
}

export const DEFAULT_CUSTOM_UI_COLUMNS = 92;
export const DEFAULT_CUSTOM_UI_ROWS = 40;

interface CustomUiComponent {
	render(width: number): string[];
	handleInput?(data: string): void;
	dispose?(): void;
}

interface ActiveCustomUi {
	component: CustomUiComponent;
	width: number;
	resolve: (value: unknown) => void;
	settled: boolean;
}

interface CustomUiOptions {
	width?: number;
	maxWidth?: number;
}

export interface HeadlessCustomUiTui {
	readonly terminal: {
		readonly columns: number;
		readonly rows: number;
		readonly kittyProtocolActive: false;
	};
	requestRender(force?: boolean): void;
}

export function createHeadlessCustomUiTui(
	requestRender: (force?: boolean) => void,
	columns = DEFAULT_CUSTOM_UI_COLUMNS,
	rows = DEFAULT_CUSTOM_UI_ROWS,
): HeadlessCustomUiTui {
	const terminal = Object.freeze({ columns, rows, kittyProtocolActive: false as const });
	return Object.freeze({ terminal, requestRender });
}

export class ExtensionCustomUiController {
	private readonly active = new Map<string, ActiveCustomUi>();
	private readonly sessionId: string;
	private readonly emit: (event: DesktopExtensionUiEvent) => void;
	private readonly theme: unknown;
	private readonly keybindings: unknown;

	constructor(
		sessionId: string,
		emit: (event: DesktopExtensionUiEvent) => void,
		theme: unknown,
		keybindings: unknown,
	) {
		this.sessionId = sessionId;
		this.emit = emit;
		this.theme = theme;
		this.keybindings = keybindings;
	}

	request<T>(factory: unknown, options?: unknown): Promise<T> {
		if (typeof factory !== "function") return Promise.resolve(undefined as T);
		const id = randomUUID();
		const width = this.getWidth(options);
		return new Promise<T>((resolve) => {
			let completed = false;
			const finish = (value: T): void => {
				if (completed) return;
				completed = true;
				resolve(value);
			};
			const done = (value: T): void => {
				if (this.active.has(id)) this.close(id, value);
				else finish(value);
			};
			const tui = createHeadlessCustomUiTui(() => this.render(id), width);
			const create = factory as (
				tui: HeadlessCustomUiTui,
				theme: unknown,
				keybindings: unknown,
				done: (value: T) => void,
			) => unknown;
			Promise.resolve(create(tui, this.theme, this.keybindings, done))
				.then((component) => {
					if (completed) {
						if (this.isComponent(component)) component.dispose?.();
						return;
					}
					if (!this.isComponent(component)) {
						finish(undefined as T);
						return;
					}
					this.active.set(id, {
						component,
						width,
						resolve: (value) => finish(value as T),
						settled: false,
					});
					this.render(id);
				})
				.catch(() => finish(undefined as T));
		});
	}

	input(id: string, data: string): boolean {
		const custom = this.active.get(id);
		if (!custom) return false;
		try {
			custom.component.handleInput?.(data);
			if (this.active.has(id)) this.render(id);
		} catch {
			this.close(id, undefined);
		}
		return true;
	}

	reemit(): void {
		for (const id of this.active.keys()) this.render(id);
	}

	dispose(): void {
		for (const id of [...this.active.keys()]) this.close(id, undefined);
	}

	private render(id: string): void {
		const custom = this.active.get(id);
		if (!custom) return;
		try {
			const lines = custom.component.render(custom.width).filter((line): line is string => typeof line === "string");
			this.emit({ type: "custom", sessionId: this.sessionId, id, lines });
		} catch {
			this.close(id, undefined);
		}
	}

	private close(id: string, value: unknown): void {
		const custom = this.active.get(id);
		if (!custom || custom.settled) return;
		custom.settled = true;
		this.active.delete(id);
		try {
			custom.component.dispose?.();
		} finally {
			this.emit({ type: "custom", sessionId: this.sessionId, id, lines: [], closed: true });
			custom.resolve(value);
		}
	}

	private getWidth(options: unknown): number {
		if (typeof options !== "object" || options === null || Array.isArray(options)) return DEFAULT_CUSTOM_UI_COLUMNS;
		const typed = options as CustomUiOptions;
		const requested = typed.width ?? typed.maxWidth;
		return typeof requested === "number" && Number.isFinite(requested)
			? Math.min(160, Math.max(40, Math.floor(requested)))
			: DEFAULT_CUSTOM_UI_COLUMNS;
	}

	private isComponent(value: unknown): value is CustomUiComponent {
		return (
			typeof value === "object" && value !== null && typeof (value as { render?: unknown }).render === "function"
		);
	}
}
