import type { CSSProperties, FormEvent } from "react";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
	DesktopAuthenticationPrompt,
	DesktopImageAttachment,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopToolApproval,
	DesktopTranscriptMessage,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { AppSettingsModal } from "./app-settings-modal.tsx";
import {
	chooseImages,
	chooseWorkspace,
	decideToolApproval,
	forkSession,
	getDesktopSnapshot,
	getDesktopStartupError,
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
	startDesktopStore,
	startProviderSetup,
	submitPrompt,
	subscribeDesktopSnapshot,
} from "./desktop-store.ts";
import { MarkdownBody } from "./markdown.tsx";
import { ModelsConfigModal } from "./models-config-modal.tsx";
import { PluginsConfigModal } from "./plugins-config-modal.tsx";
import { ContextUsageRing, SessionStatsPanel } from "./session-stats.tsx";
import { SkillsConfigModal } from "./skills-config-modal.tsx";
import { SourceControl } from "./source-control.tsx";
import { getLanguageForPath, HighlightedCode } from "./syntax-highlight.tsx";
import { WorktreeSelector } from "./worktree-selector.tsx";

type IconName =
	| "branch"
	| "chevron"
	| "close"
	| "code"
	| "doc"
	| "external"
	| "files"
	| "folder"
	| "gear"
	| "image"
	| "model"
	| "moon"
	| "panel"
	| "plugin"
	| "plus"
	| "search"
	| "skill"
	| "sun";
type WorkbenchView = "chats" | "files" | "source-control";
type ConfigModal = "models" | "plugins" | "settings" | "skills";

const SIDEBAR_TITLES: Record<WorkbenchView, string> = {
	chats: "Pi 桌面端",
	files: "文件",
	"source-control": "源代码管理",
};

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

