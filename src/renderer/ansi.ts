import type { CSSProperties } from "react";

const ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu;
const SGR_RE = /\x1B\[([0-9;]*)m/gu;
const CURSOR_RE = /\x1B_pi:c\x07/gu;

const NORMAL = ["#6b7280", "#dc2626", "#16a34a", "#d97706", "#2563eb", "#9333ea", "#0891b2", "#d1d5db"];
const BRIGHT = ["#9ca3af", "#ef4444", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#f9fafb"];

export interface AnsiSegment {
	text: string;
	style: CSSProperties;
}

export function stripAnsi(text: string): string {
	return text.replace(CURSOR_RE, "").replace(ESCAPE_RE, "");
}

export function normalizeCustomPanelLines(lines: string[]): string[] {
	const normalized = lines
		.map((line) => line.replace(CURSOR_RE, ""))
		.filter((line) => !/^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/u.test(stripAnsi(line).trimEnd()))
		.map((line) =>
			line
				.replace(/^((?:\x1b\[[0-9;]*m)*)[│┃] ?/u, "$1")
				.replace(/[│┃]\s*$/u, "")
				.trimEnd(),
		);
	while (normalized.length && !stripAnsi(normalized[0] ?? "").trim()) normalized.shift();
	while (normalized.length && !stripAnsi(normalized.at(-1) ?? "").trim()) normalized.pop();
	return normalized.length ? normalized : lines;
}

function indexedColor(index: number): string | undefined {
	if (index < 8) return NORMAL[index];
	if (index < 16) return BRIGHT[index - 8];
	if (index >= 16 && index <= 231) {
		const value = index - 16;
		const scale = (part: number): number => (part === 0 ? 0 : 55 + part * 40);
		return `rgb(${scale(Math.floor(value / 36))}, ${scale(Math.floor((value % 36) / 6))}, ${scale(value % 6)})`;
	}
	if (index >= 232 && index <= 255) {
		const gray = 8 + (index - 232) * 10;
		return `rgb(${gray}, ${gray}, ${gray})`;
	}
	return undefined;
}

function applyCodes(style: CSSProperties, codes: number[]): CSSProperties {
	const next = { ...style };
	for (let index = 0; index < codes.length; index += 1) {
		const code = codes[index];
		if (code === 0) return {};
		if (code === 1) next.fontWeight = 700;
		else if (code === 2) next.opacity = 0.65;
		else if (code === 3) next.fontStyle = "italic";
		else if (code === 4) next.textDecoration = "underline";
		else if (code === 22) {
			delete next.fontWeight;
			delete next.opacity;
		} else if (code === 23) delete next.fontStyle;
		else if (code === 24) delete next.textDecoration;
		else if (code === 39) delete next.color;
		else if (code === 49) delete next.backgroundColor;
		else if (code !== undefined && code >= 30 && code <= 37) next.color = NORMAL[code - 30];
		else if (code !== undefined && code >= 90 && code <= 97) next.color = BRIGHT[code - 90];
		else if (code !== undefined && code >= 40 && code <= 47) next.backgroundColor = NORMAL[code - 40];
		else if (code !== undefined && code >= 100 && code <= 107) next.backgroundColor = BRIGHT[code - 100];
		else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
			const color = indexedColor(codes[index + 2] ?? -1);
			if (color) {
				if (code === 38) next.color = color;
				else next.backgroundColor = color;
			}
			index += 2;
		} else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
			const rgb = codes.slice(index + 2, index + 5);
			if (rgb.length === 3 && rgb.every(Number.isFinite)) {
				const color = `rgb(${rgb.join(", ")})`;
				if (code === 38) next.color = color;
				else next.backgroundColor = color;
			}
			index += 4;
		}
	}
	return next;
}

export function parseAnsiLine(line: string): AnsiSegment[] {
	const segments: AnsiSegment[] = [];
	let style: CSSProperties = {};
	let cursor = 0;
	SGR_RE.lastIndex = 0;
	for (const match of line.matchAll(SGR_RE)) {
		const index = match.index;
		if (index > cursor) segments.push({ text: line.slice(cursor, index), style });
		style = applyCodes(style, match[1] ? match[1].split(";").map(Number) : [0]);
		cursor = index + match[0].length;
	}
	if (cursor < line.length) segments.push({ text: line.slice(cursor).replace(ESCAPE_RE, ""), style });
	return segments;
}
