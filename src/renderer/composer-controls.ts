import type { DesktopExtensionStatus, DesktopModel, DesktopThinkingLevel } from "../shared/contracts.ts";
import { stripAnsi } from "./ansi.ts";

export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const LEADING_STATUS_MARKER_RE = /^(?:\x1B\[[0-9;]*m)*(?:[●◉○◯•·▪▫⬤⦿⊙◦∙🟢🔴🟡⚪⚫])(?:\x1B\[[0-9;]*m)*(?:\s+)?/u;

export function getComposerThinkingLevels(
	availableLevels: readonly DesktopThinkingLevel[] | undefined,
): DesktopThinkingLevel[] {
	const available = new Set(availableLevels ?? THINKING_LEVELS);
	return THINKING_LEVELS.filter((level) => level === "auto" || available.has(level));
}

export function getThinkingDisplayLabel(
	level: DesktopThinkingLevel,
	thinkingLevelMap: DesktopModel["thinkingLevelMap"] | undefined,
): string {
	if (level === "auto") return level;
	return thinkingLevelMap?.[level] ?? level;
}

export function getModelDisplayName(
	models: readonly DesktopModel[],
	model: { provider: string; id: string } | undefined,
): string | undefined {
	if (!model) return undefined;
	return (
		models.find((candidate) => candidate.provider === model.provider && candidate.id === model.id)?.name ?? model.id
	);
}

export function sanitizeExtensionStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/gu, " ")
		.replace(/ +/gu, " ")
		.trim()
		.replace(LEADING_STATUS_MARKER_RE, "")
		.trim();
}

export function formatExtensionStatusLine(statuses: readonly DesktopExtensionStatus[]): string {
	return statuses
		.slice()
		.sort((left, right) => left.key.localeCompare(right.key))
		.map((status) => sanitizeExtensionStatusText(status.text))
		.filter(Boolean)
		.join(" ");
}

export function getPlainExtensionStatusLine(statusLine: string): string {
	return stripAnsi(statusLine);
}
