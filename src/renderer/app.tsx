import type { CSSProperties, FormEvent } from "react";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
	DesktopAuthenticationPrompt,
	DesktopGitChange,
	DesktopImageAttachment,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopToolApproval,
	DesktopTranscriptBlock,
	DesktopTranscriptMessage,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { AppSettingsModal } from "./app-settings-modal.tsx";
import { ConversationNavigator } from "./conversation-navigator.tsx";
import {
	abortSession,
	attachDroppedImages,
	chooseImages,
	chooseWorkspace,
	compactSession,
	decideToolApproval,
	forkSession,
	getDesktopSnapshot,
	getDesktopStartupError,
	listGitChanges,
	listWorkspaceFiles,
	navigateTree,
	newSession,
	notifyComplete,
	openSession,
	openWorkspaceFile,
	openWorkspacePath,
	readWorkspaceFile,
	respondToAuthenticationPrompt,
	revealWorkspaceFile,
	setModel,
	setProjectTrust,
	setThinkingLevel,
	startDesktopStore,
	startProviderSetup,
	submitPrompt,
	subscribeDesktopSnapshot,
} from "./desktop-store.ts";
import { type AppLanguage, translate } from "./i18n.ts";
import { MarkdownBody } from "./markdown.tsx";
import { ModelsConfigModal } from "./models-config-modal.tsx";
import { PluginsConfigModal } from "./plugins-config-modal.tsx";
import { ProjectTrustDialog } from "./project-trust-dialog.tsx";
import { ContextUsageRing, SessionStatsPanel } from "./session-stats.tsx";
import { SkillsConfigModal } from "./skills-config-modal.tsx";
import { getLanguageForPath, HighlightedCode } from "./syntax-highlight.tsx";
import { buildConversationTurns, partitionTranscript } from "./transcript-group.ts";
import { UpdateReminder } from "./update-reminder.tsx";
import { WorktreeSelector } from "./worktree-selector.tsx";

type IconName =
	| "branch"
	| "chevron"
	| "close"
	| "code"
	| "copy"
	| "doc"
	| "external"
	| "files"
	| "folder"
	| "gear"
	| "history"
	| "image"
	| "model"
	| "moon"
	| "more"
	| "panel"
	| "plugin"
	| "plus"
	| "search"
	| "send"
	| "skill"
	| "sun"
	| "tree"
	| "wrap";
type ConfigModal = "models" | "plugins" | "settings" | "skills";

const DRAFT_STORAGE_PREFIX = "pi-desktop-draft:";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
	const shared = {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.75,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};
	if (name === "branch") {
		return (
			<svg {...shared} aria-hidden="true">
				<circle cx="6" cy="6" r="2" />
				<circle cx="18" cy="18" r="2" />
				<circle cx="18" cy="6" r="2" />
				<path d="M6 8v8a2 2 0 0 0 2 2h8" />
				<path d="M16 6H8a2 2 0 0 0-2 2" />
			</svg>
		);
	}
	if (name === "model") {
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
				<rect x="9.5" y="9.5" width="5" height="5" />
				<path d="M9 2v2.5M15 2v2.5M9 19.5V22M15 19.5V22M2 9h2.5M2 15h2.5M19.5 9H22M19.5 15H22" />
			</svg>
		);
	}
	if (name === "plugin") {
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="4" y="4" width="7" height="7" rx="1.5" />
				<rect x="13" y="4" width="7" height="7" rx="1.5" />
				<rect x="4" y="13" width="7" height="7" rx="1.5" />
				<path d="M16.5 13.5v6M13.5 16.5h6" />
			</svg>
		);
	}
	if (name === "skill") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 3c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6Z" />
				<path d="M18.5 15.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.7-.3-1.7-1-2.4-2.5-2.7 1.5-.3 2.2-1 2.5-2.7Z" />
			</svg>
		);
	}
	if (name === "sun") {
		return (
			<svg {...shared} aria-hidden="true">
				<circle cx="12" cy="12" r="4" />
				<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
			</svg>
		);
	}
	if (name === "moon") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M20.4 14.3A8.5 8.5 0 0 1 9.7 3.6a8.5 8.5 0 1 0 10.7 10.7Z" />
			</svg>
		);
	}
	if (name === "external") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M15 3h6v6" />
				<path d="M10 14 21 3" />
				<path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
			</svg>
		);
	}
	if (name === "code") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m8 6-5 6 5 6M16 6l5 6-5 6" />
			</svg>
		);
	}
	if (name === "doc") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
				<path d="M14 3v4h4M9 13h6M9 17h4" />
			</svg>
		);
	}
	if (name === "chevron")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m9 18 6-6-6-6" />
			</svg>
		);
	if (name === "close")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m6 6 12 12M18 6 6 18" />
			</svg>
		);
	if (name === "files")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4l1.8 2H18.5A1.5 1.5 0 0 1 20 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" />
				<path d="M4 9h16" />
			</svg>
		);
	if (name === "folder")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l1.8 2h7.7A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" />
			</svg>
		);
	if (name === "gear")
		return (
			<svg {...shared} aria-hidden="true">
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.5-1H5.3v-3h.2A1.7 1.7 0 0 0 7 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z" />
			</svg>
		);
	if (name === "image")
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="3.5" y="4" width="17" height="16" rx="2" />
				<circle cx="8.5" cy="9" r="1.5" />
				<path d="m4 17 5-5 3.2 3 2.5-2.4 4.8 4.4" />
			</svg>
		);
	if (name === "panel")
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="4" y="4" width="16" height="16" rx="1" />
				<path d="M15 4v16" />
			</svg>
		);
	if (name === "plus")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 5v14M5 12h14" />
			</svg>
		);
	if (name === "history")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
				<path d="M3 3v5h5" />
				<path d="M12 7v5l3 2" />
			</svg>
		);
	if (name === "more")
		return (
			<svg {...shared} aria-hidden="true">
				<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
				<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
				<circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
			</svg>
		);
	if (name === "send")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M4 12h14" />
				<path d="m12 6 6 6-6 6" />
			</svg>
		);
	if (name === "copy")
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="8" y="8" width="11" height="11" rx="2" />
				<path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
			</svg>
		);
	if (name === "wrap")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M4 7h11a4 4 0 0 1 4 4v1" />
				<path d="m16 9 3 3-3 3" />
				<path d="M4 17h8" />
			</svg>
		);
	if (name === "tree")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
				<path d="M15 7v10" />
			</svg>
		);
	return (
		<svg {...shared} aria-hidden="true">
			<circle cx="11" cy="11" r="6" />
			<path d="m16 16 4 4" />
		</svg>
	);
}

function formatWorkspace(path: string | undefined): string {
	if (!path) return "未选择项目";
	const segments = path.split(/[\\/]/u).filter(Boolean);
	return segments.at(-1) ?? path;
}