function formatSessionPhase(phase: "error" | "idle" | "running" | "unavailable"): string {
	if (phase === "error") return "错误";
	if (phase === "idle") return "就绪";
	if (phase === "running") return "运行中";
	return "不可用";
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

const CollapsibleTranscriptEntry = memo(function CollapsibleTranscriptEntry({
	message,
}: {
	message: DesktopTranscriptMessage;
}) {
	const [expanded, setExpanded] = useState(false);
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
				<span>{message.role === "tool" ? "工具调用" : "系统消息"}</span>
				{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
			</button>
			{expanded ? (
				<pre className="entry-detail">
					<code>{message.text || "…"}</code>
				</pre>
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

	const visibleEntries = useMemo(() => {
		if (collapsedDirectories.size === 0) return entries;
		return entries.filter((entry) => {
			const segments = entry.path.split("/");
			for (let index = 1; index < segments.length; index += 1) {
				if (collapsedDirectories.has(segments.slice(0, index).join("/"))) return false;
			}
			return true;
		});
	}, [entries, collapsedDirectories]);

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
					<Icon name="search" size={15} />
				</button>
			</div>
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
							<span>{entry.name}</span>
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
}: {
	tabs: FileTab[];
	activeTabPath: string | undefined;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onClose: () => void;
	onOpenFile: (path: string) => void;
	onRevealFile: (path: string) => void;
}) {
	const [mode, setMode] = useState<"preview" | "source">("source");
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
					<pre className="file-preview">
						<HighlightedCode code={preview.content} language={getLanguageForPath(preview.path)} />
					</pre>
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
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const stored = localStorage.getItem("pi-desktop-theme");
		return stored === "light" ? "light" : "dark";
	});
	const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(() => {
		return localStorage.getItem("pi-desktop-notify-complete") !== "off";
	});
	const [activeView, setActiveView] = useState<WorkbenchView>("chats");
	const [draft, setDraft] = useState(() => localStorage.getItem("pi-desktop-draft") ?? "");
	const [openingWorkspace, setOpeningWorkspace] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [changingTrust, setChangingTrust] = useState(false);
	const [settingUpProvider, setSettingUpProvider] = useState(false);
	const [settingModel, setSettingModel] = useState(false);
	const [choosingImages, setChoosingImages] = useState(false);
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
	const [statsOpen, setStatsOpen] = useState(false);
	const [configModal, setConfigModal] = useState<ConfigModal | undefined>();
	const [branchMenuOpen, setBranchMenuOpen] = useState(false);
	const fileRequestId = useRef(0);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const previousPhaseRef = useRef<DesktopSessionPhase | undefined>(undefined);
	const apiKeyProviderIds = snapshot.apiKeyProviders.map((provider) => provider.id).join("\u0000");
	const authenticationPrompt = snapshot.pendingAuthenticationPrompts[0];
	const session = snapshot.session;
	const canSubmit =
		!submitting &&
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
	const selectedModelKey = session?.model ? getModelKey(session.model.provider, session.model.id) : "";
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
				.filter((entry) => entry.name.toLocaleLowerCase().includes(atQuery))
				.slice(0, 8)
		: [];

	useEffect(() => {
		void startDesktopStore();
	}, []);
	useEffect(() => {
		localStorage.setItem("pi-desktop-draft", draft);
	}, [draft]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				promptRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		localStorage.setItem("pi-desktop-theme", theme);
	}, [theme]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-notify-complete", notifyOnComplete ? "on" : "off");
	}, [notifyOnComplete]);
	useEffect(() => {
		const phase = session?.phase;
		if (previousPhaseRef.current === "running" && phase === "idle" && notifyOnComplete) {
			if (document.hasFocus()) {
				playCompletionTone();
			} else {
				void notifyComplete();
			}
		}
		previousPhaseRef.current = phase;
	}, [session?.phase, notifyOnComplete]);
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
		setInspectorOpen(false);
		if (activeView === "files" && snapshot.projectTrusted && snapshot.workspacePath) void refreshWorkspaceFiles();
	}, [activeView, refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath]);
	useEffect(() => {
		if (atQuery && snapshot.projectTrusted && snapshot.workspacePath && workspaceEntries.length === 0) {
			void refreshWorkspaceFiles();
		}
	}, [atQuery, refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath, workspaceEntries.length]);

	async function handleChooseWorkspace(): Promise<void> {
		if (!canChooseWorkspace) return;
		setOpeningWorkspace(true);
		setActionError(undefined);
		try {
			await chooseWorkspace();
			setActiveView("chats");
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
			setActiveView("chats");
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

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;
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
			);
			startTransition(() => {
				setAttachments([]);
				setDraft("");
			});
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmitting(false);
		}
	}

	async function handleProjectTrust(): Promise<void> {
		const nextTrusted = !snapshot.projectTrusted;
		if (nextTrusted && !window.confirm("要信任此项目吗？项目设置、说明和扩展程序可能会运行。")) return;
		setChangingTrust(true);
		setActionError(undefined);
		try {
			await setProjectTrust(nextTrusted);
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
			setActiveView("files");
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

	const handleRevealFile = useCallback(async (path: string): Promise<void> => {
		setActionError(undefined);
		try {
			await revealWorkspaceFile(path);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	function renderSidebar() {
		if (activeView === "files")
			return (
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
			);
		if (activeView === "source-control") return <SourceControl />;
		return (
			<div className="sessions-panel">
				<div className="session-list">
					{snapshot.sessions.length ? (
						snapshot.sessions.map((item) => {
							const isCurrent = item.id === session?.id;
							return (
								<button
									className={`session-row ${isCurrent ? "is-current" : ""}`}
									key={item.path}
									type="button"
									disabled={session?.phase === "running"}
									onClick={() => (isCurrent ? promptRef.current?.focus() : void handleOpenSession(item.path))}
								>
									<span
										className={`session-status ${isCurrent && session?.phase === "running" ? "is-running" : ""}`}
									/>
									<span>
										<strong>{sessionTitle(item)}</strong>
										<small>
											{item.messageCount} 条消息 · {formatSessionDate(item.modified)}
										</small>
									</span>
								</button>
							);
						})
					) : (
						<button className="session-row is-current" type="button" onClick={() => promptRef.current?.focus()}>
							<span className={`session-status ${session?.phase === "running" ? "is-running" : ""}`} />
							<span>
								<strong>{session?.name ?? "新会话"}</strong>
								<small>
									{session
										? `${session.messages.length} 条消息 · ${formatSessionPhase(session.phase)}`
										: "等待选择项目"}
								</small>
							</span>
						</button>
					)}
				</div>
			</div>
		);
	}

	const macOSClassName = navigator.userAgent.includes("Macintosh") ? "is-macos" : "";

	return (
		<main className={`app-workbench ${macOSClassName} ${inspectorOpen ? "is-inspector-open" : ""}`}>
			<aside className="sidebar" aria-label="项目导航">
				<header className="sidebar-header">
					<p className="section-kicker">{SIDEBAR_TITLES[activeView]}</p>
					<span className={snapshot.projectTrusted ? "trust-badge is-trusted" : "trust-badge"}>
						{snapshot.projectTrusted ? "已信任" : "受限"}
					</span>
				</header>
				<div className="sidebar-body">
					<button
						className="new-chat-button"
						type="button"
						disabled={session?.phase === "running"}
						onClick={() => void handleNewSession()}
					>
						<Icon name="plus" size={16} />
						<span>新对话</span>
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
					{snapshot.workspacePath ? (
						<WorktreeSelector
							key={snapshot.workspacePath}
							workspacePath={snapshot.workspacePath}
							onSwitch={(path) => void handleSwitchWorkspacePath(path)}
						/>
					) : null}
					<div className="view-segmented" role="tablist" aria-label="侧栏视图">
						<button
							aria-pressed={activeView === "chats"}
							className={activeView === "chats" ? "is-active" : ""}
							type="button"
							onClick={() => setActiveView("chats")}
						>
							会话
						</button>
						<button
							aria-pressed={activeView === "files"}
							className={activeView === "files" ? "is-active" : ""}
							type="button"
							onClick={() => setActiveView("files")}
						>
							文件
						</button>
					</div>
				</div>
				<div className="sidebar-content">{renderSidebar()}</div>
				<footer className="sidebar-footer">
					<button className="footer-button" type="button" onClick={() => setConfigModal("models")}>
						<Icon name="model" size={15} />
						<span>模型</span>
					</button>
					<button className="footer-button" type="button" onClick={() => setConfigModal("skills")}>
						<Icon name="skill" size={15} />
						<span>技能</span>
					</button>
					<button className="footer-button" type="button" onClick={() => setConfigModal("plugins")}>
						<Icon name="plugin" size={15} />
						<span>插件</span>
					</button>
					<button
						aria-label="源代码管理"
						aria-pressed={activeView === "source-control"}
						className={`footer-button is-icon ${activeView === "source-control" ? "is-active" : ""}`}
						type="button"
						onClick={() => setActiveView("source-control")}
					>
						<Icon name="branch" size={15} />
					</button>
					<button
						aria-label="设置"
						className="footer-button is-icon is-settings"
						type="button"
						onClick={() => setConfigModal("settings")}
					>
						<Icon name="gear" size={15} />
					</button>
				</footer>
			</aside>
			<section className="chat-workspace" aria-label="智能体对话">
				<header className="top-bar">
					<div className="chat-title">
						<strong>{session?.name ?? "新会话"}</strong>
						<small>{formatWorkspace(snapshot.workspacePath)}</small>
					</div>
					<div className="top-bar-actions">
						<ContextUsageRing
							stats={snapshot.sessionStats}
							onToggle={() => setStatsOpen((current) => !current)}
						/>
						<span className="model-chip">
							{session?.model ? `${session.model.provider}/${session.model.id}` : "未选择模型"}
						</span>
						<button
							className="icon-button"
							type="button"
							aria-label="分支"
							disabled={!snapshot.branchPoints?.length || session?.phase === "running"}
							onClick={() => setBranchMenuOpen((current) => !current)}
						>
							<Icon name="branch" size={16} />
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
						<button
							className="icon-button"
							type="button"
							aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
							onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
						>
							<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
						</button>
						<button
							className="icon-button"
							type="button"
							aria-label="打开文件浏览"
							onClick={() => setActiveView("files")}
						>
							<Icon name="files" size={16} />
						</button>
						<button
							className="icon-button"
							type="button"
							aria-label="打开预览面板"
							onClick={() => setInspectorOpen((isOpen) => !isOpen)}
						>
							<Icon name="panel" size={16} />
						</button>
						{statsOpen ? (
							<SessionStatsPanel stats={snapshot.sessionStats} onClose={() => setStatsOpen(false)} />
						) : null}
					</div>
				</header>
				<div className="chat-scroll">
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
							{session?.messages.length
								? session.messages.map((message) =>
										message.role === "user" || message.role === "assistant" ? (
											<article className={`message message-${message.role}`} key={message.id}>
												<div className="message-meta">
													<span>{message.role === "assistant" ? "Pi" : "你"}</span>
													{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
												</div>
												{message.role === "assistant" ? (
													<MarkdownBody text={message.text || ""} />
												) : (
													<p>{message.text || "…"}</p>
												)}
											</article>
										) : (
											<CollapsibleTranscriptEntry key={message.id} message={message} />
										),
									)
								: null}
						</div>
					</div>
				</div>
				<form className="composer" onSubmit={(event) => void handleSubmit(event)}>
					<div className="composer-inner">
						{slashQuery ? (
							<div className="slash-menu" role="listbox" aria-label="斜杠命令">
								{slashCommands.length ? (
									slashCommands.slice(0, 8).map((command) => (
										<button
											className="slash-command"
											key={command.name}
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => {
												setDraft(
													`/${command.name}${command.name === "model" || command.name === "login" ? " " : ""}`,
												);
												promptRef.current?.focus();
											}}
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
						{atQuery ? (
							<div className="slash-menu" role="listbox" aria-label="文件提及">
								{atFiles.length ? (
									atFiles.map((file) => (
										<button
											className="slash-command"
											key={file.path}
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => {
												setDraft(draft.replace(/@[^\s]*$/u, `${file.path} `));
												promptRef.current?.focus();
											}}
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
						<textarea
							ref={promptRef}
							id="prompt"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							placeholder={session ? "输入消息，或键入 / 调用命令…" : "正在准备本地智能体…"}
							disabled={
								!session ||
								submitting ||
								openingWorkspace ||
								changingTrust ||
								settingUpProvider ||
								snapshot.providerSetupInProgress
							}
						/>
						<div className="composer-footer">
							<select
								aria-label="选择当前模型"
								className="composer-model-select"
								disabled={!canSetModel || settingModel}
								value={selectedModelKey}
								onChange={(event) => void handleChangeModel(event.target.value)}
							>
								<option value="">{snapshot.availableModels.length ? "选择模型" : "配置模型"}</option>
								{snapshot.availableModels.map((model) => (
									<option
										key={getModelKey(model.provider, model.id)}
										value={getModelKey(model.provider, model.id)}
									>
										{model.provider} / {model.name}
									</option>
								))}
							</select>
							<button
								aria-label="添加图片"
								className="composer-icon-button"
								disabled={!session || choosingImages || session.phase === "running"}
								type="button"
								onClick={() => void handleChooseImages()}
							>
								<Icon name="image" size={16} />
							</button>
							<button className="send-button" type="submit" disabled={!canSubmit}>
								{submitting ? "正在发送" : "发送"}
							</button>
						</div>
					</div>
				</form>
			</section>
			{inspectorOpen ? (
				<Inspector
					tabs={fileTabs}
					activeTabPath={activeTabPath}
					onSelectTab={setActiveTabPath}
					onCloseTab={handleCloseTab}
					onClose={() => setInspectorOpen(false)}
					onOpenFile={(path) => void handleOpenFileWithDefaultApp(path)}
					onRevealFile={(path) => void handleRevealFile(path)}
				/>
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
					notifyOnComplete={notifyOnComplete}
					onChangeTheme={setTheme}
					onToggleNotify={() => setNotifyOnComplete((current) => !current)}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
		</main>
	);
}
