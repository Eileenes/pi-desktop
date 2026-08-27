import { memo, useEffect, useMemo, useRef } from "react";
import type { DesktopExtensionWidget } from "../shared/contracts.ts";
import { normalizeCustomPanelLines, parseAnsiLine } from "./ansi.ts";
import { asBracketedPaste, toTerminalKeyData } from "./terminal-input.ts";

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
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const displayLines = useMemo(() => normalizeCustomPanelLines(lines), [lines]);

	useEffect(() => inputRef.current?.focus(), []);

	return (
		<div className="extension-custom-backdrop">
			<div
				className="extension-custom-panel"
				role="dialog"
				aria-modal="true"
				aria-label="扩展交互面板"
				onClick={() => inputRef.current?.focus()}
				onKeyDown={() => inputRef.current?.focus()}
			>
				<textarea
					ref={inputRef}
					className="extension-custom-input"
					aria-label="扩展面板输入"
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
				<header className="extension-custom-header">
					<strong>扩展交互面板</strong>
					<span>键盘输入会直接发送给扩展</span>
					<button type="button" onClick={() => onInput(id, "\x03")}>
						关闭
					</button>
				</header>
				<pre className="extension-custom-terminal" aria-live="polite">
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
}: {
	widgets: DesktopExtensionWidget[];
}) {
	if (!widgets.length) return null;
	return (
		<div className="extension-widget-stack">
			{widgets.map((widget) => (
				<div className="extension-widget" key={widget.key}>
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