function sessionTitle(info: DesktopSessionInfo): string {
	if (info.name) return info.name;
	const first = info.firstMessage.trim();
	if (!first) return "新会话";
	return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

function formatSessionDate(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	if (date.toDateString() === now.toDateString()) {
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isFileEntry(entry: DesktopWorkspaceEntry): boolean {
	return entry.type === "file";
}

function getModelKey(provider: string, id: string): string {
	return `${provider}\u0000${id}`;
}

function formatAttachmentSize(size: number): string {
	if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} 千字节`;
	return `${(size / (1024 * 1024)).toFixed(1)} 兆字节`;
}

function formatMessageTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getFileExtension(path: string): string {
	const base = path.split(/[\\/]/u).at(-1) ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function fileIconFor(path: string): IconName {
	const extension = getFileExtension(path);
	if (
		extension === "png" ||
		extension === "jpg" ||
		extension === "jpeg" ||
		extension === "gif" ||
		extension === "webp" ||
		extension === "svg"
	) {
		return "image";
	}
	if (extension === "md" || extension === "markdown" || extension === "mdx") {
		return "doc";
	}
	if (
		extension === "ts" ||
		extension === "tsx" ||
		extension === "js" ||
		extension === "jsx" ||
		extension === "json" ||
		extension === "css" ||
		extension === "html" ||
		extension === "py" ||
		extension === "go" ||
		extension === "rs" ||
		extension === "java" ||
		extension === "c" ||
		extension === "cpp" ||
		extension === "h" ||
		extension === "sh" ||
		extension === "sql" ||
		extension === "yaml" ||
		extension === "yml" ||
		extension === "toml"
	) {
		return "code";
	}
	return "files";
}

function isMarkdownFile(path: string): boolean {
	const extension = getFileExtension(path);
	return extension === "md" || extension === "markdown" || extension === "mdx";
}

function getFileKindLabel(path: string): string {
	const extension = getFileExtension(path);
	const labels: Record<string, string> = {
		c: "C",
		cpp: "C++",
		css: "CSS",
		gif: "GIF 图片",
		go: "Go",
		h: "头文件",
		html: "HTML",
		java: "Java",
		jpeg: "JPEG 图片",
		jpg: "JPEG 图片",
		js: "JavaScript",
		jsx: "JSX",
		json: "JSON",
		md: "Markdown",
		markdown: "Markdown",
		mdx: "MDX",
		png: "PNG 图片",
		py: "Python",
		rs: "Rust",
		sh: "Shell",
		svg: "SVG 图片",
		toml: "TOML",
		ts: "TypeScript",
		tsx: "TSX",
		txt: "文本",
		webp: "WebP 图片",
		yaml: "YAML",
		yml: "YAML",
	};
	return labels[extension] ?? (extension ? extension.toUpperCase() : "文件");
}

function formatByteSize(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function playCompletionTone(): void {
	try {
		const context = new AudioContext();
		const now = context.currentTime;
		for (const [frequency, startAt] of [
			[880, now],
			[1320, now + 0.12],
		] as const) {
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			oscillator.type = "sine";
			oscillator.frequency.value = frequency;
			gain.gain.setValueAtTime(0.12, startAt);
			gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.35);
			oscillator.connect(gain);
			gain.connect(context.destination);
			oscillator.start(startAt);
			oscillator.stop(startAt + 0.35);
		}
		window.setTimeout(() => void context.close(), 700);
	} catch {
		// Audio unavailable; ignore.
	}
}

interface ToolApprovalCardProps {
	approval: DesktopToolApproval;
	resolving: boolean;
	onDecide: (id: string, approved: boolean) => Promise<void>;
}

const ToolApprovalCard = memo(function ToolApprovalCard({ approval, resolving, onDecide }: ToolApprovalCardProps) {
	const inputText = JSON.stringify(approval.input, null, 2);
	return (
		<article className="approval-card">
			<div className="card-heading">
				<div>
					<p className="section-kicker">工具审批</p>
					<h3>{approval.toolName}</h3>
				</div>
				<span className="card-id">{approval.toolCallId.slice(0, 8)}</span>
			</div>
			<pre>{inputText}</pre>
			<div className="card-actions">
				<button
					type="button"
					className="quiet-button"
					disabled={resolving}
					onClick={() => void onDecide(approval.id, false)}
				>
					拒绝
				</button>
				<button
					type="button"
					className="accent-button"
					disabled={resolving}
					onClick={() => void onDecide(approval.id, true)}
				>
					{resolving ? "处理中" : "本次允许"}
				</button>
			</div>
		</article>
	);
});

const TranscriptBlock = memo(function TranscriptBlock({ block }: { block: DesktopTranscriptBlock }) {
	const [expanded, setExpanded] = useState(false);
	if (block.type === "text") return <MarkdownBody text={block.text} />;
	if (block.type === "image") return <span className="message-image-label">{block.label}</span>;
	const label = block.type === "thinking" ? "思考过程" : `工具 · ${block.name}`;
	const detail = block.type === "thinking" ? block.text : block.input;
	return (
		<div className={`message-block message-block-${block.type}`}>
			<button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
				<span className="entry-chevron">
					<Icon name="chevron" size={11} />
				</span>
				{label}
			</button>
			{expanded ? (
				<pre>
					<code>{detail}</code>
				</pre>
			) : null}
		</div>
	);
});

const TranscriptMessage = memo(function TranscriptMessage({
	message,
	modelLabel,
	onEdit,
	onFork,
}: {
	message: DesktopTranscriptMessage;
	modelLabel?: string;
	onEdit: (text: string) => void;
	onFork: (entryId: string) => void;
}) {
	const [copied, setCopied] = useState(false);
	const isAssistant = message.role === "assistant";

	async function copyMessage(): Promise<void> {
		await navigator.clipboard.writeText(message.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<article className={`message message-${message.role}`}>
			{isAssistant ? (
				<div className="assistant-label">
					<span>{modelLabel ?? "Pi"}</span>
					{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
				</div>
			) : null}
			<div className="message-content">
				{isAssistant && message.blocks?.length ? (
					message.blocks.map((block, index) => <TranscriptBlock key={`${block.type}:${index}`} block={block} />)
				) : isAssistant ? (
					<MarkdownBody text={message.text || ""} />
				) : (
					<p>{message.text || "…"}</p>
				)}
			</div>
			<div className="message-actions">
				<button type="button" onClick={() => void copyMessage()} disabled={!message.text}>
					{copied ? "已复制" : "复制"}
				</button>
				{!isAssistant && message.text ? (
					<button type="button" onClick={() => onEdit(message.text)}>
						编辑
					</button>
				) : null}
				{!isAssistant && message.forkEntryId ? (
					<button type="button" onClick={() => onFork(message.forkEntryId ?? "")}>
						Fork
					</button>
				) : null}
				{!isAssistant && message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
			</div>
		</article>
	);
});

function transcriptDiffLineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return "diff-head";
	if (line.startsWith("@@")) return "diff-hunk";
	if (line.startsWith("+")) return "diff-add";
	if (line.startsWith("-")) return "diff-del";
	return "";
}

const CollapsibleTranscriptEntry = memo(function CollapsibleTranscriptEntry({
	message,
	toolCall,
}: {
	message: DesktopTranscriptMessage;
	toolCall?: { name: string; input: string };
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	async function copyOutput(): Promise<void> {
		await navigator.clipboard.writeText(message.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	}
	const isDiff = message.role === "tool" && /(^|\n)@@ |(^|\n)diff --git |(^|\n)--- /u.test(message.text);
	return (
		<article className={`transcript-entry ${expanded ? "is-expanded" : ""}`}>
			<button
				className="entry-toggle"
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((current) => !current)}
			>
				<span className="entry-chevron">
					<Icon name="chevron" size={11} />
				</span>
				<span>
					{message.command
						? `终端 · ${message.command}`
						: message.role === "tool"
							? `${message.isError ? "工具失败" : "工具结果"}${message.toolName ? ` · ${message.toolName}` : toolCall ? ` · ${toolCall.name}` : ""}`
							: "系统消息"}
				</span>
				{message.toolCallId ? <code className="tool-call-id">#{message.toolCallId.slice(-6)}</code> : null}
				{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
			</button>
			{expanded ? (
				<div className="entry-detail-wrap">
					{toolCall ? (
						<pre className="entry-tool-input">
							<code>{toolCall.input}</code>
						</pre>
					) : null}
					<pre className={`entry-detail ${message.isError ? "is-error" : ""} ${isDiff ? "is-diff" : ""}`}>
						<code>
							{isDiff
								? message.text.split("\n").map((line, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定
										<span className={transcriptDiffLineClass(line)} key={index}>
											{line || " "}
											{"\n"}
										</span>
									))
								: message.text || "…"}
						</code>
						{message.command ? (
							<small>
								{message.cancelled ? "已取消" : `退出码 ${message.exitCode ?? "未知"}`}
								{message.truncated ? " · 输出已截断" : ""}
							</small>
						) : null}
					</pre>
					<div className="entry-detail-actions">
						<button type="button" onClick={() => void copyOutput()} disabled={!message.text}>
							{copied ? "已复制" : "复制输出"}
						</button>
						{message.truncated ? <span>输出已截断</span> : null}
					</div>
				</div>
			) : null}
		</article>
	);
});

interface AuthenticationPromptCardProps {
	prompt: DesktopAuthenticationPrompt;
	resolving: boolean;
	response: string;
	onChange: (response: string) => void;
	onSubmit: (id: string, response: string) => Promise<void>;
}

const AuthenticationPromptCard = memo(function AuthenticationPromptCard({
	prompt,
	resolving,
	response,
	onChange,
	onSubmit,
}: AuthenticationPromptCardProps) {
	const isSelection = prompt.type === "select";
	return (
		<form
			className="authentication-card"
			onSubmit={(event) => {
				event.preventDefault();
				void onSubmit(prompt.id, response);
			}}
		>
			<div className="card-heading">
				<div>
					<p className="section-kicker">模型配置</p>
					<h3>{prompt.message}</h3>
				</div>
				<span className="card-id">{prompt.type.replaceAll("_", " ")}</span>
			</div>
			{isSelection ? (
				<select disabled={resolving} value={response} onChange={(event) => onChange(event.target.value)}>
					{prompt.options?.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
			) : (
				<input
					disabled={resolving}
					placeholder={prompt.placeholder}
					type={prompt.type === "secret" ? "password" : "text"}
					value={response}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
			<button className="accent-button" type="submit" disabled={resolving}>
				{resolving ? "处理中" : "继续"}
			</button>
		</form>
	);
});

interface ExplorerProps {
	entries: DesktopWorkspaceEntry[];
	error: string | undefined;
	isLoading: boolean;
	isTrusted: boolean;
	selectedPath: string | undefined;
	workspacePath: string | undefined;
	onChooseWorkspace: () => void;
	onOpenFile: (entry: DesktopWorkspaceEntry) => void;
	onRefresh: () => void;
	onTrustProject: () => void;
}

function Explorer({
	entries,
	error,
	isLoading,
	isTrusted,
	selectedPath,
	workspacePath,
	onChooseWorkspace,
	onOpenFile,
	onRefresh,
	onTrustProject,
}: ExplorerProps) {
	const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState("");
	const [gitChanges, setGitChanges] = useState<DesktopGitChange[]>([]);

	useEffect(() => {
		if (!workspacePath || !isTrusted) {
			setGitChanges([]);
			return;
		}
		let cancelled = false;
		void listGitChanges().then(
			(changes) => {
				if (!cancelled) setGitChanges(changes);
			},
			() => {
				if (!cancelled) setGitChanges([]);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [workspacePath, isTrusted]);

	const gitStatusByPath = useMemo(
		() => new Map(gitChanges.map((change) => [change.path, change.status])),
		[gitChanges],
	);
	const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
	const visibleEntries = useMemo(() => {
		if (normalizedSearch) {
			return entries.filter(
				(entry) => entry.type === "file" && entry.path.toLocaleLowerCase().includes(normalizedSearch),
			);
		}
		if (collapsedDirectories.size === 0) return entries;
		return entries.filter((entry) => {
			const segments = entry.path.split("/");
			for (let index = 1; index < segments.length; index += 1) {
				if (collapsedDirectories.has(segments.slice(0, index).join("/"))) return false;
			}
			return true;
		});
	}, [entries, collapsedDirectories, normalizedSearch]);

	function toggleDirectory(path: string): void {
		setCollapsedDirectories((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	if (!workspacePath)
		return (
			<div className="sidebar-empty">
				<Icon name="folder" size={22} />
				<strong>打开项目</strong>
				<p>选择本地文件夹后即可开始 Pi 会话。</p>
				<button className="outline-button" type="button" onClick={onChooseWorkspace}>
					选择文件夹
				</button>
			</div>
		);
	if (!isTrusted)
		return (
			<div className="sidebar-empty">
				<span className="lock-mark">⌁</span>
				<strong>文件浏览已锁定</strong>
				<p>信任该项目后，Pi 桌面端才会读取项目文件。</p>
				<button className="outline-button" type="button" onClick={onTrustProject}>
					信任项目
				</button>
			</div>
		);
	return (
		<div className="explorer-body">
			<div className="sidebar-section-title">
				<span>文件</span>
				<button className="icon-button compact" type="button" aria-label="刷新文件" onClick={onRefresh}>
					↻
				</button>
			</div>
			<label className="file-search">
				<Icon name="search" size={13} />
				<input
					type="search"
					value={searchQuery}
					placeholder="按路径搜索文件"
					onChange={(event) => setSearchQuery(event.target.value)}
				/>
			</label>
			{error ? <p className="sidebar-error">{error}</p> : null}
			{isLoading ? <p className="sidebar-loading">正在读取项目文件…</p> : null}
			<div className="file-list">
				{visibleEntries.map((entry) =>
					isFileEntry(entry) ? (
						<button
							className={`tree-entry file-entry ${selectedPath === entry.path ? "is-selected" : ""}`}
							key={entry.path}
							style={{ "--entry-depth": entry.depth } as CSSProperties}
							type="button"
							onClick={() => onOpenFile(entry)}
						>
							<span className="tree-file-icon">
								<Icon name={fileIconFor(entry.path)} size={13} />
							</span>
							<span className="tree-entry-name">{normalizedSearch ? entry.path : entry.name}</span>
							{gitStatusByPath.get(entry.path) ? (
								<span className={`tree-git-status is-${gitStatusByPath.get(entry.path)}`}>
									{gitStatusByPath.get(entry.path)?.slice(0, 1).toUpperCase()}
								</span>
							) : null}
						</button>
					) : (
						<button
							className={`tree-entry directory-entry ${collapsedDirectories.has(entry.path) ? "is-collapsed" : ""}`}
							key={entry.path}
							style={{ "--entry-depth": entry.depth } as CSSProperties}
							type="button"
							onClick={() => toggleDirectory(entry.path)}
						>
							<span className="tree-chevron">
								<Icon name="chevron" size={12} />
							</span>
							<Icon name="folder" size={14} />
							<span>{entry.name}</span>
						</button>
					),
				)}
				{normalizedSearch && visibleEntries.length === 0 ? (
					<p className="sidebar-loading">没有匹配的文件。</p>
				) : null}
			</div>
		</div>
	);
}

interface FileTab {
	path: string;
	preview: DesktopWorkspaceFilePreview;
}

function Inspector({
	tabs,
	activeTabPath,
	onSelectTab,
	onCloseTab,
	onClose,
	onOpenFile,
	onRevealFile,
	onQuoteLine,
}: {
	tabs: FileTab[];
	activeTabPath: string | undefined;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onClose: () => void;
	onOpenFile: (path: string) => void;
	onRevealFile: (path: string) => void;
	onQuoteLine: (path: string, line: number) => void;
}) {
	const [mode, setMode] = useState<"preview" | "source">("source");
	const [contentQuery, setContentQuery] = useState("");
	const activeTab = tabs.find((tab) => tab.path === activeTabPath);
	const preview = activeTab?.preview;
	const isPreviewable = preview ? isMarkdownFile(preview.path) : false;
	const isImage = preview ? preview.imageDataUrl !== undefined : false;
	const isAudio = preview ? preview.audioDataUrl !== undefined : false;
	const previewPath = preview?.path;

	useEffect(() => {
		setMode(isMarkdownFile(previewPath ?? "") ? "preview" : "source");
	}, [previewPath]);

	const lineCount = preview ? preview.content.split(/\r\n|\r|\n/u).length : 0;
	const sourceLines = useMemo(() => {
		if (!preview) return [];
		const query = contentQuery.trim().toLocaleLowerCase();
		return preview.content.split(/\r\n|\r|\n/u).map((text, index) => ({
			text,
			line: index + 1,
			match: query.length > 0 && text.toLocaleLowerCase().includes(query),
		}));
	}, [preview, contentQuery]);
	const byteSize = preview ? new TextEncoder().encode(preview.content).length : 0;

	return (
		<aside className="inspector" aria-label="文件预览">
			{tabs.length > 0 ? (
				<div className="file-tab-bar" role="tablist" aria-label="已打开文件">
					{tabs.map((tab) => (
						<div
							key={tab.path}
							role="tab"
							aria-selected={tab.path === activeTabPath}
							tabIndex={tab.path === activeTabPath ? 0 : -1}
							className={`file-tab ${tab.path === activeTabPath ? "is-active" : ""}`}
							title={tab.path}
							onClick={() => onSelectTab(tab.path)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onSelectTab(tab.path);
								}
							}}
						>
							<span>{tab.path.split("/").at(-1) ?? tab.path}</span>
							<button
								type="button"
								aria-label={`关闭 ${tab.path}`}
								onClick={(event) => {
									event.stopPropagation();
									onCloseTab(tab.path);
								}}
							>
								<Icon name="close" size={12} />
							</button>
						</div>
					))}
				</div>
			) : null}
			<div className="inspector-header">
				<div className="inspector-title">
					<p className="section-kicker">预览</p>
					<strong>{preview?.path ?? "未选择文件"}</strong>
					{preview ? (
						<small className="inspector-meta">
							{isImage
								? getFileKindLabel(preview.path)
								: `${getFileKindLabel(preview.path)} · ${lineCount} 行 · ${formatByteSize(byteSize)}`}
						</small>
					) : null}
				</div>
				<div className="inspector-header-actions">
					{preview && isPreviewable ? (
						<div className="inspector-segmented" role="tablist" aria-label="显示模式">
							<button
								aria-pressed={mode === "source"}
								className={mode === "source" ? "is-active" : ""}
								type="button"
								onClick={() => setMode("source")}
							>
								源码
							</button>
							<button
								aria-pressed={mode === "preview"}
								className={mode === "preview" ? "is-active" : ""}
								type="button"
								onClick={() => setMode("preview")}
							>
								预览
							</button>
						</div>
					) : null}
					{preview ? (
						<button
							className="icon-button"
							type="button"
							aria-label="用默认应用打开"
							onClick={() => onOpenFile(preview.path)}
						>
							<Icon name="external" size={16} />
						</button>
					) : null}
					{preview ? (
						<button
							className="icon-button"
							type="button"
							aria-label="在文件管理器中显示"
							onClick={() => onRevealFile(preview.path)}
						>
							<Icon name="folder" size={16} />
						</button>
					) : null}
					<button className="icon-button" type="button" aria-label="关闭预览" onClick={onClose}>
						<Icon name="close" size={16} />
					</button>
				</div>
			</div>
			{preview && !isImage && !isAudio && mode === "source" ? (
				<label className="content-search">
					<Icon name="search" size={13} />
					<input
						type="search"
						value={contentQuery}
						placeholder="搜索文件内容"
						onChange={(event) => setContentQuery(event.target.value)}
					/>
				</label>
			) : null}
			{preview ? (
				isImage ? (
					<div className="file-image-preview">
						<img src={preview.imageDataUrl} alt={preview.path} />
					</div>
				) : isAudio ? (
					<div className="file-audio-preview">
						{/* biome-ignore lint/a11y/useMediaCaption: 音频文件预览，无字幕轨可提供 */}
						<audio controls src={preview.audioDataUrl} aria-label={`音频预览：${preview.path}`} />
					</div>
				) : mode === "preview" && isPreviewable ? (
					<div className="file-preview-rendered">
						<MarkdownBody text={preview.content} />
					</div>
				) : (
					<div className="file-preview-source">
						{sourceLines.map((sourceLine) => (
							<button
								className={`source-line ${sourceLine.match ? "is-match" : ""}`}
								key={sourceLine.line}
								type="button"
								onClick={() => onQuoteLine(preview.path, sourceLine.line)}
							>
								<span className="source-line-number">{sourceLine.line}</span>
								<code>
									<HighlightedCode code={sourceLine.text || " "} language={getLanguageForPath(preview.path)} />
								</code>
							</button>
						))}
					</div>
				)
			) : (
				<div className="inspector-empty">
					<Icon name="panel" size={22} />
					<p>选择已信任项目中的文件，即可在这里预览。</p>
				</div>
			)}
		</aside>
	);
}

export function App() {
	const snapshot = useSyncExternalStore(subscribeDesktopSnapshot, getDesktopSnapshot, getDesktopSnapshot);
	const startupError = getDesktopStartupError();
	const [language, setLanguage] = useState<AppLanguage>(() =>
		localStorage.getItem("pi-desktop-language") === "en" ? "en" : "zh-CN",
	);
	const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
	const [theme, setTheme] = useState<"dark" | "light" | "system">(() => {
		const stored = localStorage.getItem("pi-desktop-theme");
		return stored === "light" || stored === "dark" ? stored : "system";
	});
	const [sidebarWidth, setSidebarWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-sidebar-width")) || 260,
	);
	const [inspectorWidth, setInspectorWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-inspector-width")) || 440,
	);
	const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-notify-complete") !== "off",
	);
	const [soundOnComplete, setSoundOnComplete] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-sound-complete") !== "off",
	);
	const [fileTreeOpen, setFileTreeOpen] = useState(() => localStorage.getItem("pi-desktop-file-tree-open") !== "off");
	const [fileTreeWidth, setFileTreeWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-file-tree-width")) || 280,
	);
	const [trustDialogOpen, setTrustDialogOpen] = useState(false);
	const [changesCollapsed, setChangesCollapsed] = useState(true);
	const [draft, setDraft] = useState("");
	const [openingWorkspace, setOpeningWorkspace] = useState(false);
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
		try {
			const value: unknown = JSON.parse(localStorage.getItem("pi-desktop-recent-workspaces") ?? "[]");
			return Array.isArray(value)
				? value.filter((path): path is string => typeof path === "string").slice(0, 8)
				: [];
		} catch {
			return [];
		}
	});
	const [submitting, setSubmitting] = useState(false);
	const [aborting, setAborting] = useState(false);
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	const [unseenMessages, setUnseenMessages] = useState(0);
	const [changingTrust, setChangingTrust] = useState(false);
	const [settingUpProvider, setSettingUpProvider] = useState(false);
	const [settingModel, setSettingModel] = useState(false);
	const [choosingImages, setChoosingImages] = useState(false);
	const [draggingImages, setDraggingImages] = useState(false);
	const [attachments, setAttachments] = useState<DesktopImageAttachment[]>([]);
	const [selectedProviderId, setSelectedProviderId] = useState("");
	const [authenticationResponse, setAuthenticationResponse] = useState("");
	const [respondingToAuthenticationPromptId, setRespondingToAuthenticationPromptId] = useState<string>();
	const [resolvingApprovalId, setResolvingApprovalId] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [workspaceEntries, setWorkspaceEntries] = useState<DesktopWorkspaceEntry[]>([]);
	const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | undefined>();
	const [fileExplorerError, setFileExplorerError] = useState<string>();
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [loadingFilePath, setLoadingFilePath] = useState<string>();
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [statsOpen, setStatsOpen] = useState(false);
	const [configModal, setConfigModal] = useState<ConfigModal | undefined>();
	const [branchMenuOpen, setBranchMenuOpen] = useState(false);
	const [topMoreOpen, setTopMoreOpen] = useState(false);
	const [sessionSearch, setSessionSearch] = useState("");
	const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
	const [composerMenu, setComposerMenu] = useState<"model" | "thinking" | "tools" | undefined>();
	const [toolPreset, setToolPreset] = useState<"off" | "default" | "full">(
		() => (localStorage.getItem("pi-desktop-tool-preset") as "off" | "default" | "full" | null) ?? "default",
	);
	const [compacting, setCompacting] = useState(false);
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const fileRequestId = useRef(0);
	const chatScrollRef = useRef<HTMLDivElement>(null);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const stickToBottomRef = useRef(true);
	const previousMessageSignatureRef = useRef("");
	const previousSessionIdRef = useRef<string | undefined>(undefined);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const promptHistoryRef = useRef<string[]>([]);
	const promptHistoryIndexRef = useRef(-1);
	const draftBeforeHistoryRef = useRef("");
	const previousPhaseRef = useRef<DesktopSessionPhase | undefined>(undefined);
	const apiKeyProviderIds = snapshot.apiKeyProviders.map((provider) => provider.id).join("\u0000");
	const authenticationPrompt = snapshot.pendingAuthenticationPrompts[0];
	const session = snapshot.session;
	const draftKey = `${DRAFT_STORAGE_PREFIX}${session?.id ?? snapshot.workspacePath ?? "new"}`;
	const lastMessage = session?.messages.at(-1);
	const messageSignature = `${session?.id ?? ""}:${session?.messages.length ?? 0}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}`;
	const transcriptItems = useMemo(() => partitionTranscript(session?.messages ?? []), [session?.messages]);
	const conversationTurns = useMemo(() => buildConversationTurns(session?.messages ?? []), [session?.messages]);
	const canSubmit =
		!submitting &&
		!aborting &&
		!openingWorkspace &&
		!changingTrust &&
		!settingUpProvider &&
		!snapshot.providerSetupInProgress &&
		!!session &&
		(draft.trim().length > 0 || attachments.length > 0);
	const canChooseWorkspace = !openingWorkspace && !settingUpProvider && !snapshot.providerSetupInProgress;
	const canStartProviderSetup =
		!openingWorkspace &&
		!settingUpProvider &&
		!changingTrust &&
		!snapshot.providerSetupInProgress &&
		session?.phase !== "running" &&
		!!selectedProviderId;
	const canSetModel =
		!openingWorkspace &&
		!changingTrust &&
		!settingUpProvider &&
		!settingModel &&
		!snapshot.providerSetupInProgress &&
		!!session &&
		session.phase !== "running";
	const slashQuery = draft.trimStart().startsWith("/") ? draft.trimStart().slice(1).toLocaleLowerCase() : "";
	const slashCommands = [
		{ name: "help", description: "显示桌面端可用命令" },
		{ name: "model", description: "打开具体模型选择" },
		{ name: "login", description: "配置模型服务商" },
		{ name: "project", description: "打开项目文件夹" },
		{ name: "files", description: "打开文件浏览" },
		{ name: "settings", description: "打开设置" },
		{ name: "skills", description: "打开技能列表" },
		{ name: "plugins", description: "打开插件列表" },
		{ name: "trust", description: "切换当前项目的信任状态" },
		...snapshot.skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
		...snapshot.plugins.flatMap((plugin) =>
			plugin.commands.map((command) => ({ name: command, description: `插件 ${plugin.name}` })),
		),
	].filter((command) => command.name.toLocaleLowerCase().startsWith(slashQuery));
	const atQuery = draft.trimStart().startsWith("@") ? draft.trimStart().slice(1).toLocaleLowerCase() : "";
	const atFiles = atQuery
		? workspaceEntries
				.filter(isFileEntry)
				.filter((entry) => entry.path.toLocaleLowerCase().includes(atQuery))
				.slice(0, 8)
		: [];
	const hashQuery = draft.trimStart().startsWith("#") ? draft.trimStart().slice(1).toLocaleLowerCase() : "";
	const hashSessions = hashQuery
		? snapshot.sessions
				.filter((item) => `${item.name ?? ""} ${item.firstMessage}`.toLocaleLowerCase().includes(hashQuery))
				.slice(0, 8)
		: [];
	const visibleSlashCommands = slashCommands.slice(0, 8);
	const suggestionCount = slashQuery
		? visibleSlashCommands.length
		: hashQuery
			? hashSessions.length
			: atQuery
				? atFiles.length
				: 0;

	useEffect(() => {
		void startDesktopStore();
	}, []);
	useEffect(() => {
		setDraft(localStorage.getItem(draftKey) ?? "");
		setAttachments([]);
	}, [draftKey]);
	useEffect(() => {
		localStorage.setItem(draftKey, draft);
	}, [draft, draftKey]);
	function resizePrompt(textarea: HTMLTextAreaElement): void {
		textarea.style.height = "auto";
		textarea.style.height = textarea.value ? `${Math.min(textarea.scrollHeight, 180)}px` : "24px";
	}
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				promptRef.current?.focus();
			} else if (event.key.toLowerCase() === "n") {
				event.preventDefault();
				void newSession();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setComposerMenu(undefined);
			setBranchMenuOpen(false);
			setStatsOpen(false);
			setTopMoreOpen(false);
		};
		window.addEventListener("keydown", onEscape);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keydown", onEscape);
		};
	}, []);
	useEffect(() => {
		localStorage.setItem("pi-desktop-language", language);
		document.documentElement.lang = language;
	}, [language]);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
		};
		apply();
		localStorage.setItem("pi-desktop-theme", theme);
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-file-tree-open", fileTreeOpen ? "on" : "off");
	}, [fileTreeOpen]);
	useEffect(() => {
		if (!snapshot.workspacePath) return;
		setRecentWorkspaces((current) => {
			const next = [
				snapshot.workspacePath as string,
				...current.filter((path) => path !== snapshot.workspacePath),
			].slice(0, 8);
			localStorage.setItem("pi-desktop-recent-workspaces", JSON.stringify(next));
			return next;
		});
	}, [snapshot.workspacePath]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-notify-complete", notifyOnComplete ? "on" : "off");
		localStorage.setItem("pi-desktop-sound-complete", soundOnComplete ? "on" : "off");
	}, [notifyOnComplete, soundOnComplete]);
	useEffect(() => {
		const phase = session?.phase;
		if (previousPhaseRef.current === "running" && phase === "idle") {
			if (soundOnComplete) playCompletionTone();
			if (notifyOnComplete && !document.hasFocus()) void notifyComplete();
		}
		previousPhaseRef.current = phase;
	}, [session?.phase, notifyOnComplete, soundOnComplete]);
	useEffect(() => {
		const scroll = chatScrollRef.current;
		if (!scroll) return;
		if (previousSessionIdRef.current !== session?.id) {
			previousSessionIdRef.current = session?.id;
			previousMessageSignatureRef.current = messageSignature;
			scroll.scrollTop = scroll.scrollHeight;
			stickToBottomRef.current = true;
			setAwayFromBottom(false);
			setUnseenMessages(0);
			return;
		}
		if (previousMessageSignatureRef.current && previousMessageSignatureRef.current !== messageSignature) {
			if (stickToBottomRef.current) {
				scroll.scrollTo({ top: scroll.scrollHeight, behavior: session?.phase === "running" ? "auto" : "smooth" });
			} else {
				setUnseenMessages((count) => count + 1);
			}
		}
		previousMessageSignatureRef.current = messageSignature;
	}, [messageSignature, session?.id, session?.phase]);
	useEffect(
		() => () => {
			if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current);
		},
		[],
	);
	useEffect(() => {
		const providerIds = apiKeyProviderIds ? apiKeyProviderIds.split("\u0000") : [];
		if (!providerIds.includes(selectedProviderId)) setSelectedProviderId(providerIds[0] ?? "");
	}, [apiKeyProviderIds, selectedProviderId]);
	useEffect(() => {
		if (!authenticationPrompt) {
			setAuthenticationResponse("");
			return;
		}
		setAuthenticationResponse(
			authenticationPrompt.type === "select" ? (authenticationPrompt.options?.[0]?.id ?? "") : "",
		);
	}, [authenticationPrompt]);

	const refreshWorkspaceFiles = useCallback(async () => {
		const requestId = ++fileRequestId.current;
		setLoadingFiles(true);
		setFileExplorerError(undefined);
		try {
			const entries = await listWorkspaceFiles();
			if (requestId === fileRequestId.current) setWorkspaceEntries(entries);
		} catch (error) {
			if (requestId === fileRequestId.current)
				setFileExplorerError(error instanceof Error ? error.message : String(error));
		} finally {
			if (requestId === fileRequestId.current) setLoadingFiles(false);
		}
	}, []);

	useEffect(() => {
		fileRequestId.current += 1;
		setWorkspaceEntries([]);
		setFileTabs([]);
		setActiveTabPath(undefined);
		setFileExplorerError(undefined);
		if (snapshot.projectTrusted && snapshot.workspacePath) void refreshWorkspaceFiles();
	}, [refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath]);
	useEffect(() => {
		if (atQuery && snapshot.projectTrusted && snapshot.workspacePath && workspaceEntries.length === 0) {
			void refreshWorkspaceFiles();
		}
	}, [atQuery, refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath, workspaceEntries.length]);

	function handleChatScroll(): void {
		if (scrollFrameRef.current !== undefined) return;
		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = undefined;
			const scroll = chatScrollRef.current;
			if (!scroll) return;
			const isAway = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80;
			stickToBottomRef.current = !isAway;
			setAwayFromBottom((current) => (current === isAway ? current : isAway));
			if (!isAway) setUnseenMessages(0);
		});
	}

	function scrollToLatest(): void {
		const scroll = chatScrollRef.current;
		if (!scroll) return;
		stickToBottomRef.current = true;
		setAwayFromBottom(false);
		setUnseenMessages(0);
		scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
	}

	async function handleChooseWorkspace(): Promise<void> {
		if (!canChooseWorkspace) return;
		setOpeningWorkspace(true);
		setActionError(undefined);
		try {
			await chooseWorkspace();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setOpeningWorkspace(false);
		}
	}

	async function handleNewSession(): Promise<void> {
		if (!snapshot.workspacePath) {
			promptRef.current?.focus();
			return;
		}
		setActionError(undefined);
		try {
			await newSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleSwitchWorkspacePath(path: string): Promise<void> {
		setActionError(undefined);
		try {
			await openWorkspacePath(path);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleOpenSession(sessionPath: string): Promise<void> {
		setActionError(undefined);
		try {
			await openSession({ sessionPath });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleNavigateTree(entryId: string): Promise<void> {
		setBranchMenuOpen(false);
		setActionError(undefined);
		try {
			await navigateTree({ entryId });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleForkSession(): Promise<void> {
		setBranchMenuOpen(false);
		setActionError(undefined);
		try {
			await forkSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	function selectComposerSuggestion(index: number): void {
		if (slashQuery) {
			const command = visibleSlashCommands[index];
			if (!command) return;
			setDraft(`/${command.name}${command.name === "model" || command.name === "login" ? " " : ""}`);
		} else if (hashQuery) {
			const item = hashSessions[index];
			if (!item) return;
			setDraft((current) => current.replace(/#[^\s]*$/u, `#${item.name ?? item.firstMessage.slice(0, 40)} `));
		} else if (atQuery) {
			const file = atFiles[index];
			if (!file) return;
			setDraft((current) => current.replace(/@[^\s]*$/u, `@${file.path} `));
		}
		promptRef.current?.focus();
	}

	function rememberPrompt(text: string): void {
		const normalized = text.trim();
		if (!normalized) return;
		promptHistoryRef.current = [...promptHistoryRef.current.filter((item) => item !== normalized), normalized].slice(
			-50,
		);
		promptHistoryIndexRef.current = -1;
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;
		rememberPrompt(draft);
		if (await handleDesktopSlashCommand(draft)) {
			startTransition(() => setDraft(""));
			return;
		}
		setSubmitting(true);
		setActionError(undefined);
		try {
			await submitPrompt(
				draft,
				attachments.map((attachment) => attachment.id),
				session?.phase === "running" ? "followUp" : undefined,
			);
			startTransition(() => {
				setAttachments([]);
				setDraft("");
				localStorage.removeItem(draftKey);
			});
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmitting(false);
		}
	}

	async function handleSteer(): Promise<void> {
		if (!canSubmit || session?.phase !== "running") return;
		rememberPrompt(draft);
		setSubmitting(true);
		setActionError(undefined);
		try {
			await submitPrompt(
				draft,
				attachments.map((attachment) => attachment.id),
				"steer",
			);
			startTransition(() => {
				setAttachments([]);
				setDraft("");
				localStorage.removeItem(draftKey);
			});
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmitting(false);
		}
	}

	async function handleAbort(): Promise<void> {
		if (session?.phase !== "running" || aborting) return;
		setAborting(true);
		setActionError(undefined);
		try {
			await abortSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setAborting(false);
		}
	}

	async function handleProjectTrust(): Promise<void> {
		const nextTrusted = !snapshot.projectTrusted;
		if (nextTrusted) {
			setTrustDialogOpen(true);
			return;
		}
		setChangingTrust(true);
		setActionError(undefined);
		try {
			await setProjectTrust(false);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setChangingTrust(false);
		}
	}

	async function confirmProjectTrust(): Promise<void> {
		setChangingTrust(true);
		setActionError(undefined);
		try {
			await setProjectTrust(true);
			setTrustDialogOpen(false);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setChangingTrust(false);
		}
	}

	const handleToolApproval = useCallback(async (id: string, approved: boolean): Promise<void> => {
		setResolvingApprovalId(id);
		setActionError(undefined);
		try {
			await decideToolApproval({ id, approved });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setResolvingApprovalId(undefined);
		}
	}, []);

	async function beginProviderSetup(providerId: string, authType: "api_key" | "oauth" = "api_key"): Promise<void> {
		if (!providerId || !canStartProviderSetup) return;
		setSettingUpProvider(true);
		setActionError(undefined);
		try {
			await startProviderSetup({ providerId, authType });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSettingUpProvider(false);
		}
	}

	async function handleChangeModel(modelKey: string): Promise<void> {
		const separatorIndex = modelKey.indexOf("\u0000");
		if (!canSetModel || separatorIndex < 1 || separatorIndex === modelKey.length - 1) return;
		const provider = modelKey.slice(0, separatorIndex);
		const modelId = modelKey.slice(separatorIndex + 1);
		setSettingModel(true);
		setActionError(undefined);
		try {
			await setModel({ provider, modelId });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSettingModel(false);
		}
	}

	async function handleChangeThinking(
		level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	): Promise<void> {
		if (!session || session.phase === "running" || session.thinkingLevel === level) return;
		setComposerMenu(undefined);
		try {
			await setThinkingLevel(level);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleCompact(): Promise<void> {
		if (!session || session.phase === "running" || compacting) return;
		setCompacting(true);
		setActionError(undefined);
		try {
			await compactSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setCompacting(false);
		}
	}

	function handleToolPresetChange(next: "off" | "default" | "full"): void {
		setToolPreset(next);
		localStorage.setItem("pi-desktop-tool-preset", next);
		setComposerMenu(undefined);
	}

	async function handleDroppedImages(files: File[]): Promise<void> {
		if (!files.length) return;
		setChoosingImages(true);
		setActionError(undefined);
		try {
			setAttachments(await attachDroppedImages(files));
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setChoosingImages(false);
			setDraggingImages(false);
		}
	}

	async function handleChooseImages(): Promise<void> {
		if (choosingImages || !session || session.phase === "running") return;
		setChoosingImages(true);
		setActionError(undefined);
		try {
			setAttachments(await chooseImages());
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setChoosingImages(false);
		}
	}

	async function handleDesktopSlashCommand(text: string): Promise<boolean> {
		if (!text.trimStart().startsWith("/")) return false;
		const [command = "", argument = ""] = text.trimStart().slice(1).trim().split(/\s+/u, 2);
		if (command === "help") {
			setActionError(
				"可用命令：/model、/login、/project、/files、/settings、/skills、/plugins、/trust；技能和插件命令可直接执行。",
			);
			return true;
		}
		if (command === "model") {
			if (argument) {
				const separatorIndex = argument.indexOf("/");
				if (separatorIndex > 0 && separatorIndex < argument.length - 1) {
					await handleChangeModel(
						getModelKey(argument.slice(0, separatorIndex), argument.slice(separatorIndex + 1)),
					);
					return true;
				}
			}
			setConfigModal("models");
			return true;
		}
		if (command === "login") {
			if (argument && snapshot.apiKeyProviders.some((provider) => provider.id === argument)) {
				setSelectedProviderId(argument);
				await beginProviderSetup(argument);
			} else {
				setConfigModal("models");
			}
			return true;
		}
		if (command === "project") {
			await handleChooseWorkspace();
			return true;
		}
		if (command === "files") {
			setInspectorOpen(true);
			setFileTreeOpen(true);
			return true;
		}
		if (command === "settings" || command === "skills" || command === "plugins") {
			setConfigModal(command);
			return true;
		}
		if (command === "trust") {
			if (!snapshot.workspacePath) {
				setActionError("请先打开项目，才能修改项目信任状态。");
			} else {
				await handleProjectTrust();
			}
			return true;
		}
		return false;
	}

	const handleAuthenticationPrompt = useCallback(async (id: string, response: string): Promise<void> => {
		setRespondingToAuthenticationPromptId(id);
		setActionError(undefined);
		try {
			await respondToAuthenticationPrompt({ id, response });
			setAuthenticationResponse("");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setRespondingToAuthenticationPromptId(undefined);
		}
	}, []);

	const handleOpenFile = useCallback(async (entry: DesktopWorkspaceEntry): Promise<void> => {
		if (!isFileEntry(entry)) return;
		const requestId = ++fileRequestId.current;
		setLoadingFilePath(entry.path);
		setFileExplorerError(undefined);
		try {
			const preview = await readWorkspaceFile(entry.path);
			if (requestId === fileRequestId.current) {
				setFileTabs((tabs) => {
					if (tabs.some((tab) => tab.path === preview.path)) return tabs;
					return [...tabs, { path: preview.path, preview }];
				});
				setActiveTabPath(preview.path);
				setInspectorOpen(true);
			}
		} catch (error) {
			if (requestId === fileRequestId.current) {
				setFileExplorerError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			if (requestId === fileRequestId.current) setLoadingFilePath(undefined);
		}
	}, []);

	const handleCloseTab = useCallback(
		(path: string): void => {
			setFileTabs((tabs) => {
				const index = tabs.findIndex((tab) => tab.path === path);
				if (index < 0) return tabs;
				const next = tabs.filter((tab) => tab.path !== path);
				if (activeTabPath === path) {
					const neighbor = next[Math.min(index, next.length - 1)];
					setActiveTabPath(neighbor?.path);
				}
				if (next.length === 0) setInspectorOpen(false);
				return next;
			});
		},
		[activeTabPath],
	);

	const handleOpenFileWithDefaultApp = useCallback(async (path: string): Promise<void> => {
		setActionError(undefined);
		try {
			await openWorkspaceFile(path);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const handleEditMessage = useCallback((text: string): void => {
		setDraft(text);
		requestAnimationFrame(() => {
			const prompt = promptRef.current;
			if (!prompt) return;
			prompt.focus();
			prompt.setSelectionRange(text.length, text.length);
			prompt.style.height = "0px";
			prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`;
		});
	}, []);

	const handleForkFromMessage = useCallback(async (entryId: string): Promise<void> => {
		setActionError(undefined);
		try {
			await navigateTree({ entryId });
			await forkSession();
			setBranchMenuOpen(false);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const handleQuoteLine = useCallback((path: string, line: number): void => {
		setDraft((current) => `${current}${current ? "\n" : ""}@${path}:${line} `);
		promptRef.current?.focus();
	}, []);

	const handleRevealFile = useCallback(async (path: string): Promise<void> => {
		setActionError(undefined);
		try {
			await revealWorkspaceFile(path);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	function beginResize(side: "sidebar" | "inspector" | "file-tree", startX: number): void {
		const startWidth = side === "sidebar" ? sidebarWidth : side === "inspector" ? inspectorWidth : fileTreeWidth;
		const min = side === "sidebar" ? 220 : side === "inspector" ? 300 : 220;
		const max = side === "sidebar" ? 420 : side === "inspector" ? 760 : 520;
		const variable =
			side === "sidebar" ? "--sidebar-width" : side === "inspector" ? "--inspector-width" : "--file-tree-width";
		const resolveWidth = (clientX: number) =>
			Math.round(
				Math.max(min, Math.min(max, startWidth + (side === "sidebar" ? clientX - startX : startX - clientX))),
			);
		const handleMove = (event: PointerEvent) =>
			document.documentElement.style.setProperty(variable, `${resolveWidth(event.clientX)}px`);
		const handleUp = (event: PointerEvent) => {
			const width = resolveWidth(event.clientX);
			if (side === "sidebar") setSidebarWidth(width);
			else if (side === "inspector") setInspectorWidth(width);
			else setFileTreeWidth(width);
			localStorage.setItem(
				side === "sidebar"
					? "pi-desktop-sidebar-width"
					: side === "inspector"
						? "pi-desktop-inspector-width"
						: "pi-desktop-file-tree-width",
				String(width),
			);
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
	}

	function resizeByKeyboard(side: "sidebar" | "inspector" | "file-tree", delta: number): void {
		const current = side === "sidebar" ? sidebarWidth : side === "inspector" ? inspectorWidth : fileTreeWidth;
		const min = side === "sidebar" ? 220 : side === "inspector" ? 300 : 220;
		const max = side === "sidebar" ? 420 : side === "inspector" ? 760 : 520;
		const variable =
			side === "sidebar" ? "--sidebar-width" : side === "inspector" ? "--inspector-width" : "--file-tree-width";
		const width = Math.max(min, Math.min(max, current + delta));
		document.documentElement.style.setProperty(variable, `${width}px`);
		if (side === "sidebar") setSidebarWidth(width);
		else if (side === "inspector") setInspectorWidth(width);
		else setFileTreeWidth(width);
		localStorage.setItem(
			side === "sidebar"
				? "pi-desktop-sidebar-width"
				: side === "inspector"
					? "pi-desktop-inspector-width"
					: "pi-desktop-file-tree-width",
			String(width),
		);
	}

	function renderSidebar() {
		const projects = new Map<string, DesktopSessionInfo[]>();
		for (const item of snapshot.sessions) {
			const root = item.cwd.replace(/[\\\\/]+$/, "");
			const entries = projects.get(root) ?? [];
			entries.push(item);
			projects.set(root, entries);
		}
		return (
			<section className="sessions-panel sidebar-project-tree" aria-label={t("sessions")}>
				{projects.size ? (
					[...projects.entries()].map(([root, items]) => {
						const filteredItems = sessionSearch.trim()
							? items.filter((item) =>
									`${item.name ?? ""} ${item.firstMessage}`
										.toLocaleLowerCase()
										.includes(sessionSearch.trim().toLocaleLowerCase()),
								)
							: items;
						if (sessionSearch.trim() && filteredItems.length === 0) return null;
						const active = items.some((item) => item.id === session?.id);
						const collapsed = collapsedProjects.has(root) && !sessionSearch.trim();
						const expanded = expandedProjects.has(root);
						const visibleItems = expanded || sessionSearch.trim() ? filteredItems : filteredItems.slice(0, 5);
						return (
							<section className={`sidebar-project-tree-group ${active ? "is-active" : ""}`} key={root}>
								<div className="sidebar-project-tree-row">
									<button
										className="sidebar-project-tree-row-main"
										type="button"
										onClick={() =>
											setCollapsedProjects((current) => {
												const next = new Set(current);
												if (next.has(root)) next.delete(root);
												else next.add(root);
												return next;
											})
										}
										title={root}
										aria-expanded={!collapsed}
									>
										<Icon name="folder" size={15} />
										<span className="sidebar-project-tree-name">{formatWorkspace(root)}</span>
										<span className="sidebar-project-tree-meta">{items.length}</span>
									</button>
									<button
										className="sidebar-project-tree-action"
										type="button"
										aria-label="新建会话"
										onClick={() => void handleNewSession()}
									>
										<Icon name="plus" size={13} />
									</button>
								</div>
								{!collapsed ? (
									<div className="sidebar-project-tree-children">
										{visibleItems.map((item) => {
											const isCurrent = item.id === session?.id;
											return (
												<button
													className={`session-row sidebar-session-tree-item ${isCurrent ? "is-current" : ""}`}
													key={item.path}
													type="button"
													title={`${sessionTitle(item)} · ${item.messageCount} · ${formatSessionDate(item.modified)}`}
													disabled={session?.phase === "running"}
													onClick={() =>
														isCurrent ? promptRef.current?.focus() : void handleOpenSession(item.path)
													}
												>
													<span
														className={`session-status ${isCurrent && session?.phase === "running" ? "is-running" : ""}`}
													/>
													<span>{sessionTitle(item)}</span>
												</button>
											);
										})}
										{!expanded && filteredItems.length > 5 ? (
											<button
												className="sidebar-more-button"
												type="button"
												onClick={() => setExpandedProjects((current) => new Set(current).add(root))}
											>
												显示更多 ({filteredItems.length - 5})
											</button>
										) : null}
										{expanded && filteredItems.length > 5 ? (
											<button
												className="sidebar-more-button"
												type="button"
												onClick={() =>
													setExpandedProjects((current) => {
														const next = new Set(current);
														next.delete(root);
														return next;
													})
												}
											>
												显示更少
											</button>
										) : null}
									</div>
								) : null}
							</section>
						);
					})
				) : (
					<button className="session-row is-current" type="button" onClick={() => promptRef.current?.focus()}>
						<span className="session-status" />
						<span>{session?.name ?? "新会话"}</span>
					</button>
				)}
			</section>
		);
	}

	const macOSClassName = navigator.userAgent.includes("Macintosh") ? "is-macos" : "";

	return (
		<main
			className={`app-workbench ${macOSClassName} ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-closed"} ${inspectorOpen ? "is-inspector-open" : ""}`}
			style={
				{
					"--sidebar-width": `${sidebarWidth}px`,
					"--inspector-width": `${inspectorWidth}px`,
					"--file-tree-width": `${fileTreeWidth}px`,
				} as CSSProperties
			}
		>
			<aside className="sidebar" aria-label="项目导航" aria-hidden={!sidebarOpen}>
				<header className="session-sidebar-header">
					<div className="sidebar-controls-row">
						<button
							className="sidebar-chrome-button"
							type="button"
							aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
							onClick={() => {
								const next = theme === "dark" ? "light" : "dark";
								const apply = () => {
									document.documentElement.dataset.theme = next;
									setTheme(next);
								};
								if (
									window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
									typeof document.startViewTransition !== "function"
								) {
									apply();
									return;
								}
								try {
									const transition = document.startViewTransition(apply);
									void transition.ready.catch(() => undefined);
									void transition.finished.catch(() => undefined);
								} catch {
									apply();
								}
							}}
						>
							<Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
						</button>
						<button
							className="sidebar-chrome-button"
							type="button"
							aria-label="隐藏侧栏"
							onClick={() => setSidebarOpen(false)}
						>
							<Icon name="panel" size={15} />
						</button>
					</div>
					<button
						className="new-chat-button"
						type="button"
						disabled={session?.phase === "running"}
						onClick={() => void handleNewSession()}
					>
						<Icon name="plus" size={16} />
						<span>{t("newChat")}</span>
					</button>
					<button
						className="project-switcher"
						disabled={!canChooseWorkspace}
						type="button"
						onClick={() => void handleChooseWorkspace()}
					>
						<Icon name="folder" size={16} />
						<span>
							<strong>{openingWorkspace ? "正在打开项目…" : formatWorkspace(snapshot.workspacePath)}</strong>
							<small>{snapshot.workspacePath ?? "选择本地文件夹"}</small>
						</span>
						<Icon name="chevron" size={15} />
					</button>
					{recentWorkspaces.length > 1 ? (
						<nav className="recent-workspaces" aria-label={t("recentProjects")}>
							{recentWorkspaces
								.filter((path) => path !== snapshot.workspacePath)
								.slice(0, 4)
								.map((path) => (
									<button
										type="button"
										key={path}
										title={path}
										disabled={session?.phase === "running"}
										onClick={() => void handleSwitchWorkspacePath(path)}
									>
										<Icon name="folder" size={12} />
										<span>{formatWorkspace(path)}</span>
									</button>
								))}
						</nav>
					) : null}
					{snapshot.workspacePath ? (
						<WorktreeSelector
							key={snapshot.workspacePath}
							workspacePath={snapshot.workspacePath}
							onSwitch={(path) => void handleSwitchWorkspacePath(path)}
						/>
					) : null}
				</header>
				<div className="sidebar-section-title sidebar-project-label">
					<span>{t("sessions")}</span>
					<small>{snapshot.sessions.length}</small>
				</div>
				<div className="sidebar-search-wrap">
					<input
						aria-label="搜索会话"
						placeholder="搜索会话"
						value={sessionSearch}
						onChange={(event) => setSessionSearch(event.target.value)}
					/>
					{sessionSearch ? (
						<button type="button" aria-label="清除搜索" onClick={() => setSessionSearch("")}>
							×
						</button>
					) : null}
				</div>
				<div className="sidebar-content">{renderSidebar()}</div>
				<footer className="sidebar-footer">
					<button className="footer-button" type="button" onClick={() => setConfigModal("models")}>
						<Icon name="model" size={15} />
						<span>{t("models")}</span>
					</button>
					<button className="footer-button" type="button" onClick={() => setConfigModal("skills")}>
						<Icon name="skill" size={15} />
						<span>{t("skills")}</span>
					</button>
					<button className="footer-button" type="button" onClick={() => setConfigModal("plugins")}>
						<Icon name="plugin" size={15} />
						<span>{t("plugins")}</span>
					</button>
					<button
						aria-label={t("sourceControl")}
						aria-pressed={inspectorOpen && !changesCollapsed}
						className={`footer-button is-icon ${inspectorOpen && !changesCollapsed ? "is-active" : ""}`}
						type="button"
						onClick={() => {
							setInspectorOpen(true);
							setFileTreeOpen(true);
							setChangesCollapsed(false);
						}}
					>
						<Icon name="branch" size={15} />
					</button>
					<button
						aria-label={t("settings")}
						className="footer-button is-icon is-settings"
						type="button"
						onClick={() => setConfigModal("settings")}
					>
						<Icon name="gear" size={15} />
					</button>
				</footer>
			</aside>
			{sidebarOpen ? (
				<hr
					className="column-resizer sidebar-resizer"
					aria-label="调整会话栏宽度"
					aria-orientation="vertical"
					aria-valuemin={220}
					aria-valuemax={420}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					onPointerDown={(event) => beginResize("sidebar", event.clientX)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight")
							resizeByKeyboard("sidebar", event.key === "ArrowLeft" ? -16 : 16);
					}}
				/>
			) : null}
			<section className="chat-workspace" aria-label="智能体对话">
				<header className="top-bar">
					{!sidebarOpen ? (
						<button
							className="sidebar-reopen-button"
							type="button"
							aria-label="显示侧栏"
							onClick={() => setSidebarOpen(true)}
						>
							<Icon name="panel" size={16} />
						</button>
					) : null}
					<div className="chat-title">
						<strong>{session?.name ?? "新会话"}</strong>
						<small>{formatWorkspace(snapshot.workspacePath)}</small>
					</div>
					<div className="top-bar-actions">
						<button
							className="native-toolbar-button"
							type="button"
							disabled={!session}
							onClick={() => setStatsOpen(true)}
						>
							<Icon name="history" size={12} />
							<span>{t("fullHistory")}</span>
						</button>
						<button
							className={`native-toolbar-button ${branchMenuOpen ? "is-active" : ""}`}
							type="button"
							disabled={!snapshot.branchPoints?.length || session?.phase === "running"}
							onClick={() => setBranchMenuOpen((current) => !current)}
						>
							<Icon name="branch" size={12} />
							<span>{t("branches")}</span>
						</button>
						{branchMenuOpen ? (
							<div className="branch-popover" role="menu" aria-label="分支">
								<div className="branch-popover-header">
									<strong>分支到消息</strong>
								</div>
								<div className="branch-list">
									{snapshot.branchPoints?.map((point) => (
										<button
											key={point.entryId}
											type="button"
											onClick={() => void handleNavigateTree(point.entryId)}
										>
											<span>{point.text || "（空消息）"}</span>
										</button>
									))}
								</div>
								<div className="branch-popover-footer">
									<button type="button" onClick={() => void handleForkSession()}>
										Fork 为独立会话
									</button>
								</div>
							</div>
						) : null}
						<div className="top-bar-more-wrap">
							<button
								className={`native-toolbar-button ${topMoreOpen ? "is-active" : ""}`}
								type="button"
								aria-expanded={topMoreOpen}
								onClick={() => setTopMoreOpen((current) => !current)}
							>
								<Icon name="more" size={12} />
								<span>{t("more")}</span>
							</button>
							{topMoreOpen ? (
								<div className="top-bar-more-menu" role="menu">
									<button
										type="button"
										onClick={() => {
											setTopMoreOpen(false);
											setStatsOpen(true);
										}}
									>
										会话统计
									</button>
									<button
										type="button"
										onClick={() => {
											setTopMoreOpen(false);
											setConfigModal("settings");
										}}
									>
										设置
									</button>
								</div>
							) : null}
						</div>
						<button
							className="icon-button"
							type="button"
							aria-label={t("openPreview")}
							onClick={() => setInspectorOpen((isOpen) => !isOpen)}
						>
							<Icon name="panel" size={16} />
						</button>
						{statsOpen ? (
							<SessionStatsPanel stats={snapshot.sessionStats} onClose={() => setStatsOpen(false)} />
						) : null}
					</div>
				</header>
				<div className="chat-scroll" ref={chatScrollRef} onScroll={handleChatScroll}>
					<ConversationNavigator
						turns={conversationTurns}
						scrollContainerRef={chatScrollRef}
						onSelect={(messageId) => {
							chatScrollRef.current
								?.querySelector(`[data-turn-id="${messageId}"]`)
								?.scrollIntoView({ block: "start", behavior: "smooth" });
						}}
					/>
					<div className="chat-column">
						{startupError ? (
							<button className="retry-startup-button" type="button" onClick={() => void startDesktopStore()}>
								重试初始化
							</button>
						) : null}
						{actionError ? <output className="notice notice-error">{actionError}</output> : null}
						{snapshot.pendingToolApprovals.length > 0 ? (
							<section className="card-stack" aria-label="待处理的工具审批">
								{snapshot.pendingToolApprovals.map((approval) => (
									<ToolApprovalCard
										approval={approval}
										key={approval.id}
										onDecide={handleToolApproval}
										resolving={resolvingApprovalId === approval.id}
									/>
								))}
							</section>
						) : null}
						{authenticationPrompt ? (
							<section className="card-stack" aria-label="待处理的模型配置提示">
								<AuthenticationPromptCard
									onChange={setAuthenticationResponse}
									onSubmit={handleAuthenticationPrompt}
									prompt={authenticationPrompt}
									resolving={respondingToAuthenticationPromptId === authenticationPrompt.id}
									response={authenticationResponse}
								/>
							</section>
						) : null}
						<div className="transcript">
							{session?.messages.length ? (
								transcriptItems.map((item) => {
									if (item.type === "process") {
										return (
											<div
												className="process-details"
												key={`process:${item.messages[0]?.id ?? item.blocks.map((block) => block.type).join(":")}`}
											>
												<details>
													<summary className="process-details-trigger">
														{t("processDetails")} · {item.messageCount}
														{item.toolCallCount > 0 ? ` · ${item.toolCallCount}` : ""}
													</summary>
													<div className="process-details-content">
														{item.blocks.map((block, blockIndex) => (
															<TranscriptBlock key={`${block.type}:${blockIndex}`} block={block} />
														))}
														{item.messages.map((message) => {
															const call = message.toolCallId
																? item.blocks.find(
																		(block) =>
																			block.type === "toolCall" && block.id === message.toolCallId,
																	)
																: undefined;
															return (
																<CollapsibleTranscriptEntry
																	key={message.id}
																	message={message}
																	toolCall={
																		call?.type === "toolCall"
																			? { name: call.name, input: call.input }
																			: undefined
																	}
																/>
															);
														})}
													</div>
												</details>
											</div>
										);
									}
									const turnIndex = conversationTurns.findIndex((turn) => turn.messageId === item.message.id);
									return (
										<div
											data-conversation-turn={turnIndex >= 0 ? turnIndex : undefined}
											data-turn-id={item.message.id}
											key={item.message.id}
										>
											<TranscriptMessage
												message={item.message}
												modelLabel={session.model?.id}
												onEdit={handleEditMessage}
												onFork={(entryId) => void handleForkFromMessage(entryId)}
											/>
										</div>
									);
								})
							) : snapshot.workspacePath ? (
								<div className="chat-empty-state">
									<span className="empty-index">01</span>
									<h2>{t("welcomeTitle")}</h2>
									<p>{t("welcomeBody")}</p>
									<div className="empty-suggestions">
										<button type="button" onClick={() => setDraft("解释这个项目的结构和关键入口")}>
											解释项目结构
										</button>
										<button type="button" onClick={() => setDraft("检查当前改动并找出潜在问题")}>
											审查当前改动
										</button>
										<button type="button" onClick={() => setDraft("帮我实现一个新功能：")}>
											实现新功能
										</button>
									</div>
								</div>
							) : (
								<div className="workspace-get-started">
									<Icon name="chevron" size={44} />
									<div>
										<strong>开始使用</strong>
										<p>
											<span>1.</span> 选择项目
										</p>
										<p>
											<span>2.</span> 添加模型
										</p>
									</div>
								</div>
							)}
							{session?.pendingMessages.map((message, index) => (
								<div className="queued-message" key={`${message.behavior}:${index}:${message.text}`}>
									<span>{message.behavior === "steer" ? "引导" : "跟进"}</span>
									<p>{message.text}</p>
								</div>
							))}
							{session?.phase === "running" ? (
								<output className="agent-running-status">
									<span className="status-indicator is-running" />
									Pi 正在处理…
								</output>
							) : null}
						</div>
					</div>
				</div>
				{awayFromBottom ? (
					<button className="scroll-to-latest" type="button" onClick={scrollToLatest}>
						<span>↓</span>
						{unseenMessages > 0 ? `${unseenMessages} 条新动态` : "回到底部"}
					</button>
				) : null}
				<form
					className={`composer ${draggingImages ? "is-dragging-images" : ""}`}
					onSubmit={(event) => void handleSubmit(event)}
					onDragEnter={(event) => {
						if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file"))
							setDraggingImages(true);
					}}
					onDragOver={(event) => event.preventDefault()}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImages(false);
					}}
					onDrop={(event) => {
						event.preventDefault();
						void handleDroppedImages(Array.from(event.dataTransfer.files));
					}}
				>
					{draggingImages ? <div className="drop-image-overlay">释放以附加图片</div> : null}
					<div className="composer-inner">
						{slashQuery ? (
							<div className="slash-menu" role="listbox" aria-label="斜杠命令">
								{slashCommands.length ? (
									visibleSlashCommands.map((command, index) => (
										<button
											aria-selected={suggestionIndex === index}
											className={`slash-command ${suggestionIndex === index ? "is-selected" : ""}`}
											key={command.name}
											role="option"
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectComposerSuggestion(index)}
										>
											<code>/{command.name}</code>
											<span>{command.description}</span>
										</button>
									))
								) : (
									<p className="slash-empty">没有匹配的桌面端命令，可直接发送给已加载的插件。</p>
								)}
							</div>
						) : null}
						{hashQuery ? (
							<div className="slash-menu" role="listbox" aria-label="会话提及">
								{hashSessions.length ? (
									hashSessions.map((item, index) => (
										<button
											aria-selected={suggestionIndex === index}
											className={`slash-command ${suggestionIndex === index ? "is-selected" : ""}`}
											key={item.path}
											role="option"
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectComposerSuggestion(index)}
										>
											<span>#{item.name ?? "未命名会话"}</span>
											<small>{item.firstMessage}</small>
										</button>
									))
								) : (
									<p className="slash-empty">没有匹配的会话。</p>
								)}
							</div>
						) : null}
						{atQuery ? (
							<div className="slash-menu" role="listbox" aria-label="文件提及">
								{atFiles.length ? (
									atFiles.map((file, index) => (
										<button
											aria-selected={suggestionIndex === index}
											className={`slash-command ${suggestionIndex === index ? "is-selected" : ""}`}
											key={file.path}
											role="option"
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectComposerSuggestion(index)}
										>
											<span className="tree-file-icon">
												<Icon name={fileIconFor(file.path)} size={13} />
											</span>
											<span>{file.path}</span>
										</button>
									))
								) : (
									<p className="slash-empty">
										{workspaceEntries.length ? "没有匹配的项目文件。" : "正在读取项目文件…"}
									</p>
								)}
							</div>
						) : null}
						{attachments.length ? (
							<div className="attachment-list">
								{attachments.map((attachment) => (
									<span className="attachment-chip" key={attachment.id}>
										<Icon name="image" size={13} />
										<span title={attachment.name}>
											{attachment.name} · {formatAttachmentSize(attachment.size)}
										</span>
										<button
											aria-label={`移除 ${attachment.name}`}
											type="button"
											onClick={() =>
												setAttachments((current) =>
													current.filter((currentAttachment) => currentAttachment.id !== attachment.id),
												)
											}
										>
											<Icon name="close" size={12} />
										</button>
									</span>
								))}
							</div>
						) : null}
						<div className="composer-editor">
							<textarea
								ref={promptRef}
								id="prompt"
								value={draft}
								onChange={(event) => {
									setDraft(event.target.value);
									setSuggestionIndex(0);
									promptHistoryIndexRef.current = -1;
									resizePrompt(event.currentTarget);
								}}
								onCompositionStart={() => {
									composingRef.current = true;
								}}
								onCompositionEnd={() => {
									composingRef.current = false;
								}}
								onKeyDown={(event) => {
									if (suggestionCount > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
										event.preventDefault();
										setSuggestionIndex((current) =>
											event.key === "ArrowDown"
												? (current + 1) % suggestionCount
												: (current - 1 + suggestionCount) % suggestionCount,
										);
										return;
									}
									if (suggestionCount > 0 && (event.key === "Tab" || event.key === "Enter")) {
										event.preventDefault();
										selectComposerSuggestion(suggestionIndex);
										return;
									}
									if (!draft && event.key === "ArrowUp" && promptHistoryRef.current.length > 0) {
										event.preventDefault();
										draftBeforeHistoryRef.current = draft;
										promptHistoryIndexRef.current = promptHistoryRef.current.length - 1;
										setDraft(promptHistoryRef.current[promptHistoryIndexRef.current] ?? "");
										return;
									}
									if (
										promptHistoryIndexRef.current >= 0 &&
										(event.key === "ArrowUp" || event.key === "ArrowDown")
									) {
										event.preventDefault();
										const next = promptHistoryIndexRef.current + (event.key === "ArrowUp" ? -1 : 1);
										if (next >= promptHistoryRef.current.length) {
											promptHistoryIndexRef.current = -1;
											setDraft(draftBeforeHistoryRef.current);
										} else {
											promptHistoryIndexRef.current = Math.max(0, next);
											setDraft(promptHistoryRef.current[promptHistoryIndexRef.current] ?? "");
										}
										return;
									}
									if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!composingRef.current &&
										!event.nativeEvent.isComposing
									) {
										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}
								}}
								placeholder={
									session?.phase === "running"
										? "输入引导或排队跟进…"
										: "消息…输入 / 使用命令，@ 查找文件，# 查找会话"
								}
								disabled={
									submitting ||
									openingWorkspace ||
									changingTrust ||
									settingUpProvider ||
									snapshot.providerSetupInProgress
								}
							/>
							{session?.phase === "running" ? (
								<div className="composer-stream-actions">
									<button
										className="composer-action-button"
										type="button"
										disabled={!canSubmit}
										onClick={() => void handleSteer()}
									>
										引导
									</button>
									<button className="send-button" type="submit" disabled={!canSubmit}>
										{submitting ? "排队中" : "跟进"}
									</button>
								</div>
							) : (
								<button className="send-button" type="submit" disabled={!canSubmit}>
									<Icon name="send" size={14} />
									{submitting ? "正在发送" : t("send")}
								</button>
							)}
						</div>
						<div className="composer-footer">
							<div className="composer-footer-left">
								<div className="composer-control-group">
									<button
										aria-label={t("addImage")}
										className="composer-icon-button"
										disabled={!session || choosingImages || session.phase === "running"}
										type="button"
										onClick={() => void handleChooseImages()}
									>
										<Icon name="image" size={16} />
									</button>
									<button
										className="composer-control-button"
										type="button"
										onClick={() => void handleChooseWorkspace()}
									>
										<Icon name="folder" size={15} />
										<span>{formatWorkspace(snapshot.workspacePath)}</span>
									</button>
									<button
										className="composer-control-button"
										type="button"
										disabled={!canSetModel || settingModel}
										onClick={() => setComposerMenu((current) => (current === "model" ? undefined : "model"))}
									>
										<Icon name="model" size={15} />
										<span>{session?.model?.id ?? "模型"}</span>
									</button>
								</div>
								<div className="composer-control-group composer-control-group-right">
									<button
										className="composer-control-button"
										type="button"
										disabled={!session || session.phase === "running"}
										onClick={() =>
											setComposerMenu((current) => (current === "thinking" ? undefined : "thinking"))
										}
									>
										<span>☼</span>
										<span>{session?.thinkingLevel ?? "auto"}</span>
									</button>
									<button
										className="composer-control-button"
										type="button"
										onClick={() => setComposerMenu((current) => (current === "tools" ? undefined : "tools"))}
									>
										<span>⌕</span>
										<span>{toolPreset}</span>
									</button>
									<button
										className="composer-control-button"
										type="button"
										disabled={!session || session.phase === "running" || compacting}
										onClick={() => void handleCompact()}
									>
										<span>{compacting ? "■" : "↗"}</span>
										<span>{compacting ? "压缩中" : "压缩"}</span>
									</button>
									<ContextUsageRing
										stats={snapshot.sessionStats}
										onToggle={() => setStatsOpen((current) => !current)}
									/>
									<button
										className="composer-control-button"
										type="button"
										aria-label="切换完成提示音"
										onClick={() => setSoundOnComplete((current) => !current)}
									>
										<span>{soundOnComplete ? "◖" : "◗"}</span>
									</button>
								</div>
								{composerMenu === "model" ? (
									<div className="composer-popover" role="menu">
										{snapshot.availableModels.map((model) => (
											<button
												key={getModelKey(model.provider, model.id)}
												type="button"
												onClick={() => {
													setComposerMenu(undefined);
													void handleChangeModel(getModelKey(model.provider, model.id));
												}}
											>
												{model.provider} / {model.name}
											</button>
										))}
									</div>
								) : null}
								{composerMenu === "thinking" ? (
									<div className="composer-popover" role="menu">
										{(
											session?.availableThinkingLevels ?? [
												"auto",
												"off",
												"minimal",
												"low",
												"medium",
												"high",
												"xhigh",
												"max",
											]
										).map((level) => (
											<button key={level} type="button" onClick={() => void handleChangeThinking(level)}>
												{level}
											</button>
										))}
									</div>
								) : null}
								{composerMenu === "tools" ? (
									<div className="composer-popover" role="menu">
										{(["off", "default", "full"] as const).map((preset) => (
											<button key={preset} type="button" onClick={() => handleToolPresetChange(preset)}>
												{preset}
											</button>
										))}
									</div>
								) : null}
							</div>
							<div className="composer-footer-right">
								{session?.phase === "running" ? (
									<button
										className="stop-button"
										type="button"
										disabled={aborting}
										onClick={() => void handleAbort()}
									>
										{aborting ? "停止中" : "停止"}
									</button>
								) : null}
							</div>
						</div>
					</div>
				</form>
			</section>
			{inspectorOpen ? (
				<hr
					className="column-resizer inspector-resizer"
					aria-label="调整检查器宽度"
					aria-orientation="vertical"
					aria-valuemin={300}
					aria-valuemax={760}
					aria-valuenow={inspectorWidth}
					tabIndex={0}
					onPointerDown={(event) => beginResize("inspector", event.clientX)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight")
							resizeByKeyboard("inspector", event.key === "ArrowLeft" ? 16 : -16);
					}}
				/>
			) : null}
			{inspectorOpen ? (
				<aside className="right-panel" aria-label="文件">
					<header className="right-panel-header">
						<div className="file-tab-bar" role="tablist" aria-label="已打开文件">
							{fileTabs.length === 0 ? (
								<div className="file-tab-bar-empty">
									<Icon name="files" size={14} />
									<span>Files</span>
								</div>
							) : (
								fileTabs.map((tab) => (
									<div
										key={tab.path}
										role="tab"
										aria-selected={tab.path === activeTabPath}
										tabIndex={tab.path === activeTabPath ? 0 : -1}
										className={`file-tab ${tab.path === activeTabPath ? "is-active" : ""}`}
										title={tab.path}
										onClick={() => setActiveTabPath(tab.path)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												setActiveTabPath(tab.path);
											}
										}}
									>
										<Icon name={fileIconFor(tab.path)} size={14} />
										<span>{tab.path.split("/").at(-1) ?? tab.path}</span>
										<button
											type="button"
											aria-label={`关闭 ${tab.path}`}
											onClick={(event) => {
												event.stopPropagation();
												handleCloseTab(tab.path);
											}}
										>
											<Icon name="close" size={12} />
										</button>
									</div>
								))
							)}
						</div>
						<div className="file-workbench-actions">
							<button
								className={`icon-button ${fileTreeOpen ? "is-active" : ""}`}
								type="button"
								aria-label={fileTreeOpen ? t("hideFileList") : t("showFileList")}
								aria-pressed={fileTreeOpen}
								onClick={() => setFileTreeOpen((open) => !open)}
							>
								<Icon name="tree" size={16} />
							</button>
							<button
								className="icon-button"
								type="button"
								aria-label="关闭右侧面板"
								onClick={() => setInspectorOpen(false)}
							>
								<Icon name="close" size={16} />
							</button>
						</div>
					</header>
					<div className="file-workspace">
						<Inspector
							tabs={fileTabs}
							activeTabPath={activeTabPath}
							onSelectTab={setActiveTabPath}
							onCloseTab={handleCloseTab}
							onClose={() => setInspectorOpen(false)}
							onOpenFile={(path) => void handleOpenFileWithDefaultApp(path)}
							onRevealFile={(path) => void handleRevealFile(path)}
							onQuoteLine={handleQuoteLine}
						/>
						{fileTreeOpen ? (
							<>
								<hr
									className="column-resizer"
									aria-label="调整文件树宽度"
									aria-orientation="vertical"
									aria-valuemin={220}
									aria-valuemax={520}
									aria-valuenow={fileTreeWidth}
									tabIndex={0}
									onPointerDown={(event) => beginResize("file-tree", event.clientX)}
									onKeyDown={(event) => {
										if (event.key === "ArrowLeft" || event.key === "ArrowRight")
											resizeByKeyboard("file-tree", event.key === "ArrowLeft" ? 16 : -16);
									}}
								/>
								<div className="file-tree-panel">
									<Explorer
										entries={workspaceEntries}
										error={fileExplorerError}
										isLoading={loadingFiles || loadingFilePath !== undefined}
										isTrusted={snapshot.projectTrusted}
										selectedPath={activeTabPath}
										workspacePath={snapshot.workspacePath}
										onChooseWorkspace={() => void handleChooseWorkspace()}
										onOpenFile={(entry) => void handleOpenFile(entry)}
										onRefresh={() => void refreshWorkspaceFiles()}
										onTrustProject={() => void handleProjectTrust()}
									/>
								</div>
							</>
						) : null}
					</div>
				</aside>
			) : null}
			{configModal === "models" ? (
				<ModelsConfigModal
					providers={snapshot.apiKeyProviders}
					selectedProviderId={selectedProviderId}
					providerSetupInProgress={snapshot.providerSetupInProgress}
					settingUpProvider={settingUpProvider}
					onChangeProvider={setSelectedProviderId}
					onStartProviderSetup={(providerId, authType) => {
						setConfigModal(undefined);
						void beginProviderSetup(providerId, authType);
					}}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "skills" ? (
				<SkillsConfigModal skills={snapshot.skills} onClose={() => setConfigModal(undefined)} />
			) : null}
			{configModal === "plugins" ? (
				<PluginsConfigModal plugins={snapshot.plugins} onClose={() => setConfigModal(undefined)} />
			) : null}
			{configModal === "settings" ? (
				<AppSettingsModal
					theme={theme}
					language={language}
					notifyOnComplete={notifyOnComplete}
					soundOnComplete={soundOnComplete}
					onChangeTheme={setTheme}
					onChangeLanguage={setLanguage}
					onToggleNotify={() => setNotifyOnComplete((current) => !current)}
					onToggleSound={() => setSoundOnComplete((current) => !current)}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{trustDialogOpen && snapshot.workspacePath ? (
				<ProjectTrustDialog
					workspacePath={snapshot.workspacePath}
					busy={changingTrust}
					error={actionError}
					onCancel={() => setTrustDialogOpen(false)}
					onConfirm={() => void confirmProjectTrust()}
				/>
			) : null}
			<UpdateReminder onOpenSettings={() => setConfigModal("settings")} />
		</main>
	);
}
