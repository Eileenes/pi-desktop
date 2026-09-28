export const APP_SHORTCUTS = {
	k: "search",
	l: "focusComposer",
	n: "newSession",
	j: "toggleTerminal",
} as const;

interface ShortcutEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing: boolean;
	repeat: boolean;
	defaultPrevented: boolean;
}

export function appShortcutFor(event: ShortcutEvent, inDialog: boolean, inTerminal: boolean) {
	if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return undefined;
	if (!(event.metaKey || event.ctrlKey) || inDialog) return undefined;
	const key = event.key.toLowerCase();
	if (!Object.hasOwn(APP_SHORTCUTS, key)) return undefined;
	const command = APP_SHORTCUTS[key as keyof typeof APP_SHORTCUTS];
	// A terminal owns Ctrl+K/L/N; its dedicated toggle remains available.
	return inTerminal && command !== "toggleTerminal" ? undefined : command;
}

export function isComposingInput(event: { isComposing: boolean; keyCode: number }, composing: boolean): boolean {
	return composing || event.isComposing || event.keyCode === 229;
}
