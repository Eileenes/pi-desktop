export interface TerminalKeyEventLike {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

const SPECIAL_KEYS: Record<string, string> = {
	ArrowUp: "\x1b[A",
	ArrowDown: "\x1b[B",
	ArrowRight: "\x1b[C",
	ArrowLeft: "\x1b[D",
	Home: "\x1b[H",
	End: "\x1b[F",
	Insert: "\x1b[2~",
	Delete: "\x1b[3~",
	PageUp: "\x1b[5~",
	PageDown: "\x1b[6~",
	Escape: "\x1b",
	Backspace: "\x7f",
};

const ALT_ARROWS: Record<string, string> = {
	ArrowLeft: "\x1bb",
	ArrowRight: "\x1bf",
	ArrowUp: "\x1bp",
	ArrowDown: "\x1bn",
};

export function toTerminalKeyData(event: TerminalKeyEventLike): string | undefined {
	if (event.metaKey || (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v")) return undefined;
	if (event.ctrlKey && !event.altKey && event.key.length === 1) {
		const code = event.key.toUpperCase().charCodeAt(0);
		if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
		if (event.key === "?") return "\x7f";
	}
	if (event.altKey && !event.ctrlKey) {
		if (event.key === "Backspace") return "\x1b\x7f";
		if (ALT_ARROWS[event.key]) return ALT_ARROWS[event.key];
		if (event.key.length === 1) return `\x1b${event.key}`;
	}
	if (event.key === "Enter") return event.shiftKey ? "\n" : "\r";
	if (event.key === "Tab") return event.shiftKey ? "\x1b[Z" : "\t";
	return SPECIAL_KEYS[event.key];
}

export function asBracketedPaste(text: string): string {
	return `\x1b[200~${text}\x1b[201~`;
}
