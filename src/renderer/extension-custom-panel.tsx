import { memo, useEffect, useMemo, useRef } from "react";
import type { DesktopExtensionWidget } from "../shared/contracts.ts";
import { normalizeCustomPanelLines, parseAnsiLine } from "./ansi.ts";
import { useI18n } from "./i18n.ts";
import { asBracketedPaste, toTerminalKeyData } from "./terminal-input.ts";
import { Button } from "./ui/button.tsx";

interface ExtensionCustomPanelProps {
	id: string;
	lines: string[];
	onInput: (id: string, data: string) => void;
}

export const ExtensionCustomPanel = memo(function ExtensionCustomPanel({
	id,
	lines,
	onInput,
}: ExtensionCustomPanelProps) {
	const { t } = useI18n();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const displayLines = useMemo(() => normalizeCustomPanelLines(lines), [lines]);

	useEffect(() => inputRef.current?.focus(), []);

	return (
		<div className="fixed inset-0 z-[120] grid place-items-center bg-[rgb(0_0_0/28%)] p-5 backdrop-blur-[2px]">
			<div
				className="relative flex max-h-[min(760px,calc(100vh-40px))] w-[min(920px,100%)] flex-col overflow-hidden rounded-[var(--ds-panel-radius)] border-0 bg-[var(--surface-1)] shadow-[0_0_0_0.5px_var(--ds-border-default),var(--ds-shadow-dialog)]"
				role="dialog"
				aria-modal="true"
				aria-label={t("extensionPanel")}
				onClick={() => inputRef.current?.focus()}
				onKeyDown={() => inputRef.current?.focus()}
			>
				<textarea
					ref={inputRef}
					className="pointer-events-none absolute size-px opacity-0"
					aria-label={t("extensionPanelInput")}
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
					spellCheck={false}
					onKeyDown={(event) => {
						if (composingRef.current || event.nativeEvent.isComposing) return;
						const data = toTerminalKeyData(event);
						if (!data) return;
						event.preventDefault();
						event.stopPropagation();
						onInput(id, data);
					}}
					onInput={(event) => {
						if (composingRef.current || event.nativeEvent.isComposing) return;
						const text = event.currentTarget.value;
						event.currentTarget.value = "";
						if (text) onInput(id, text);
					}}
					onCompositionStart={() => {
						composingRef.current = true;
					}}
					onCompositionEnd={(event) => {
						composingRef.current = false;
						const input = event.currentTarget;
						queueMicrotask(() => {
							const text = input.value;
							input.value = "";
							if (text) onInput(id, text);
						});
					}}
					onPaste={(event) => {
						event.preventDefault();
						const text = event.clipboardData.getData("text");
						if (text) onInput(id, asBracketedPaste(text));
					}}
				/>
				<header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
					<strong className="text-[length:var(--text-md)]">{t("extensionPanel")}</strong>
					<span className="flex-1 text-[length:var(--text-xs)] text-[color:var(--text-muted)]">
						{t("extensionPanelHint")}
					</span>
					<Button size="sm" type="button" onClick={() => onInput(id, "\x03")}>
						{t("close")}
					</Button>
				</header>
				<pre
					className="m-0 min-h-40 overflow-auto bg-[var(--surface-1)] px-4 pt-3.5 pb-[18px] font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] leading-[var(--leading-body)] whitespace-pre text-[color:var(--text)] [tab-size:2]"
					aria-live="polite"
				>
					{displayLines.map((line, lineIndex) => (
						<div key={`${lineIndex}-${line}`}>
							{parseAnsiLine(line).map((segment, segmentIndex) => (
								<span key={`${segmentIndex}-${segment.text}`} style={segment.style}>
									{segment.text}
								</span>
							))}
							{"\n"}
						</div>
					))}
				</pre>
			</div>
		</div>
	);
});

export const ExtensionWidgetStack = memo(function ExtensionWidgetStack({
	widgets,
	className,
}: {
	widgets: DesktopExtensionWidget[];
	className?: string;
}) {
	if (!widgets.length) return null;
	return (
		<div className={["grid gap-[5px] px-2.5 pb-[7px]", className].filter(Boolean).join(" ")}>
			{widgets.map((widget) => (
				<div
					className="overflow-x-auto rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_84%,transparent)] px-2 py-[7px] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] leading-[var(--leading-body)] whitespace-pre text-[color:var(--text-dim)]"
					key={widget.key}
				>
					{widget.lines.map((line, lineIndex) => (
						<div key={`${lineIndex}-${line}`}>
							{parseAnsiLine(line).map((segment, segmentIndex) => (
								<span key={`${segmentIndex}-${segment.text}`} style={segment.style}>
									{segment.text}
								</span>
							))}
						</div>
					))}
				</div>
			))}
		</div>
	);
});
