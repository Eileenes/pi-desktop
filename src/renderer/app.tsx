import type { CSSProperties, FormEvent } from "react";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
	DesktopAuthenticationPrompt,
	DesktopExtensionDialog,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopToolApproval,
	DesktopTranscriptBlock,
	DesktopTranscriptMessage,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { formatSessionReference } from "../shared/session-reference.ts";
import { flattenSessionTree } from "../shared/session-tree.ts";
import { AppSettingsModal } from "./app-settings-modal.tsx";
import { BranchNavigator } from "./branch-navigator.tsx";
import { ConversationNavigator } from "./conversation-navigator.tsx";
import {
	abortSession,
	attachDroppedImages,
	autoNameSession,
	cancelProviderSetup,
	chooseImages,
	compactSession,
	copyLastAnswer,
	decideToolApproval,
	deleteSession,
	discardImageAttachment,
	executeBashCommand,
	exportSession,
	forkSession,
	getDesktopSnapshot,
	getDesktopStartupError,
	getGitDiff,
	importDroppedFiles,
	listGitChanges,
	listGitWorktrees,
	listWorkspaceFiles,
	navigateTree,
	newSession,
	notifyComplete,
	onExtensionUi,
	onWorkspaceChanged,
	openSession,
	openWorkspaceFile,
	openWorkspacePath,
	readFullBashOutput,
	readWorkspaceFile,
	reloadSession,
	renameSession,
	respondToAuthenticationPrompt,
	respondToExtensionDialog,
	restoreImageAttachments,
	revealWorkspaceFile,
	saveFullBashOutput,
	saveWorkspaceFile,
	searchWorkspaceFiles,
	sendExtensionCustomInput,
	setModel,
	setProjectTrust,
	setThinkingLevel,
	startDesktopStore,
	startProviderSetup,
	submitPrompt,
	subscribeDesktopSnapshot,
} from "./desktop-store.ts";
import { DirectoryPicker } from "./directory-picker.tsx";
import { ExtensionCustomPanel, ExtensionWidgetStack } from "./extension-custom-panel.tsx";
import { ExtensionDialog } from "./extension-dialog.tsx";
import { type AppLanguage, translate } from "./i18n.ts";
import { MarkdownBody } from "./markdown.tsx";
import { ModelsConfigModal } from "./models-config-modal.tsx";
import { PluginsConfigModal } from "./plugins-config-modal.tsx";
import { ProjectTrustDialog } from "./project-trust-dialog.tsx";
import { ContextUsageRing, SessionStatsPanel } from "./session-stats.tsx";
import { SkillsConfigModal } from "./skills-config-modal.tsx";
import { SourceControl } from "./source-control.tsx";
import { getLanguageForPath, HighlightedCode } from "./syntax-highlight.tsx";
import { buildConversationTurns, partitionTranscript } from "./transcript-group.ts";
import { UpdateReminder } from "./update-reminder.tsx";
import { WorktreeSection } from "./worktree-selector.tsx";

type IconName =
	| "branch"
	| "bulb"
	| "chart"
	| "chat"
	| "chevron"
	| "close"
	| "code"
	| "compact"
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
	| "sparkles"
	| "speaker"
	| "sun"
	| "terminal"
	| "wrap"
	| "wrench";
type ConfigModal = "models" | "plugins" | "settings" | "skills";

const DRAFT_STORAGE_PREFIX = "pi-desktop-draft:";
const DRAFT_INDEX_STORAGE_KEY = "pi-desktop-draft-index";
const MAX_STORED_DRAFTS = 40;
const MAX_IMAGE_ATTACHMENTS = 10;

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
	if (name === "chat") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8Z" />
			</svg>
		);
	}
	if (name === "bulb") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M9 18h6M10 21h4" />
				<path d="M12 3a6.5 6.5 0 0 0-3.7 11.8c.7.5 1.2 1.4 1.2 2.2h5c0-.8.5-1.7 1.2-2.2A6.5 6.5 0 0 0 12 3Z" />
			</svg>
		);
	}
	if (name === "wrench") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
			</svg>
		);
	}
	if (name === "compact") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M5 3.5h14" />
				<path d="m8 10.5 4-4 4 4" />
				<path d="M12 6.5v14" />
			</svg>
		);
	}
	if (name === "speaker") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M11 5 6 9H3v6h3l5 4V5Z" />
				<path d="M15.5 8.5a5 5 0 0 1 0 7" />
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
				<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		);
	if (name === "sparkles")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 3c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6Z" />
				<path d="M5 17v4M3 19h4" />
			</svg>
		);
	if (name === "chart")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
			</svg>
		);
	if (name === "terminal")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m4 17 6-6-6-6" />
				<path d="M12 19h8" />
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

function isHtmlFile(path: string): boolean {
	const extension = getFileExtension(path);
	return extension === "html" || extension === "htm";
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

function formatCompact(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(value);
}

function formatGitBranch(branch: string): string {
	return branch.replace(/^refs\/(?:heads|remotes)\//u, "");
}

function mentionNameStart(path: string, query: string): number {
	const matchIndex = path.toLocaleLowerCase().indexOf(query);
	if (matchIndex < 0) return 0;
	return path.lastIndexOf("/", matchIndex) + 1;
}

function fuzzyMatchScore(value: string, query: string): number | undefined {
	if (!query) return 0;
	const candidate = value.toLocaleLowerCase();
	const needle = query.toLocaleLowerCase();
	const exact = candidate.indexOf(needle);
	if (exact >= 0) return exact;
	let position = 0;
	let gapScore = 0;
	for (const character of needle) {
		const next = candidate.indexOf(character, position);
		if (next < 0) return undefined;
		gapScore += next - position;
		position = next + 1;
	}
	return 100 + gapScore;
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

const EDIT_TOOL_NAMES = new Set(["edit", "edit_file", "write", "multi_edit", "str_replace", "replace_editor"]);

function parseEditToolDiff(
	name: string,
	input: string,
): { lines: Array<{ kind: "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }> } | undefined {
	if (!EDIT_TOOL_NAMES.has(name.toLowerCase())) return undefined;
	try {
		const parsed = JSON.parse(input) as Record<string, unknown>;
		const keys = Object.keys(parsed);
		const oldKey = keys.find((key) => /old|previous|search|before/iu.test(key) && typeof parsed[key] === "string");
		const newKey = keys.find((key) => /new|replacement|replace|after/iu.test(key) && typeof parsed[key] === "string");
		if (typeof parsed.oldText === "string" || typeof parsed.newText === "string") {
			const oldText = typeof parsed.oldText === "string" ? parsed.oldText : "";
			const newText = typeof parsed.newText === "string" ? parsed.newText : "";
			return { lines: buildDiffLines(oldText, newText) };
		}
		if (oldKey && newKey) {
			return { lines: buildDiffLines(parsed[oldKey] as string, parsed[newKey] as string) };
		}
		const content = parsed.content ?? parsed.text;
		if (typeof content === "string" && (name.toLowerCase() === "write" || keys.length <= 2)) {
			return { lines: buildDiffLines("", content) };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function buildDiffLines(
	oldText: string,
	newText: string,
): Array<{ kind: "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }> {
	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];
	const lines: Array<{ kind: "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }> = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
			lines.push({
				kind: "ctx",
				text: oldLines[oldIndex],
				oldLine: oldIndex + 1,
				newLine: newIndex + 1,
			});
			oldIndex += 1;
			newIndex += 1;
		} else {
			if (oldIndex < oldLines.length && (newIndex >= newLines.length || !newLines.includes(oldLines[oldIndex]))) {
				lines.push({ kind: "del", text: oldLines[oldIndex], oldLine: oldIndex + 1 });
				oldIndex += 1;
			} else if (newIndex < newLines.length) {
				lines.push({ kind: "add", text: newLines[newIndex], newLine: newIndex + 1 });
				newIndex += 1;
			} else {
				break;
			}
		}
	}
	return lines;
}

const EditDiffView = memo(function EditDiffView({
	lines,
}: {
	lines: Array<{ kind: "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }>;
}) {
	return (
		<div className="edit-diff edit-diff-split">
			<div className="edit-diff-head">
				<span>旧内容</span>
				<span>新内容</span>
			</div>
			{lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定
				<div className="edit-diff-row" key={index}>
					<div className={`edit-diff-side ${line.kind === "add" ? "is-empty" : "is-del"}`}>
						<span className="edit-diff-num">{line.oldLine ?? ""}</span>
						<span className="edit-diff-marker">{line.kind === "del" ? "−" : " "}</span>
						<code>{line.kind === "add" ? " " : line.text || " "}</code>
					</div>
					<div className={`edit-diff-side ${line.kind === "del" ? "is-empty" : "is-add"}`}>
						<span className="edit-diff-num">{line.newLine ?? ""}</span>
						<span className="edit-diff-marker">{line.kind === "add" ? "+" : " "}</span>
						<code>{line.kind === "del" ? " " : line.text || " "}</code>
					</div>
				</div>
			))}
		</div>
	);
});

function toolCallPreview(input: string): string {
	try {
		const parsed = JSON.parse(input) as Record<string, unknown>;
		for (const key of ["command", "path", "file_path", "pattern", "query"]) {
			const value = parsed[key];
			if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
		}
	} catch {
		// 非 JSON 输入，退回原文。
	}
	return input.replace(/\s+/gu, " ").trim().slice(0, 120);
}

const TranscriptBlock = memo(function TranscriptBlock({
	block,
	durationMs,
}: {
	block: DesktopTranscriptBlock;
	durationMs?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	if (block.type === "text") return <MarkdownBody text={block.text} />;
	if (block.type === "image") {
		return block.thumbnailDataUrl ? (
			<img className="message-image-thumbnail" src={block.thumbnailDataUrl} alt={block.label} />
		) : (
			<span className="message-image-label">{block.label}</span>
		);
	}
	if (block.type === "thinking") {
		return (
			<div className="message-block message-block-thinking">
				<button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
					<span className="entry-chevron">
						<Icon name="chevron" size={11} />
					</span>
					思考过程
					<span className="block-dim">
						{durationMs !== undefined
							? `耗时 ${(durationMs / 1000).toFixed(1)}s`
							: `${formatCompact(block.text.length)} 字符`}
					</span>
				</button>
				{expanded ? (
					<pre>
						<code>{block.text}</code>
					</pre>
				) : null}
			</div>
		);
	}
	const editDiff = parseEditToolDiff(block.name, block.input);
	return (
		<div className={`message-block message-block-toolCall ${expanded ? "is-expanded" : ""}`}>
			<button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
				<span className="entry-chevron">
					<Icon name="chevron" size={11} />
				</span>
				<code className="tool-name">{block.name}</code>
				<span className="tool-preview">{toolCallPreview(block.input)}</span>
			</button>
			{expanded ? (
				editDiff ? (
					<EditDiffView lines={editDiff.lines} />
				) : (
					<pre>
						<code>{block.input}</code>
					</pre>
				)
			) : null}
		</div>
	);
});

function formatUsageSummary(usage: NonNullable<DesktopTranscriptMessage["usage"]>): string {
	const parts = [`${formatCompact(usage.input)} in · ${formatCompact(usage.output)} out`];
	if (usage.cacheRead > 0) parts.push(`${formatCompact(usage.cacheRead)} cache R`);
	if (usage.cacheWrite > 0) parts.push(`${formatCompact(usage.cacheWrite)} cache W`);
	if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.join(" · ");
}

function speedTone(tokensPerSecond: number): "is-fast" | "is-good" | "is-warm" | "is-slow" {
	if (tokensPerSecond >= 50) return "is-fast";
	if (tokensPerSecond >= 30) return "is-good";
	if (tokensPerSecond >= 15) return "is-warm";
	return "is-slow";
}

const COLLAPSE_HEIGHT = 220;

const UserMessageBody = memo(function UserMessageBody({
	text,
	blocks,
}: {
	text: string;
	blocks?: DesktopTranscriptBlock[];
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const imageBlocks =
		blocks?.filter((block): block is Extract<DesktopTranscriptBlock, { type: "image" }> => block.type === "image") ??
		[];
	const imagePreview = imageBlocks.length ? (
		<div className="message-user-images">
			{imageBlocks.map((block, index) =>
				block.thumbnailDataUrl ? (
					<img
						className="message-user-image"
						key={`${block.label}:${index}`}
						src={block.thumbnailDataUrl}
						alt={block.label}
					/>
				) : (
					<span className="message-image-label" key={`${block.label}:${index}`}>
						{block.label}
					</span>
				),
			)}
		</div>
	) : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅在消息文本变化时测量一次高度
	useEffect(() => {
		const element = bodyRef.current;
		if (!element) return;
		setOverflowing(element.scrollHeight > COLLAPSE_HEIGHT + 40);
		setCollapsed(element.scrollHeight > COLLAPSE_HEIGHT + 40);
	}, [text]);

	if (!overflowing) {
		return (
			<div className="message-user-body" ref={bodyRef}>
				{imagePreview}
				{text ? <MarkdownBody text={text} /> : null}
			</div>
		);
	}
	return (
		<div className="message-user-body-wrap">
			<div className={`message-user-body ${collapsed ? "is-collapsed" : ""}`} ref={bodyRef}>
				{imagePreview}
				{text ? <MarkdownBody text={text} /> : null}
			</div>
			<button type="button" className="message-user-expand" onClick={() => setCollapsed((current) => !current)}>
				{collapsed ? "展开全部" : "收起"}
				<span className="entry-chevron">
					<Icon name="chevron" size={11} />
				</span>
			</button>
		</div>
	);
});

const TranscriptMessage = memo(function TranscriptMessage({
	message,
	modelLabel,
	isLastAssistant,
	isStreaming,
	previousTimestamp,
	onEdit,
	onFork,
}: {
	message: DesktopTranscriptMessage;
	modelLabel?: string;
	isLastAssistant?: boolean;
	isStreaming?: boolean;
	previousTimestamp?: number;
	onEdit: (message: DesktopTranscriptMessage) => void;
	onFork: (entryId: string) => void;
}) {
	const [copied, setCopied] = useState(false);
	const [streamTps, setStreamTps] = useState<number>();
	const streamStartRef = useRef<number | undefined>(undefined);
	const streamCharacterCountRef = useRef(0);
	const isAssistant = message.role === "assistant";
	streamCharacterCountRef.current = message.blocks
		? message.blocks.reduce(
				(total, block) =>
					total +
					(block.type === "text" || block.type === "thinking"
						? block.text.length
						: block.type === "toolCall"
							? block.input.length
							: 0),
				0,
			)
		: message.text.length;
	const durationSeconds =
		isAssistant && message.timestamp && previousTimestamp && message.timestamp > previousTimestamp
			? Math.max(1, Math.round((message.timestamp - previousTimestamp) / 1000))
			: undefined;
	const completedTps = durationSeconds && message.usage?.output ? message.usage.output / durationSeconds : undefined;

	useEffect(() => {
		if (!isStreaming) {
			streamStartRef.current = undefined;
			setStreamTps(undefined);
			return;
		}
		streamStartRef.current ??= Date.now();
		const update = (): void => {
			const elapsed = (Date.now() - (streamStartRef.current ?? Date.now())) / 1000;
			if (elapsed > 0.5 && streamCharacterCountRef.current > 0) {
				setStreamTps(streamCharacterCountRef.current / 4 / elapsed);
			}
		};
		const timer = window.setInterval(update, 300);
		update();
		return () => window.clearInterval(timer);
	}, [isStreaming]);

	async function copyMessage(): Promise<void> {
		await navigator.clipboard.writeText(message.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<article
			className={`message message-${message.role}${message.isError || message.errorMessage ? " is-error" : ""}`}
		>
			{isAssistant ? (
				<div className="assistant-label">
					<span>{modelLabel ?? "Pi"}</span>
					{isStreaming && streamCharacterCountRef.current > 0 ? (
						<span className="stream-token-count">↓{Math.round(streamCharacterCountRef.current / 4)}</span>
					) : null}
					{streamTps !== undefined ? (
						<span className={`stream-tps ${speedTone(streamTps)}`}>{streamTps.toFixed(1)} t/s</span>
					) : null}
					{message.timestamp && isLastAssistant ? <time>{formatMessageTime(message.timestamp)}</time> : null}
				</div>
			) : null}
			<div className="message-content">
				{isAssistant && (message.errorMessage || message.stopReason === "error") ? (
					<div className="message-provider-error" role="alert">
						<strong>模型服务商错误</strong>
						<span>{message.errorMessage ?? "模型响应异常终止。"}</span>
					</div>
				) : null}
				{isAssistant && message.blocks?.length ? (
					message.blocks.map((block, index) => <TranscriptBlock key={`${block.type}:${index}`} block={block} />)
				) : isAssistant ? (
					<MarkdownBody text={message.text || ""} />
				) : message.role === "custom" ? (
					<div className="message-custom-body">
						{message.display ? <strong>{message.display}</strong> : null}
						{message.text ? <MarkdownBody text={message.text} /> : null}
						{message.details ? <pre>{message.details}</pre> : null}
					</div>
				) : (
					<UserMessageBody text={message.text} blocks={message.blocks} />
				)}
			</div>
			{!isAssistant && message.timestamp ? (
				<time className="message-time">{formatMessageTime(message.timestamp)}</time>
			) : null}
			{isAssistant && message.usage && (message.usage.input > 0 || message.usage.output > 0) ? (
				<div className="message-usage">
					<span>{formatUsageSummary(message.usage)}</span>
					{durationSeconds ? <span>{durationSeconds}s</span> : null}
					{completedTps ? (
						<span className={`message-tps ${speedTone(completedTps)}`}>{completedTps.toFixed(1)} t/s</span>
					) : null}
					<button type="button" onClick={() => void copyMessage()}>
						{copied ? "已复制" : "复制"}
					</button>
					{message.timestamp && isLastAssistant ? <time>{formatMessageTime(message.timestamp)}</time> : null}
				</div>
			) : (
				<div className="message-actions">
					<button type="button" onClick={() => void copyMessage()} disabled={!message.text}>
						{copied ? "已复制" : "复制"}
					</button>
					{!isAssistant && message.text ? (
						<button type="button" onClick={() => onEdit(message)}>
							编辑
						</button>
					) : null}
					{!isAssistant && message.forkEntryId ? (
						<button type="button" onClick={() => onFork(message.forkEntryId ?? "")}>
							Fork
						</button>
					) : null}
				</div>
			)}
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
	previousTimestamp,
}: {
	message: DesktopTranscriptMessage;
	toolCall?: { name: string; input: string };
	previousTimestamp?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	const [fullOutput, setFullOutput] = useState<string>();
	const [loadingFullOutput, setLoadingFullOutput] = useState(false);
	const [fullOutputError, setFullOutputError] = useState<string>();
	const [savingFullOutput, setSavingFullOutput] = useState(false);
	async function copyOutput(): Promise<void> {
		await navigator.clipboard.writeText(fullOutput ?? message.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	}
	const displayedOutput = fullOutput ?? message.text;
	const isDiff = message.role === "tool" && /(^|\n)@@ |(^|\n)diff --git |(^|\n)--- /u.test(displayedOutput);
	const durationSeconds =
		(message.role === "tool" || message.command) &&
		message.timestamp !== undefined &&
		previousTimestamp !== undefined &&
		message.timestamp >= previousTimestamp
			? ((message.timestamp - previousTimestamp) / 1000).toFixed(1)
			: undefined;
	async function loadFullOutput(): Promise<void> {
		setLoadingFullOutput(true);
		setFullOutputError(undefined);
		try {
			setFullOutput(await readFullBashOutput(message.id));
		} catch (error) {
			setFullOutputError(error instanceof Error ? error.message : String(error));
		} finally {
			setLoadingFullOutput(false);
		}
	}
	async function downloadFullOutput(): Promise<void> {
		setSavingFullOutput(true);
		setFullOutputError(undefined);
		try {
			await saveFullBashOutput(message.id);
		} catch (error) {
			setFullOutputError(error instanceof Error ? error.message : String(error));
		} finally {
			setSavingFullOutput(false);
		}
	}
	return (
		<article className={`transcript-entry ${expanded ? "is-expanded" : ""}`}>
			<button
				className={`entry-toggle ${message.isError ? "is-error" : "is-success"}`}
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
				{durationSeconds !== undefined ? <small className="entry-duration">{durationSeconds}s</small> : null}
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
								? displayedOutput.split("\n").map((line, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定
										<span className={transcriptDiffLineClass(line)} key={index}>
											{line || " "}
											{"\n"}
										</span>
									))
								: displayedOutput || "…"}
						</code>
						{message.command ? (
							<small>
								{message.cancelled ? "已取消" : `退出码 ${message.exitCode ?? "未知"}`}
								{message.truncated ? " · 输出已截断" : ""}
							</small>
						) : null}
					</pre>
					<div className="entry-detail-actions">
						<button type="button" onClick={() => void copyOutput()} disabled={!displayedOutput}>
							{copied ? "已复制" : "复制输出"}
						</button>
						{message.truncated && message.fullOutputAvailable && fullOutput === undefined ? (
							<button type="button" disabled={loadingFullOutput} onClick={() => void loadFullOutput()}>
								{loadingFullOutput ? "正在读取…" : "查看完整输出"}
							</button>
						) : message.truncated && fullOutput === undefined ? (
							<span>输出已截断</span>
						) : null}
						{message.fullOutputAvailable ? (
							<button type="button" disabled={savingFullOutput} onClick={() => void downloadFullOutput()}>
								{savingFullOutput ? "正在保存…" : "下载完整输出"}
							</button>
						) : null}
						{fullOutput !== undefined ? <span>已显示完整输出</span> : null}
						{fullOutputError ? <span className="is-error">{fullOutputError}</span> : null}
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
	onDownload: (path: string) => void;
	onMention: (path: string) => void;
	onOpenFile: (entry: DesktopWorkspaceEntry) => void;
	onRefresh: () => void;
	onTrustProject: () => void;
	onUpload: (files: File[]) => void;
}

function Explorer({
	entries,
	error,
	isLoading,
	isTrusted,
	selectedPath,
	workspacePath,
	onChooseWorkspace,
	onDownload,
	onMention,
	onOpenFile,
	onRefresh,
	onTrustProject,
	onUpload,
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
	const changedDirectories = useMemo(() => {
		const directories = new Set<string>();
		for (const change of gitChanges) {
			const segments = change.path.split("/");
			for (let index = 1; index < segments.length; index += 1) {
				directories.add(segments.slice(0, index).join("/"));
			}
		}
		return directories;
	}, [gitChanges]);
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
		<section
			className="explorer-body"
			aria-label="项目文件树和上传区域"
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				event.preventDefault();
				onUpload(Array.from(event.dataTransfer.files));
			}}
		>
			<div className="sidebar-section-title">
				<span>文件</span>
				<label className="file-upload-button" title="上传文件">
					＋
					<input type="file" multiple onChange={(event) => onUpload(Array.from(event.target.files ?? []))} />
				</label>
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
						<div
							className={`tree-entry file-entry ${selectedPath === entry.path ? "is-selected" : ""}`}
							key={entry.path}
							style={{ "--entry-depth": entry.depth } as CSSProperties}
						>
							<button className="tree-entry-main" type="button" onClick={() => onOpenFile(entry)}>
								<span className="tree-file-icon">
									<Icon name={fileIconFor(entry.path)} size={13} />
								</span>
								<span className="tree-entry-name">{normalizedSearch ? entry.path : entry.name}</span>
							</button>
							{gitStatusByPath.get(entry.path) ? (
								<span className={`tree-git-status is-${gitStatusByPath.get(entry.path)}`}>
									{gitStatusByPath.get(entry.path)?.slice(0, 1).toUpperCase()}
								</span>
							) : null}
							<div className="tree-entry-actions">
								<button type="button" title={`提及 ${entry.path}`} onClick={() => onMention(entry.path)}>
									@
								</button>
								<button type="button" title={`下载 ${entry.path}`} onClick={() => onDownload(entry.path)}>
									↓
								</button>
							</div>
						</div>
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
							{changedDirectories.has(entry.path) ? <span className="directory-change-dot" /> : null}
						</button>
					),
				)}
				{normalizedSearch && visibleEntries.length === 0 ? (
					<p className="sidebar-loading">没有匹配的文件。</p>
				) : null}
			</div>
		</section>
	);
}

interface FileTab {
	path: string;
	preview: DesktopWorkspaceFilePreview;
}

function Inspector({
	tabs,
	activeTabPath,
	changedHint,
	onReloadChanged,
	onClose,
	onOpenFile,
	onRevealFile,
	onDownload,
	onCopyPath,
	onCopyContent,
	onQuoteLineRange,
}: {
	tabs: FileTab[];
	activeTabPath: string | undefined;
	changedHint: boolean;
	onReloadChanged: () => void;
	onClose: () => void;
	onOpenFile: (path: string) => void;
	onRevealFile: (path: string) => void;
	onDownload: (path: string) => void;
	onCopyPath: (path: string) => void;
	onCopyContent: (content: string) => void;
	onQuoteLine: (path: string, line: number) => void;
	onQuoteLineRange: (path: string, line: number, extend: boolean) => void;
}) {
	const [mode, setMode] = useState<"diff" | "preview" | "source">("source");
	const [contentQuery, setContentQuery] = useState("");
	const [wrapLines, setWrapLines] = useState(() => localStorage.getItem("pi-desktop-file-wrap") === "on");
	const [diffText, setDiffText] = useState<string>();
	const [diffLoading, setDiffLoading] = useState(false);
	const activeTab = tabs.find((tab) => tab.path === activeTabPath);
	const preview = activeTab?.preview;
	const isImage = preview ? preview.imageDataUrl !== undefined : false;
	const isAudio = preview ? preview.audioDataUrl !== undefined : false;
	const isPdf = preview ? preview.pdfDataUrl !== undefined : false;
	const isDocx = preview ? preview.docxHtml !== undefined : false;
	const isPreviewable = preview ? isMarkdownFile(preview.path) || isHtmlFile(preview.path) || isDocx : false;
	const previewPath = preview?.path;

	const loadDiff = useCallback(async (path: string) => {
		setDiffLoading(true);
		try {
			setDiffText(await getGitDiff(path));
		} catch {
			setDiffText("");
		} finally {
			setDiffLoading(false);
		}
	}, []);

	useEffect(() => {
		if (mode !== "diff" || !previewPath) return;
		void loadDiff(previewPath);
	}, [loadDiff, mode, previewPath]);

	useEffect(() => {
		setMode(
			isMarkdownFile(previewPath ?? "") ||
				isHtmlFile(previewPath ?? "") ||
				previewPath?.toLocaleLowerCase().endsWith(".docx")
				? "preview"
				: "source",
		);
	}, [previewPath]);

	useEffect(() => {
		localStorage.setItem("pi-desktop-file-wrap", wrapLines ? "on" : "off");
	}, [wrapLines]);

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
			<div className="inspector-header">
				<div className="inspector-title">
					{preview ? (
						<>
							<span className="inspector-file-icon">
								<Icon name={fileIconFor(preview.path)} size={15} />
							</span>
							<strong title={preview.path}>{preview.path.split("/").at(-1) ?? preview.path}</strong>
							{changedHint ? (
								<button
									className="file-live-badge"
									type="button"
									title="文件已在磁盘上更新，点击重新加载"
									onClick={onReloadChanged}
								>
									<span className="file-live-dot" />
									已更新
								</button>
							) : (
								<span className="file-live-badge is-static">
									<span className="file-live-dot" />
									Live
								</span>
							)}
							<small className="inspector-meta">
								{isImage
									? getFileKindLabel(preview.path)
									: `${getFileKindLabel(preview.path)} · ${lineCount} 行 · ${formatByteSize(byteSize)}`}
							</small>
						</>
					) : (
						<strong>未选择文件</strong>
					)}
				</div>
				<div className="inspector-header-actions">
					{preview && !isImage && !isAudio && !isPdf && !isDocx ? (
						<div className="inspector-segmented" role="tablist" aria-label="显示模式">
							<button
								aria-pressed={mode === "source"}
								className={mode === "source" ? "is-active" : ""}
								type="button"
								onClick={() => setMode("source")}
							>
								源码
							</button>
							{isPreviewable ? (
								<button
									aria-pressed={mode === "preview"}
									className={mode === "preview" ? "is-active" : ""}
									type="button"
									onClick={() => setMode("preview")}
								>
									预览
								</button>
							) : null}
							<button
								aria-pressed={mode === "diff"}
								className={mode === "diff" ? "is-active" : ""}
								type="button"
								onClick={() => setMode("diff")}
							>
								差异
							</button>
						</div>
					) : null}
					{preview && !isImage && !isAudio && !isPdf && !isDocx ? (
						<button
							className={`icon-button ${wrapLines ? "is-active" : ""}`}
							type="button"
							aria-label={wrapLines ? "关闭自动换行" : "开启自动换行"}
							aria-pressed={wrapLines}
							onClick={() => setWrapLines((current) => !current)}
						>
							<Icon name="wrap" size={16} />
						</button>
					) : null}
					{preview ? (
						<button
							className="icon-button"
							type="button"
							aria-label="复制文件路径"
							onClick={() => onCopyPath(preview.path)}
						>
							<Icon name="copy" size={16} />
						</button>
					) : null}
					{preview?.content ? (
						<button
							className="icon-button"
							type="button"
							aria-label="复制文件内容"
							onClick={() => onCopyContent(preview.content)}
						>
							<Icon name="copy" size={16} />
						</button>
					) : null}
					{preview ? (
						<button
							className="icon-button"
							type="button"
							aria-label="下载文件"
							onClick={() => onDownload(preview.path)}
						>
							<Icon name="doc" size={16} />
						</button>
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
			{preview && !isImage && !isAudio && !isPdf && mode === "source" ? (
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
				) : isPdf ? (
					<div className="file-document-preview">
						<iframe src={preview.pdfDataUrl} title={`PDF 预览：${preview.path}`} />
					</div>
				) : mode === "preview" && isPreviewable ? (
					isHtmlFile(preview.path) || isDocx ? (
						<div className="file-document-preview">
							<iframe
								sandbox=""
								srcDoc={isDocx ? preview.docxHtml : preview.content}
								title={`${isDocx ? "DOCX" : "HTML"} 预览：${preview.path}`}
							/>
						</div>
					) : (
						<div className="file-preview-rendered">
							<MarkdownBody text={preview.content} />
						</div>
					)
				) : mode === "diff" ? (
					diffLoading ? (
						<p className="inspector-diff-empty">正在读取差异…</p>
					) : diffText ? (
						<div className="file-preview-source is-diff-view">
							{diffText.split("\n").map((line, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定
								<span className={`source-line is-diff-line ${transcriptDiffLineClass(line)}`} key={index}>
									<span className="source-line-number" />
									<code>{line || " "}</code>
								</span>
							))}
						</div>
					) : (
						<p className="inspector-diff-empty">该文件没有未提交的更改。</p>
					)
				) : (
					<div className={`file-preview-source ${wrapLines ? "is-wrapped" : ""}`}>
						{sourceLines.map((sourceLine) => (
							<button
								className={`source-line ${sourceLine.match ? "is-match" : ""}`}
								key={sourceLine.line}
								type="button"
								title="点击引用此行，Shift+点击引用行范围"
								onClick={(event) => onQuoteLineRange(preview.path, sourceLine.line, event.shiftKey)}
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
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const stored = localStorage.getItem("pi-desktop-theme");
		return stored === "light" || stored === "dark"
			? stored
			: window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
	});
	const [sidebarWidth, setSidebarWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-sidebar-width")) || 260,
	);
	const [inspectorWidth, setInspectorWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-inspector-width")) || 760,
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
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const [sessionMenuOpen, setSessionMenuOpen] = useState<string>();
	const [deleteSessionPath, setDeleteSessionPath] = useState<string>();
	const [moreMenuOpen, setMoreMenuOpen] = useState(false);
	const [renamingSession, setRenamingSession] = useState<{ path: string; name: string }>();
	const [modelFilter, setModelFilter] = useState("");
	const [projectRowMenuOpen, setProjectRowMenuOpen] = useState<string>();
	const [extensionDialog, setExtensionDialog] = useState<DesktopExtensionDialog>();
	const [extensionDialogSessionId, setExtensionDialogSessionId] = useState<string>();
	const [extensionCustomUi, setExtensionCustomUi] = useState<{ sessionId: string; id: string; lines: string[] }>();
	const [respondingExtension, setRespondingExtension] = useState(false);
	const [changedFileHint, setChangedFileHint] = useState(false);
	const [trustDialogOpen, setTrustDialogOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [openingWorkspace, setOpeningWorkspace] = useState(false);
	const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
	const [directoryPickerError, setDirectoryPickerError] = useState<string>();
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
	const [submittingSessionId, setSubmittingSessionId] = useState<string>();
	const [aborting, setAborting] = useState(false);
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	const [unseenMessages, setUnseenMessages] = useState(0);
	const [changingTrust, setChangingTrust] = useState(false);
	const [settingUpProvider, setSettingUpProvider] = useState(false);
	const [settingModel, setSettingModel] = useState(false);
	const [draggingImages, setDraggingImages] = useState(false);
	const [attachments, setAttachments] = useState<DesktopImageAttachment[]>([]);
	const [pendingFileConflicts, setPendingFileConflicts] = useState<{
		files: File[];
		names: string[];
		mentionAfterImport: boolean;
	}>();
	const [selectedProviderId, setSelectedProviderId] = useState("");
	const [authenticationResponse, setAuthenticationResponse] = useState("");
	const [respondingToAuthenticationPromptId, setRespondingToAuthenticationPromptId] = useState<string>();
	const [resolvingApprovalId, setResolvingApprovalId] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [notices, setNotices] = useState<
		Array<{ id: number; kind: "error" | "success" | "warning" | "accent"; text: string }>
	>([]);
	const noticeIdRef = useRef(0);
	const pushNotice = useCallback((kind: "error" | "success" | "warning" | "accent", text: string) => {
		const id = ++noticeIdRef.current;
		setNotices((current) => [...current.slice(-4), { id, kind, text }]);
		window.setTimeout(() => {
			setNotices((current) => current.filter((notice) => notice.id !== id));
		}, 5000);
	}, []);
	const [workspaceEntries, setWorkspaceEntries] = useState<DesktopWorkspaceEntry[]>([]);
	const [mentionEntries, setMentionEntries] = useState<DesktopWorkspaceEntry[]>([]);
	const [gitWorktrees, setGitWorktrees] = useState<DesktopGitWorktree[]>([]);
	const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
	const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | undefined>();
	const [fileExplorerError, setFileExplorerError] = useState<string>();
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [loadingFilePath, setLoadingFilePath] = useState<string>();
	const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem("pi-desktop-inspector-open") === "on");
	const [rightPanelMode, setRightPanelMode] = useState<"files" | "source">(
		() => (localStorage.getItem("pi-desktop-right-panel-mode") as "files" | "source" | null) ?? "files",
	);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [isOnline, setIsOnline] = useState(() => navigator.onLine);
	const [configModal, setConfigModal] = useState<ConfigModal | undefined>();
	const [topPanel, setTopPanel] = useState<"branches" | "session" | "system" | undefined>();
	const [namingState, setNamingState] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [sessionSearch, setSessionSearch] = useState("");
	const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
	const [archivedProjectRoots, setArchivedProjectRoots] = useState<Set<string>>(() => {
		try {
			const value: unknown = JSON.parse(localStorage.getItem("pi-desktop-archived-projects") ?? "[]");
			return new Set(Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem("pi-desktop-unread-sessions") ?? "[]");
			return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [composerMenu, setComposerMenu] = useState<"project" | "model" | "thinking" | "tools" | undefined>();
	const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
	const [historyActiveIndex, setHistoryActiveIndex] = useState(-1);
	const [projectFilter, setProjectFilter] = useState("");
	const [toolPreset, setToolPreset] = useState<"off" | "default" | "full">(
		() => (localStorage.getItem("pi-desktop-tool-preset") as "off" | "default" | "full" | null) ?? "default",
	);
	const [compacting, setCompacting] = useState(false);
	const [compactError, setCompactError] = useState<string>();
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const fileRequestId = useRef(0);
	const chatScrollRef = useRef<HTMLDivElement>(null);
	const earlierMessagesSentinelRef = useRef<HTMLDivElement>(null);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const loadingEarlierMessagesRef = useRef(false);
	const stickToBottomRef = useRef(true);
	const previousMessageSignatureRef = useRef("");
	const previousSessionIdRef = useRef<string | undefined>(undefined);
	const scrollMemoryRef = useRef(new Map<string, { scrollTop: number; visibleItemCount: number }>());
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const promptHistoryRef = useRef<string[]>([]);
	const promptHistoryIndexRef = useRef(-1);
	const selectedSessionReferenceLabelsRef = useRef(new Set<string>());
	const draftBeforeHistoryRef = useRef("");
	const hydratedDraftKeyRef = useRef<string | undefined>(undefined);
	const extensionEditorRequestRef = useRef<number | undefined>(undefined);
	const previousPhaseRef = useRef<DesktopSessionPhase | undefined>(undefined);
	const previousSessionPhasesRef = useRef<Map<string, DesktopSessionPhase | undefined>>(new Map());
	const restorationAttemptedRef = useRef(false);
	const apiKeyProviderIds = snapshot.apiKeyProviders.map((provider) => provider.id).join("\u0000");
	const authenticationPrompt = snapshot.pendingAuthenticationPrompts[0];
	const session = snapshot.session;
	const knownWorkspacePaths = useMemo(
		() =>
			[
				...snapshot.sessions
					.slice()
					.sort((left, right) => right.modified - left.modified)
					.map((item) => item.cwd),
				...recentWorkspaces,
			].filter((path, index, paths) => paths.indexOf(path) === index),
		[recentWorkspaces, snapshot.sessions],
	);
	const currentSessionPath = snapshot.sessions.find((item) => item.id === session?.id)?.path;
	const submitting = submittingSessionId === session?.id;
	const draftKey = `${DRAFT_STORAGE_PREFIX}${session?.id ?? snapshot.workspacePath ?? "new"}`;
	const lastMessage = session?.messages.at(-1);
	const messageSignature = `${session?.id ?? ""}:${session?.messages.length ?? 0}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}`;
	const firstUserText = session?.messages.find((message) => message.role === "user")?.text.trim() ?? "";
	const topBarTitle =
		session?.name ??
		(firstUserText ? (firstUserText.length > 40 ? `${firstUserText.slice(0, 40)}…` : firstUserText) : "新任务");
	const topBarSubtitle = snapshot.workspacePath
		? (snapshot.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? snapshot.workspacePath)
		: (snapshot.userHomeName ?? "Pi");
	const stats = snapshot.sessionStats;
	const compactionBanner = (() => {
		const compaction = session?.lastCompaction;
		if (!compaction) return undefined;
		const saved = compaction.tokensAfter !== undefined ? compaction.tokensBefore - compaction.tokensAfter : undefined;
		const after = compaction.tokensAfter !== undefined ? ` → ${formatCompact(compaction.tokensAfter)}k` : "";
		return `上下文已压缩（${compaction.reason}）：${formatCompact(compaction.tokensBefore)}k${after} tokens${
			saved !== undefined && saved > 0 ? `，节省 ${formatCompact(saved)}k` : ""
		}`;
	})();
	const filteredModels = (() => {
		const query = modelFilter.trim().toLocaleLowerCase();
		if (!query) return snapshot.availableModels;
		return snapshot.availableModels.filter(
			(model) => model.id.toLocaleLowerCase().includes(query) || model.name.toLocaleLowerCase().includes(query),
		);
	})();
	const statsSummary = (() => {
		if (!stats || stats.tokens.total === 0) return undefined;
		const parts = [`↑${formatCompact(stats.tokens.input)}`, `↓${formatCompact(stats.tokens.output)}`];
		if (stats.cost > 0) parts.push(stats.cost >= 0.01 ? `$${stats.cost.toFixed(2)}` : "<$0.01");
		if (stats.contextUsage?.percent !== null && stats.contextUsage?.percent !== undefined)
			parts.push(`${stats.contextUsage.percent.toFixed(1)}% ctx`);
		return parts.join(" · ");
	})();
	const transcriptItems = useMemo(() => partitionTranscript(session?.messages ?? []), [session?.messages]);
	const conversationTurns = useMemo(() => buildConversationTurns(session?.messages ?? []), [session?.messages]);
	const conversationTurnIndexes = useMemo(
		() => new Map(conversationTurns.map((turn, index) => [turn.messageId, index])),
		[conversationTurns],
	);
	const previousMessageTimestamps = useMemo(() => {
		const result = new Map<string, number>();
		let previousTimestamp: number | undefined;
		for (const message of session?.messages ?? []) {
			if (previousTimestamp !== undefined) result.set(message.id, previousTimestamp);
			if (message.timestamp !== undefined) previousTimestamp = message.timestamp;
		}
		return result;
	}, [session?.messages]);
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
	const slashMatch = draft.match(/^\s*\/([^\s]*)$/u);
	const slashActive = slashMatch !== null;
	const slashQuery = slashMatch?.[1]?.toLocaleLowerCase() ?? "";
	const slashCommands = [
		{ name: "compact", description: "压缩对话上下文，可附加指示", category: "会话" },
		{ name: "name", description: "重命名当前会话", category: "会话" },
		{ name: "copy", description: "复制最后一条回答", category: "会话" },
		{ name: "session", description: "查看会话统计", category: "会话" },
		{ name: "reload", description: "重新加载扩展与资源", category: "会话" },
		{ name: "help", description: "显示桌面端可用命令", category: "帮助" },
		{ name: "model", description: "打开具体模型选择", category: "模型" },
		{ name: "login", description: "配置模型服务商", category: "模型" },
		{ name: "project", description: "打开项目文件夹", category: "项目" },
		{ name: "files", description: "打开文件浏览", category: "项目" },
		{ name: "settings", description: "打开设置", category: "设置" },
		{ name: "skills", description: "打开技能列表", category: "扩展" },
		{ name: "plugins", description: "打开插件列表", category: "扩展" },
		{ name: "trust", description: "切换当前项目的信任状态", category: "安全" },
		...snapshot.skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			category: "技能",
		})),
		...snapshot.plugins.flatMap((plugin) =>
			plugin.commands.map((command) => ({ name: command, description: `插件 ${plugin.name}`, category: "插件" })),
		),
	]
		.map((command) => ({ ...command, score: fuzzyMatchScore(`${command.name} ${command.description}`, slashQuery) }))
		.filter((command): command is typeof command & { score: number } => command.score !== undefined)
		.sort((left, right) => left.score - right.score || left.name.localeCompare(right.name));
	const atMatch = draft.match(/(?:^|\s)@([^\s]*)$/u);
	const atActive = atMatch !== null;
	const atQuery = atMatch?.[1]?.toLocaleLowerCase() ?? "";
	const atEntries = (atQuery ? mentionEntries : workspaceEntries)
		.map((entry) => ({ entry, score: fuzzyMatchScore(entry.path, atQuery) }))
		.filter((result): result is typeof result & { score: number } => result.score !== undefined)
		.sort((left, right) => left.score - right.score || left.entry.path.localeCompare(right.entry.path))
		.slice(0, 12)
		.map((result) => result.entry);
	const hashMatch = draft.match(/(?:^|\s)#([^\s]*)$/u);
	const hashActive = hashMatch !== null;
	const hashQuery = hashMatch?.[1]?.toLocaleLowerCase() ?? "";
	const hashSessions = snapshot.sessions
		.map((item) => ({ item, score: fuzzyMatchScore(`${item.name ?? ""} ${item.firstMessage}`, hashQuery) }))
		.filter((result): result is typeof result & { score: number } => result.score !== undefined)
		.sort((left, right) => left.score - right.score || right.item.modified - left.item.modified)
		.slice(0, 8)
		.map((result) => result.item);
	const visibleSlashCommands = slashCommands.slice(0, 12);
	const [menusDismissed, setMenusDismissed] = useState(false);
	const [visibleItemCount, setVisibleItemCount] = useState(40);
	const suggestionCount = !menusDismissed
		? slashActive
			? visibleSlashCommands.length
			: hashActive
				? hashSessions.length
				: atActive
					? atEntries.length
					: 0
		: 0;

	useEffect(() => {
		void startDesktopStore();
	}, []);
	useEffect(() => {
		if (restorationAttemptedRef.current || snapshot.sessions.length === 0) return;
		restorationAttemptedRef.current = true;
		const savedSessionPath = localStorage.getItem("pi-desktop-last-session-path");
		if (savedSessionPath && snapshot.sessions.some((item) => item.path === savedSessionPath)) {
			void openSession({ sessionPath: savedSessionPath });
			return;
		}
		const savedWorkspace = localStorage.getItem("pi-desktop-last-workspace");
		if (savedWorkspace && savedWorkspace !== snapshot.workspacePath) void openWorkspacePath(savedWorkspace);
	}, [snapshot.sessions, snapshot.workspacePath]);
	useEffect(() => {
		if (snapshot.workspacePath) localStorage.setItem("pi-desktop-last-workspace", snapshot.workspacePath);
	}, [snapshot.workspacePath]);
	useEffect(() => {
		if (currentSessionPath) localStorage.setItem("pi-desktop-last-session-path", currentSessionPath);
	}, [currentSessionPath]);
	useEffect(() => {
		const handleOnline = () => setIsOnline(true);
		const handleOffline = () => setIsOnline(false);
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);
	useEffect(() => {
		let active = true;
		hydratedDraftKeyRef.current = undefined;
		setDraft(localStorage.getItem(draftKey) ?? "");
		setAttachments([]);
		let ids: string[] = [];
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(`${draftKey}:attachments`) ?? "[]");
			if (Array.isArray(stored)) {
				ids = stored.filter((id): id is string => typeof id === "string").slice(0, MAX_IMAGE_ATTACHMENTS);
			}
		} catch {
			// Ignore malformed attachment draft metadata.
		}
		void restoreImageAttachments(ids)
			.catch(() => [])
			.then((restored) => {
				if (!active) return;
				setAttachments(restored);
				hydratedDraftKeyRef.current = draftKey;
			});
		return () => {
			active = false;
		};
	}, [draftKey]);
	useEffect(() => {
		if (hydratedDraftKeyRef.current !== draftKey) return;
		localStorage.setItem(draftKey, draft);
		const ids = attachments.map((attachment) => attachment.id);
		if (ids.length) localStorage.setItem(`${draftKey}:attachments`, JSON.stringify(ids));
		else localStorage.removeItem(`${draftKey}:attachments`);
		let knownKeys: string[] = [];
		try {
			const value: unknown = JSON.parse(localStorage.getItem(DRAFT_INDEX_STORAGE_KEY) ?? "[]");
			if (Array.isArray(value)) knownKeys = value.filter((key): key is string => typeof key === "string");
		} catch {
			// Start a fresh index when older local state is malformed.
		}
		const nextKeys = [draftKey, ...knownKeys.filter((key) => key !== draftKey)].slice(0, MAX_STORED_DRAFTS);
		for (const staleKey of knownKeys.slice(MAX_STORED_DRAFTS - 1)) {
			if (!nextKeys.includes(staleKey)) {
				localStorage.removeItem(staleKey);
				localStorage.removeItem(`${staleKey}:attachments`);
			}
		}
		localStorage.setItem(DRAFT_INDEX_STORAGE_KEY, JSON.stringify(nextKeys));
	}, [attachments, draft, draftKey]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: resizePrompt 不捕获响应式状态。
	useEffect(() => {
		const request = snapshot.extensionEditorRequest;
		if (!request || extensionEditorRequestRef.current === request.id) return;
		extensionEditorRequestRef.current = request.id;
		const textarea = promptRef.current;
		const start = textarea?.selectionStart ?? draft.length;
		const end = textarea?.selectionEnd ?? start;
		const next =
			request.mode === "replace" ? request.text : `${draft.slice(0, start)}${request.text}${draft.slice(end)}`;
		setDraft(next);
		requestAnimationFrame(() => {
			const prompt = promptRef.current;
			if (!prompt) return;
			const cursor = request.mode === "replace" ? request.text.length : start + request.text.length;
			prompt.focus();
			prompt.setSelectionRange(cursor, cursor);
			resizePrompt(prompt);
		});
	}, [draft, snapshot.extensionEditorRequest]);
	function resizePrompt(textarea: HTMLTextAreaElement): void {
		textarea.style.height = "auto";
		textarea.style.height = textarea.value ? `${Math.min(textarea.scrollHeight, 180)}px` : "24px";
	}
	const shortcutStateRef = useRef({
		hadTransientUi: false,
		running: false,
		newSession: handleNewSession,
		abort: handleAbort,
	});
	shortcutStateRef.current = {
		hadTransientUi: Boolean(
			configModal ||
				(extensionDialog && extensionDialogSessionId === session?.id) ||
				(extensionCustomUi && extensionCustomUi.sessionId === session?.id) ||
				trustDialogOpen ||
				topPanel ||
				composerMenu ||
				historyMenuOpen ||
				projectMenuOpen ||
				sessionMenuOpen ||
				deleteSessionPath ||
				moreMenuOpen ||
				projectRowMenuOpen,
		),
		running: session?.phase === "running",
		newSession: handleNewSession,
		abort: handleAbort,
	};
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				promptRef.current?.focus();
			} else if (event.key.toLowerCase() === "n") {
				event.preventDefault();
				void shortcutStateRef.current.newSession();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const shortcutState = shortcutStateRef.current;
			setMenusDismissed(true);
			setComposerMenu(undefined);
			setHistoryMenuOpen(false);
			setTopPanel(undefined);
			setProjectMenuOpen(false);
			setSessionMenuOpen(undefined);
			setMoreMenuOpen(false);
			setProjectRowMenuOpen(undefined);
			if (!shortcutState.hadTransientUi && shortcutState.running) void shortcutState.abort();
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
		if (!projectMenuOpen && composerMenu !== "project") setProjectFilter("");
	}, [composerMenu, projectMenuOpen]);
	useEffect(() => {
		const apply = () => {
			document.documentElement.dataset.theme = theme;
		};
		apply();
		localStorage.setItem("pi-desktop-theme", theme);
	}, [theme]);
	useEffect(() => {
		if (!projectMenuOpen && !sessionMenuOpen && !moreMenuOpen && !projectRowMenuOpen) return;
		const close = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				setProjectMenuOpen(false);
				setSessionMenuOpen(undefined);
				setDeleteSessionPath(undefined);
				setMoreMenuOpen(false);
				setProjectRowMenuOpen(undefined);
				return;
			}
			if (!target.closest(".project-menu-root")) {
				setProjectMenuOpen(false);
				setProjectRowMenuOpen(undefined);
			}
			if (!target.closest(".session-row-wrap")) setSessionMenuOpen(undefined);
			if (!target.closest(".top-bar-more-wrap")) setMoreMenuOpen(false);
			if (!target.closest(".top-bar")) setTopPanel(undefined);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [projectMenuOpen, sessionMenuOpen, moreMenuOpen, projectRowMenuOpen]);
	useEffect(() => {
		if (historyActiveIndex < promptHistoryRef.current.length) return;
		setHistoryActiveIndex(Math.max(0, promptHistoryRef.current.length - 1));
	}, [historyActiveIndex]);
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
		localStorage.setItem("pi-desktop-unread-sessions", JSON.stringify([...unreadSessionIds]));
	}, [unreadSessionIds]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-archived-projects", JSON.stringify([...archivedProjectRoots]));
	}, [archivedProjectRoots]);
	useEffect(() => {
		const previous = previousSessionPhasesRef.current;
		const completed: DesktopSessionInfo[] = [];
		for (const item of snapshot.sessions) {
			if (previous.get(item.id) === "running" && item.phase === "idle" && item.id !== session?.id) {
				completed.push(item);
			}
			previous.set(item.id, item.phase);
		}
		if (completed.length) {
			setUnreadSessionIds((current) => new Set([...current, ...completed.map((item) => item.id)]));
			if (notifyOnComplete) {
				for (const item of completed) void notifyComplete(sessionTitle(item), true);
			}
		}
	}, [notifyOnComplete, session?.id, snapshot.sessions]);
	useEffect(() => {
		if (!session?.id) return;
		setUnreadSessionIds((current) => {
			if (!current.has(session.id)) return current;
			const next = new Set(current);
			next.delete(session.id);
			return next;
		});
	}, [session?.id]);
	useEffect(() => {
		const phase = session?.phase;
		if (previousPhaseRef.current === "running" && phase === "idle") {
			if (soundOnComplete) playCompletionTone();
			if (notifyOnComplete && !document.hasFocus()) void notifyComplete(session?.name);
		}
		previousPhaseRef.current = phase;
	}, [session?.name, session?.phase, notifyOnComplete, soundOnComplete]);
	useEffect(() => {
		const scroll = chatScrollRef.current;
		if (!scroll) return;
		if (previousSessionIdRef.current !== session?.id) {
			if (previousSessionIdRef.current) {
				scrollMemoryRef.current.set(previousSessionIdRef.current, {
					scrollTop: scroll.scrollTop,
					visibleItemCount,
				});
			}
			previousSessionIdRef.current = session?.id;
			previousMessageSignatureRef.current = messageSignature;
			const remembered = session?.id ? scrollMemoryRef.current.get(session.id) : undefined;
			setVisibleItemCount(remembered?.visibleItemCount ?? 40);
			requestAnimationFrame(() => {
				const currentScroll = chatScrollRef.current;
				if (!currentScroll) return;
				currentScroll.scrollTop = remembered?.scrollTop ?? currentScroll.scrollHeight;
				const isAway = currentScroll.scrollHeight - currentScroll.scrollTop - currentScroll.clientHeight > 80;
				stickToBottomRef.current = !isAway;
				setAwayFromBottom(isAway);
			});
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
	}, [messageSignature, session?.id, session?.phase, visibleItemCount]);
	useEffect(
		() => () => {
			if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current);
		},
		[],
	);
	useEffect(() => {
		const scroll = chatScrollRef.current;
		const sentinel = earlierMessagesSentinelRef.current;
		if (!scroll || !sentinel || visibleItemCount >= transcriptItems.length) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting || loadingEarlierMessagesRef.current) return;
				loadingEarlierMessagesRef.current = true;
				const previousHeight = scroll.scrollHeight;
				setVisibleItemCount((current) => Math.min(current + 60, transcriptItems.length));
				requestAnimationFrame(() => {
					const currentScroll = chatScrollRef.current;
					if (currentScroll) currentScroll.scrollTop += currentScroll.scrollHeight - previousHeight;
					loadingEarlierMessagesRef.current = false;
				});
			},
			{ root: scroll, rootMargin: "160px 0px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [transcriptItems.length, visibleItemCount]);
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
		let active = true;
		if (snapshot.projectTrusted && snapshot.workspacePath) {
			void refreshWorkspaceFiles();
			let savedPaths: string[] = [];
			try {
				const value: unknown = JSON.parse(
					localStorage.getItem(`pi-desktop-file-tabs:${snapshot.workspacePath}`) ?? "[]",
				);
				if (Array.isArray(value))
					savedPaths = value.filter((path): path is string => typeof path === "string").slice(0, 12);
			} catch {
				// Ignore malformed persisted file-tab state.
			}
			if (savedPaths.length) {
				void Promise.all(savedPaths.map((path) => readWorkspaceFile(path).catch(() => undefined))).then(
					(previews) => {
						if (!active) return;
						const tabs = previews
							.filter((preview): preview is DesktopWorkspaceFilePreview => preview !== undefined)
							.map((preview) => ({ path: preview.path, preview }));
						setFileTabs(tabs);
						const savedActive = localStorage.getItem(`pi-desktop-active-file-tab:${snapshot.workspacePath}`);
						setActiveTabPath(
							tabs.some((tab) => tab.path === savedActive) ? (savedActive ?? undefined) : tabs[0]?.path,
						);
						setInspectorOpen(tabs.length > 0);
					},
				);
			}
		}
		return () => {
			active = false;
		};
	}, [refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath]);
	useEffect(() => {
		if (!snapshot.workspacePath) return;
		localStorage.setItem(
			`pi-desktop-file-tabs:${snapshot.workspacePath}`,
			JSON.stringify(fileTabs.map((tab) => tab.path)),
		);
		if (activeTabPath) localStorage.setItem(`pi-desktop-active-file-tab:${snapshot.workspacePath}`, activeTabPath);
		else localStorage.removeItem(`pi-desktop-active-file-tab:${snapshot.workspacePath}`);
	}, [activeTabPath, fileTabs, snapshot.workspacePath]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-file-tree-open", fileTreeOpen ? "on" : "off");
		localStorage.setItem("pi-desktop-inspector-open", inspectorOpen ? "on" : "off");
		localStorage.setItem("pi-desktop-right-panel-mode", rightPanelMode);
	}, [fileTreeOpen, inspectorOpen, rightPanelMode]);
	useEffect(() => {
		if (!snapshot.workspacePath || !snapshot.projectTrusted) {
			setGitWorktrees([]);
			return;
		}
		let active = true;
		void listGitWorktrees()
			.then((items) => {
				if (active) setGitWorktrees(items);
			})
			.catch(() => {
				if (active) setGitWorktrees([]);
			});
		return () => {
			active = false;
		};
	}, [snapshot.projectTrusted, snapshot.workspacePath]);
	useEffect(() => {
		if (atQuery && snapshot.projectTrusted && snapshot.workspacePath && workspaceEntries.length === 0) {
			void refreshWorkspaceFiles();
		}
	}, [atQuery, refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath, workspaceEntries.length]);
	useEffect(() => {
		if (!atActive || !atQuery || !snapshot.projectTrusted || !snapshot.workspacePath) {
			setMentionEntries([]);
			return;
		}
		let active = true;
		const timer = window.setTimeout(() => {
			void searchWorkspaceFiles(atQuery)
				.then((entries) => {
					if (active) setMentionEntries(entries);
				})
				.catch(() => {
					if (active) setMentionEntries([]);
				});
		}, 140);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [atActive, atQuery, snapshot.projectTrusted, snapshot.workspacePath]);
	useEffect(() => {
		const unsubscribeExtensionUi = onExtensionUi((event) => {
			if (event.type === "dialog") {
				setExtensionDialog(event.dialog);
				setExtensionDialogSessionId(event.sessionId);
			} else if (event.type === "dialogClosed") {
				setExtensionDialog((current) => (current?.id === event.id ? undefined : current));
				setExtensionDialogSessionId((current) => (current === event.sessionId ? undefined : current));
			} else if (event.closed) {
				setExtensionCustomUi((current) => (current?.id === event.id ? undefined : current));
			} else {
				setExtensionCustomUi({ sessionId: event.sessionId, id: event.id, lines: event.lines });
			}
		});
		const unsubscribeChanges = onWorkspaceChanged((changes) => {
			if (!snapshot.projectTrusted || !snapshot.workspacePath) return;
			setWorkspaceRefreshToken((value) => value + 1);
			void refreshWorkspaceFiles();
			if (activeTabPath && changes.some((change) => change.path === activeTabPath)) {
				void readWorkspaceFile(activeTabPath)
					.then((preview) => {
						setFileTabs((tabs) =>
							tabs.map((tab) => (tab.path === preview.path ? { path: preview.path, preview } : tab)),
						);
						setChangedFileHint(false);
					})
					.catch(() => setChangedFileHint(true));
			}
		});
		return () => {
			unsubscribeExtensionUi();
			unsubscribeChanges();
		};
	}, [activeTabPath, refreshWorkspaceFiles, snapshot.projectTrusted, snapshot.workspacePath]);

	function handleChatScroll(): void {
		if (scrollFrameRef.current !== undefined) return;
		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = undefined;
			const scroll = chatScrollRef.current;
			if (!scroll) return;
			if (
				scroll.scrollTop < 120 &&
				visibleItemCount < transcriptItems.length &&
				!loadingEarlierMessagesRef.current
			) {
				loadingEarlierMessagesRef.current = true;
				const previousHeight = scroll.scrollHeight;
				setVisibleItemCount((current) => Math.min(current + 60, transcriptItems.length));
				requestAnimationFrame(() => {
					const currentScroll = chatScrollRef.current;
					if (currentScroll) currentScroll.scrollTop += currentScroll.scrollHeight - previousHeight;
					loadingEarlierMessagesRef.current = false;
				});
			}
			const isAway = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80;
			if (session?.id) {
				scrollMemoryRef.current.set(session.id, { scrollTop: scroll.scrollTop, visibleItemCount });
			}
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
		setActionError(undefined);
		setDirectoryPickerError(undefined);
		setDirectoryPickerOpen(true);
	}

	async function handleDirectorySelect(path: string): Promise<void> {
		if (!path || openingWorkspace) return;
		setOpeningWorkspace(true);
		setDirectoryPickerError(undefined);
		setActionError(undefined);
		try {
			await openWorkspacePath(path);
			setDirectoryPickerOpen(false);
		} catch (error) {
			setDirectoryPickerError(error instanceof Error ? error.message : String(error));
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

	async function handleNewSessionForProject(path: string): Promise<void> {
		setActionError(undefined);
		try {
			setArchivedProjectRoots((current) => {
				if (!current.has(path)) return current;
				const next = new Set(current);
				next.delete(path);
				return next;
			});
			if (snapshot.workspacePath !== path) await openWorkspacePath(path);
			await newSession();
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
		setTopPanel(undefined);
		setActionError(undefined);
		try {
			await navigateTree({ entryId });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleForkSession(): Promise<void> {
		setTopPanel(undefined);
		setActionError(undefined);
		try {
			await forkSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	function selectComposerSuggestion(index: number): void {
		setMenusDismissed(false);
		if (slashActive) {
			const command = visibleSlashCommands[index];
			if (!command) return;
			setDraft(`/${command.name}${command.name === "model" || command.name === "login" ? " " : ""}`);
		} else if (hashActive) {
			const item = hashSessions[index];
			if (!item) return;
			const label = item.name ?? item.firstMessage.slice(0, 40);
			selectedSessionReferenceLabelsRef.current.add(label);
			setDraft((current) => current.replace(/#[^\s]*$/u, `${formatSessionReference(label)} `));
		} else if (atActive) {
			const entry = atEntries[index];
			if (!entry) return;
			setDraft((current) =>
				current.replace(/@[^\s]*$/u, entry.type === "directory" ? `@${entry.path}/` : `@${entry.path} `),
			);
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
		setHistoryMenuOpen(false);
	}

	function clearSubmittedComposer(submissionSessionId: string | undefined, submissionDraftKey: string): void {
		localStorage.removeItem(submissionDraftKey);
		localStorage.removeItem(`${submissionDraftKey}:attachments`);
		if (getDesktopSnapshot().session?.id !== submissionSessionId) return;
		startTransition(() => {
			setAttachments([]);
			setDraft("");
		});
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;
		const submissionSessionId = session?.id;
		const submissionDraftKey = draftKey;
		rememberPrompt(draft);
		if (await handleDesktopSlashCommand(draft)) {
			startTransition(() => setDraft(""));
			return;
		}
		if (draft.startsWith("!") && !draft.startsWith("!!")) {
			const command = draft.slice(1).trim();
			if (command) {
				setSubmittingSessionId(submissionSessionId);
				setActionError(undefined);
				try {
					const output = await executeBashCommand(command, false);
					pushNotice("success", output ? output.slice(0, 300) : "命令执行完成。");
					clearSubmittedComposer(submissionSessionId, submissionDraftKey);
				} catch (error) {
					pushNotice("error", error instanceof Error ? error.message : String(error));
				} finally {
					setSubmittingSessionId((current) => (current === submissionSessionId ? undefined : current));
				}
			}
			return;
		}
		if (draft.startsWith("!!")) {
			const command = draft.slice(2).trim();
			if (command) {
				setSubmittingSessionId(submissionSessionId);
				setActionError(undefined);
				try {
					const output = await executeBashCommand(command, true);
					pushNotice("success", output ? output.slice(0, 300) : "命令执行完成（不进入上下文）。");
					clearSubmittedComposer(submissionSessionId, submissionDraftKey);
				} catch (error) {
					pushNotice("error", error instanceof Error ? error.message : String(error));
				} finally {
					setSubmittingSessionId((current) => (current === submissionSessionId ? undefined : current));
				}
			}
			return;
		}
		if (session?.phase === "running" && attachments.length > 0) {
			setActionError("智能体运行中不能在引导或排队消息中附加图片。");
			return;
		}
		setSubmittingSessionId(submissionSessionId);
		setActionError(undefined);
		try {
			await submitPrompt(
				draft,
				attachments.map((attachment) => attachment.id),
				session?.phase === "running" ? "followUp" : undefined,
				[...selectedSessionReferenceLabelsRef.current],
			);
			clearSubmittedComposer(submissionSessionId, submissionDraftKey);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmittingSessionId((current) => (current === submissionSessionId ? undefined : current));
		}
	}

	async function handleSteer(): Promise<void> {
		if (!canSubmit || session?.phase !== "running") return;
		if (attachments.length > 0) {
			setActionError("智能体运行中不能在引导或排队消息中附加图片。");
			return;
		}
		const submissionSessionId = session.id;
		const submissionDraftKey = draftKey;
		rememberPrompt(draft);
		setSubmittingSessionId(submissionSessionId);
		setActionError(undefined);
		try {
			await submitPrompt(
				draft,
				attachments.map((attachment) => attachment.id),
				"steer",
				[...selectedSessionReferenceLabelsRef.current],
			);
			clearSubmittedComposer(submissionSessionId, submissionDraftKey);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSubmittingSessionId((current) => (current === submissionSessionId ? undefined : current));
		}
	}

	async function handleAbort(): Promise<void> {
		if ((session?.phase !== "running" && !compacting) || aborting) return;
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
			pushNotice("success", `模型已切换到 ${modelId}`);
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
		setCompactError(undefined);
		try {
			await compactSession();
			pushNotice("success", "上下文压缩完成。");
		} catch (error) {
			setCompactError(error instanceof Error ? error.message : String(error));
		} finally {
			setCompacting(false);
		}
	}

	async function handleCompactWithInstructions(instructions: string): Promise<void> {
		if (!session || session.phase === "running" || compacting) return;
		setCompacting(true);
		setCompactError(undefined);
		try {
			await compactSession(instructions);
			pushNotice("success", "上下文压缩完成。");
		} catch (error) {
			setCompactError(error instanceof Error ? error.message : String(error));
		} finally {
			setCompacting(false);
		}
	}

	async function handleAutoName(): Promise<void> {
		if (!session || session.phase === "running" || namingState === "loading") return;
		setNamingState("loading");
		setActionError(undefined);
		try {
			await autoNameSession();
			setNamingState("success");
			window.setTimeout(() => setNamingState("idle"), 1600);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
			setNamingState("error");
			window.setTimeout(() => setNamingState("idle"), 2400);
		}
	}

	async function handleExportSession(): Promise<void> {
		setActionError(undefined);
		try {
			await exportSession();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function handleRenameSubmit(): Promise<void> {
		if (!renamingSession) return;
		const name = renamingSession.name.trim();
		if (!name) {
			setRenamingSession(undefined);
			return;
		}
		try {
			await renameSession(renamingSession.path, name);
			pushNotice("success", "会话已重命名。");
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		} finally {
			setRenamingSession(undefined);
		}
	}

	async function handleDeleteSession(sessionPath: string, skipConfirmation = false): Promise<void> {
		if (!skipConfirmation && deleteSessionPath !== sessionPath) {
			setDeleteSessionPath(sessionPath);
			return;
		}
		try {
			await deleteSession(sessionPath);
			setDeleteSessionPath(undefined);
			pushNotice("success", "会话已删除。");
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
	}

	function handleToolPresetChange(next: "off" | "default" | "full"): void {
		setToolPreset(next);
		localStorage.setItem("pi-desktop-tool-preset", next);
		setComposerMenu(undefined);
	}

	async function handleDroppedImages(files: File[]): Promise<void> {
		if (!files.length) return;
		setDraggingImages(false);
		const images = files.filter((file) => file.type.startsWith("image/"));
		const others = files.filter((file) => !file.type.startsWith("image/"));
		if (images.length) {
			const remaining = Math.max(0, MAX_IMAGE_ATTACHMENTS - attachments.length);
			const selectedImages = images.slice(0, remaining);
			if (images.length > remaining) {
				pushNotice("warning", `一次对话最多添加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
			}
			setActionError(undefined);
			if (selectedImages.length) {
				try {
					const added = await attachDroppedImages(selectedImages);
					setAttachments((current) => [...current, ...added].slice(0, MAX_IMAGE_ATTACHMENTS));
				} catch (error) {
					pushNotice("error", error instanceof Error ? error.message : String(error));
				}
			}
		}
		if (others.length && snapshot.projectTrusted && snapshot.workspacePath) {
			try {
				const results = await importDroppedFiles(others);
				const ok = results.filter((item) => !item.error);
				const conflicts = results.filter((item) => item.conflict);
				const failed = results.filter((item) => item.error && !item.conflict);
				if (ok.length) {
					const mention = ok.map((item) => `@${item.name}`).join(" ");
					setDraft((current) => (current ? `${current} ${mention}` : `${mention} `));
					promptRef.current?.focus();
					pushNotice("success", `已导入 ${ok.length} 个文件到项目根目录。`);
				}
				if (conflicts.length) {
					const names = new Set(conflicts.map((item) => item.name));
					setPendingFileConflicts({
						files: others.filter((file) => names.has(file.name)),
						names: [...names],
						mentionAfterImport: true,
					});
				}
				for (const item of failed) {
					pushNotice("warning", `${item.name} 导入失败：${item.error}`);
				}
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		} else if (others.length) {
			pushNotice("warning", "请先信任项目，再导入非图片文件。");
		}
	}

	const handleImportWorkspaceFiles = useCallback(
		async (files: File[]): Promise<void> => {
			if (!files.length) return;
			try {
				const results = await importDroppedFiles(files);
				const imported = results.filter((item) => !item.error);
				const conflicts = results.filter((item) => item.conflict);
				const failed = results.filter((item) => item.error && !item.conflict);
				if (imported.length) {
					await refreshWorkspaceFiles();
					pushNotice("success", `已上传 ${imported.length} 个文件。`);
				}
				if (conflicts.length) {
					const names = new Set(conflicts.map((item) => item.name));
					setPendingFileConflicts({
						files: files.filter((file) => names.has(file.name)),
						names: [...names],
						mentionAfterImport: false,
					});
				}
				for (const item of failed) pushNotice("warning", `${item.name}：${item.error}`);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice, refreshWorkspaceFiles],
	);

	async function handleFileConflictDecision(replace: boolean): Promise<void> {
		const pending = pendingFileConflicts;
		setPendingFileConflicts(undefined);
		if (!pending || !replace) {
			if (pending) pushNotice("warning", `已跳过 ${pending.names.length} 个同名文件。`);
			return;
		}
		try {
			const results = await importDroppedFiles(pending.files, true);
			const imported = results.filter((item) => !item.error);
			await refreshWorkspaceFiles();
			if (pending.mentionAfterImport && imported.length) {
				const mention = imported.map((item) => `@${item.name}`).join(" ");
				setDraft((current) => (current ? `${current} ${mention}` : `${mention} `));
				promptRef.current?.focus();
			}
			pushNotice("success", `已替换 ${imported.length} 个同名文件。`);
			for (const item of results.filter((result) => result.error)) {
				pushNotice("error", `${item.name}：${item.error}`);
			}
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
	}

	async function handleChooseImages(): Promise<void> {
		const remaining = Math.max(0, MAX_IMAGE_ATTACHMENTS - attachments.length);
		if (remaining === 0) {
			pushNotice("warning", `一次对话最多添加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
			return;
		}
		try {
			const selected = await chooseImages();
			if (selected.length > remaining) {
				pushNotice("warning", `一次对话最多添加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
			}
			setAttachments((current) => [...current, ...selected.slice(0, remaining)]);
			promptRef.current?.focus();
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
	}

	async function handleDesktopSlashCommand(text: string): Promise<boolean> {
		if (!text.trimStart().startsWith("/")) return false;
		const [command = "", ...argumentParts] = text.trimStart().slice(1).trim().split(/\s+/u);
		const argument = argumentParts.join(" ");
		if (command === "help") {
			pushNotice(
				"accent",
				"命令：/compact /name /copy /session /reload /model /login /project /files /settings /skills /plugins /trust；输入 ! 执行 shell 命令。",
			);
			return true;
		}
		if (command === "compact") {
			if (argument) await handleCompactWithInstructions(argument);
			else await handleCompact();
			return true;
		}
		if (command === "name") {
			if (!argument) {
				setConfigModal(undefined);
				pushNotice("warning", "用法：/name 新名称");
				return true;
			}
			if (!currentSessionPath) {
				pushNotice("error", "当前会话尚未写入历史文件。");
				return true;
			}
			try {
				await renameSession(currentSessionPath, argument);
				pushNotice("success", `会话已重命名为「${argument.slice(0, 40)}」`);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
			return true;
		}
		if (command === "copy") {
			try {
				await copyLastAnswer();
				pushNotice("success", "已复制最后一条回答。");
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
			return true;
		}
		if (command === "session") {
			setTopPanel("session");
			return true;
		}
		if (command === "reload") {
			try {
				await reloadSession();
				pushNotice("success", "扩展与资源已重载。");
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
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

	useEffect(() => {
		const handleMarkdownFile = (event: Event): void => {
			if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
			const path = event.detail;
			void handleOpenFile({ path, name: path.split(/[\\/]/u).at(-1) ?? path, type: "file", depth: 0 });
		};
		window.addEventListener("pi-desktop:open-markdown-file", handleMarkdownFile);
		return () => window.removeEventListener("pi-desktop:open-markdown-file", handleMarkdownFile);
	}, [handleOpenFile]);

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

	const handleEditMessage = useCallback(
		async (message: DesktopTranscriptMessage): Promise<void> => {
			if (draft.trim() || attachments.length > 0) {
				setActionError("请先发送或清空当前草稿，再编辑历史消息。");
				return;
			}
			try {
				if (message.forkEntryId) await navigateTree({ entryId: message.forkEntryId });
				setDraft(message.text);
				requestAnimationFrame(() => {
					const prompt = promptRef.current;
					if (!prompt) return;
					prompt.focus();
					prompt.setSelectionRange(message.text.length, message.text.length);
					prompt.style.height = "0px";
					prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`;
				});
			} catch (error) {
				setActionError(error instanceof Error ? error.message : String(error));
			}
		},
		[attachments.length, draft],
	);

	const handleForkFromMessage = useCallback(async (entryId: string): Promise<void> => {
		setActionError(undefined);
		try {
			await navigateTree({ entryId });
			await forkSession();
			setTopPanel(undefined);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const handleQuoteLine = useCallback((path: string, line: number): void => {
		setDraft((current) => `${current}${current ? "\n" : ""}@${path}:${line} `);
		promptRef.current?.focus();
	}, []);

	const quoteRangeRef = useRef<{ path: string; line: number } | undefined>(undefined);

	const handleQuoteLineRange = useCallback(
		(path: string, line: number, extend: boolean): void => {
			if (extend && quoteRangeRef.current?.path === path) {
				const start = Math.min(quoteRangeRef.current.line, line);
				const end = Math.max(quoteRangeRef.current.line, line);
				quoteRangeRef.current = undefined;
				setDraft((current) => `${current}${current ? "\n" : ""}@${path}:${start}-${end} `);
			} else {
				quoteRangeRef.current = { path, line };
				handleQuoteLine(path, line);
				return;
			}
			promptRef.current?.focus();
		},
		[handleQuoteLine],
	);

	const handleRevealFile = useCallback(async (path: string): Promise<void> => {
		setActionError(undefined);
		try {
			await revealWorkspaceFile(path);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const handleDownloadFile = useCallback(
		async (path: string): Promise<void> => {
			try {
				const saved = await saveWorkspaceFile(path);
				if (saved) pushNotice("success", `已保存到 ${saved}`);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice],
	);

	const handleReloadActiveTab = useCallback(
		async (path: string): Promise<void> => {
			try {
				const preview = await readWorkspaceFile(path);
				setFileTabs((tabs) => tabs.map((tab) => (tab.path === path ? { ...tab, preview } : tab)));
				pushNotice("success", "文件已重新加载。");
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice],
	);

	function beginResize(side: "fileTree" | "inspector" | "sidebar", startX: number): void {
		const startWidth = side === "sidebar" ? sidebarWidth : side === "inspector" ? inspectorWidth : fileTreeWidth;
		const min = side === "sidebar" ? 180 : side === "inspector" ? 300 : 220;
		const requestedMax = side === "sidebar" ? 480 : side === "inspector" ? 1200 : 520;
		const max =
			side === "inspector"
				? Math.max(min, Math.min(requestedMax, window.innerWidth - (sidebarOpen ? sidebarWidth : 0) - 420))
				: requestedMax;
		const variable =
			side === "sidebar" ? "--sidebar-width" : side === "inspector" ? "--inspector-width" : "--file-tree-width";
		const resolveWidth = (clientX: number) =>
			Math.round(
				Math.max(min, Math.min(max, startWidth + (side === "sidebar" ? clientX - startX : startX - clientX))),
			);
		const handleMove = (event: PointerEvent) =>
			document
				.querySelector<HTMLElement>(".app-workbench")
				?.style.setProperty(variable, `${resolveWidth(event.clientX)}px`);
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

	function resizeByKeyboard(side: "fileTree" | "inspector" | "sidebar", delta: number): void {
		const current = side === "sidebar" ? sidebarWidth : side === "inspector" ? inspectorWidth : fileTreeWidth;
		const min = side === "sidebar" ? 180 : side === "inspector" ? 300 : 220;
		const max = side === "sidebar" ? 480 : side === "inspector" ? 1200 : 520;
		const variable =
			side === "sidebar" ? "--sidebar-width" : side === "inspector" ? "--inspector-width" : "--file-tree-width";
		const width = Math.max(min, Math.min(max, current + delta));
		document.querySelector<HTMLElement>(".app-workbench")?.style.setProperty(variable, `${width}px`);
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
			const root = (item.projectRoot ?? item.cwd).replace(/[\\\\/]+$/, "");
			const entries = projects.get(root) ?? [];
			entries.push(item);
			projects.set(root, entries);
		}
		const activeProjects = [...projects.entries()].filter(([root]) => !archivedProjectRoots.has(root));
		const archivedProjects = [...projects.entries()].filter(([root]) => archivedProjectRoots.has(root));
		return (
			<section className="sessions-panel sidebar-project-tree" aria-label={t("sessions")}>
				{activeProjects.length ? (
					activeProjects.map(([root, items]) => {
						const filteredItems = sessionSearch.trim()
							? items.filter((item) =>
									`${item.name ?? ""} ${item.firstMessage}`
										.toLocaleLowerCase()
										.includes(sessionSearch.trim().toLocaleLowerCase()),
								)
							: items;
						if (sessionSearch.trim() && filteredItems.length === 0) return null;
						const flattenedItems = flattenSessionTree(filteredItems);
						const active = items.some((item) => item.id === session?.id);
						const runningCount = items.filter((item) => item.phase === "running").length;
						const unreadCount = items.filter((item) => unreadSessionIds.has(item.id)).length;
						const branch =
							items.find((item) => item.worktreeBranch)?.worktreeBranch ??
							gitWorktrees.find((tree) => tree.path.replace(/[\\/]+$/u, "") === root)?.branch;
						const collapsed = collapsedProjects.has(root) && !sessionSearch.trim();
						const expanded = expandedProjects.has(root);
						const visibleItems = (() => {
							if (expanded || sessionSearch.trim()) return flattenedItems;
							const first = flattenedItems.slice(0, 5);
							const current = flattenedItems.find((item) => item.info.id === session?.id);
							if (!current || first.some((item) => item.info.id === current.info.id)) return first;
							return [...first.slice(0, 4), current];
						})();
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
										<span className="sidebar-project-tree-copy">
											<span className="sidebar-project-tree-name">{formatWorkspace(root)}</span>
											{branch ? <small>⎇ {formatGitBranch(branch)}</small> : null}
										</span>
										<span className="sidebar-project-badges">
											{runningCount ? <span className="sidebar-project-running">{runningCount}</span> : null}
											{unreadCount ? <span className="sidebar-project-unread">{unreadCount}</span> : null}
											{!runningCount && !unreadCount ? <span>{items.length}</span> : null}
										</span>
									</button>
									<button
										className="sidebar-project-tree-action"
										type="button"
										aria-label="新建会话"
										onClick={() => void handleNewSessionForProject(root)}
									>
										<Icon name="plus" size={13} />
									</button>
									<div className="sidebar-project-more-wrap project-menu-root">
										<button
											className="sidebar-project-tree-action"
											type="button"
											aria-label="项目操作"
											aria-expanded={projectRowMenuOpen === root}
											onClick={() =>
												setProjectRowMenuOpen((current) => (current === root ? undefined : root))
											}
										>
											<Icon name="more" size={13} />
										</button>
										{projectRowMenuOpen === root ? (
											<div className="session-more-menu" role="menu">
												<button
													type="button"
													onClick={() => {
														setProjectRowMenuOpen(undefined);
														void handleNewSessionForProject(root);
													}}
												>
													新建会话
												</button>
												<button
													type="button"
													onClick={() => {
														setProjectRowMenuOpen(undefined);
														void handleRevealFile(root);
													}}
												>
													在文件管理器中显示
												</button>
												{root !== snapshot.workspacePath &&
												gitWorktrees.some((tree) => tree.path === root) ? (
													<button
														type="button"
														onClick={() => {
															setProjectRowMenuOpen(undefined);
															void handleSwitchWorkspacePath(root);
														}}
													>
														切换到此 Worktree
													</button>
												) : null}
												<button
													type="button"
													onClick={() => {
														setProjectRowMenuOpen(undefined);
														setArchivedProjectRoots((current) => new Set(current).add(root));
													}}
												>
													归档项目
												</button>
											</div>
										) : null}
									</div>
								</div>
								{!collapsed ? (
									<div className="sidebar-project-tree-children">
										{visibleItems.map(({ info: item, depth }) => {
											const isCurrent = item.id === session?.id;
											const isRenaming = renamingSession?.path === item.path;
											return (
												<div
													className={`session-row-wrap ${isCurrent ? "is-current" : ""} ${depth ? "is-forked" : ""}`}
													key={item.path}
													style={{ "--session-depth": Math.min(depth, 5) } as CSSProperties}
												>
													{isRenaming ? (
														<form
															className="session-inline-rename"
															onSubmit={(event) => {
																event.preventDefault();
																void handleRenameSubmit();
															}}
														>
															<input
																// biome-ignore lint/a11y/noAutofocus: 用户刚触发了内联重命名
																autoFocus
																aria-label="会话名称"
																value={renamingSession.name}
																onChange={(event) =>
																	setRenamingSession({ ...renamingSession, name: event.target.value })
																}
																onKeyDown={(event) => {
																	if (event.key === "Escape") setRenamingSession(undefined);
																}}
															/>
															<button type="submit">保存</button>
														</form>
													) : (
														<button
															className="session-row"
															type="button"
															title={`${sessionTitle(item)} · ${item.messageCount} · ${formatSessionDate(item.modified)}`}
															onClick={() =>
																isCurrent
																	? promptRef.current?.focus()
																	: void handleOpenSession(item.path)
															}
														>
															<span
																className={`session-row-icon ${item.phase === "running" ? "is-running" : ""}`}
															>
																<Icon name="chat" size={14} />
															</span>
															<span className="session-row-title">{sessionTitle(item)}</span>
															{unreadSessionIds.has(item.id) ? (
																<span className="session-unread-dot" />
															) : null}
														</button>
													)}
													{!isRenaming ? (
														<button
															className="session-more"
															type="button"
															aria-label="会话操作"
															aria-expanded={sessionMenuOpen === item.path}
															onClick={() =>
																setSessionMenuOpen((open) =>
																	open === item.path ? undefined : item.path,
																)
															}
														>
															<Icon name="more" size={14} />
														</button>
													) : null}
													{sessionMenuOpen === item.path ? (
														<div className="session-more-menu" role="menu">
															<button
																type="button"
																onClick={() => {
																	setSessionMenuOpen(undefined);
																	setRenamingSession({
																		path: item.path,
																		name: item.name ?? sessionTitle(item),
																	});
																}}
															>
																重命名
															</button>
															{isCurrent ? (
																<button
																	type="button"
																	onClick={() => {
																		setSessionMenuOpen(undefined);
																		setTopPanel("session");
																	}}
																>
																	会话统计
																</button>
															) : null}
															{isCurrent ? (
																<button
																	type="button"
																	disabled={session?.phase === "running"}
																	onClick={() => {
																		setSessionMenuOpen(undefined);
																		void handleForkSession();
																	}}
																>
																	Fork 为独立会话
																</button>
															) : null}
															<button
																type="button"
																className="is-danger"
																disabled={item.phase === "running"}
																onClick={(event) => {
																	if (!event.shiftKey && deleteSessionPath !== item.path) {
																		void handleDeleteSession(item.path);
																		return;
																	}
																	setSessionMenuOpen(undefined);
																	void handleDeleteSession(item.path, event.shiftKey);
																}}
															>
																{deleteSessionPath === item.path ? "确认删除" : "删除会话"}
															</button>
															{deleteSessionPath === item.path ? (
																<button type="button" onClick={() => setDeleteSessionPath(undefined)}>
																	取消
																</button>
															) : null}
															<div className="session-more-meta">
																<span>{formatSessionDate(item.modified)}</span>
																<span>{item.messageCount} 条消息</span>
																<span>{item.parentSessionPath ? "Fork" : "主分支"}</span>
															</div>
														</div>
													) : null}
												</div>
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
					<div className="sidebar-projects-header project-menu-root">
						<span>{t("projects")}</span>
						<div className="sidebar-projects-actions">
							<button
								className="icon-button compact"
								type="button"
								aria-label="项目操作"
								aria-expanded={projectMenuOpen}
								onClick={() => setProjectMenuOpen((open) => !open)}
							>
								<Icon name="more" size={14} />
							</button>
							<button
								className="icon-button compact"
								type="button"
								aria-label="打开项目"
								disabled={!canChooseWorkspace}
								onClick={() => void handleChooseWorkspace()}
							>
								<Icon name="plus" size={14} />
							</button>
						</div>
						{projectMenuOpen ? renderProjectMenu() : null}
					</div>
				)}
				{archivedProjects.length ? (
					<div className="archived-projects">
						<div className="settings-group-label">已归档项目</div>
						{archivedProjects.map(([root]) => (
							<div className="archived-project-row" key={root}>
								<span title={root}>{formatWorkspace(root)}</span>
								<button
									type="button"
									onClick={() =>
										setArchivedProjectRoots((current) => {
											const next = new Set(current);
											next.delete(root);
											return next;
										})
									}
								>
									恢复
								</button>
							</div>
						))}
					</div>
				) : null}
			</section>
		);
	}

	const bashMode = !attachments.length && draft.startsWith("!");
	const macOSClassName = navigator.userAgent.includes("Macintosh") ? "is-macos" : "";

	function renderProjectMenu() {
		const query = projectFilter.trim().toLocaleLowerCase();
		const visibleRecentWorkspaces = recentWorkspaces.filter(
			(path) => !query || path.toLocaleLowerCase().includes(query),
		);
		return (
			<div className="project-menu" role="menu">
				<button
					className="project-menu-item"
					type="button"
					disabled={!canChooseWorkspace}
					onClick={() => {
						setProjectMenuOpen(false);
						void handleChooseWorkspace();
					}}
				>
					<Icon name="folder" size={14} />
					<span>{t("chooseFolder")}</span>
				</button>
				{recentWorkspaces.length > 0 ? (
					<>
						<div className="project-menu-label">{t("recentProjects")}</div>
						{knownWorkspacePaths.length > 7 ? (
							<input
								className="project-menu-filter"
								value={projectFilter}
								onChange={(event) => setProjectFilter(event.target.value)}
								placeholder={language === "en" ? "Filter projects…" : "筛选项目…"}
								aria-label={language === "en" ? "Filter projects" : "筛选项目"}
							/>
						) : null}
						{visibleRecentWorkspaces.slice(0, query ? visibleRecentWorkspaces.length : 7).map((path) => (
							<button
								className="project-menu-item"
								key={path}
								type="button"
								title={path}
								disabled={session?.phase === "running"}
								onClick={() => {
									setProjectMenuOpen(false);
									void handleSwitchWorkspacePath(path);
									setProjectFilter("");
								}}
							>
								<Icon name="folder" size={14} />
								<span>{formatWorkspace(path)}</span>
							</button>
						))}
						{visibleRecentWorkspaces.length === 0 ? (
							<p className="project-menu-empty">
								{language === "en" ? "No matching projects." : "没有匹配的项目。"}
							</p>
						) : null}
					</>
				) : null}
				{snapshot.workspacePath ? (
					<WorktreeSection
						key={snapshot.workspacePath}
						workspacePath={snapshot.workspacePath}
						projectTrusted={snapshot.projectTrusted}
						onSwitch={(path) => {
							setProjectMenuOpen(false);
							void handleSwitchWorkspacePath(path);
						}}
					/>
				) : null}
			</div>
		);
	}

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
					{snapshot.workspacePath ? (
						<div className="project-switcher-wrap project-menu-root">
							<button
								className="project-switcher"
								disabled={!canChooseWorkspace}
								type="button"
								aria-expanded={projectMenuOpen}
								onClick={() => setProjectMenuOpen((open) => !open)}
							>
								<Icon name="folder" size={15} />
								<span className="project-switcher-name">
									{openingWorkspace ? "正在打开项目…" : formatWorkspace(snapshot.workspacePath)}
								</span>
								<span className="switcher-chevron">
									<Icon name="chevron" size={14} />
								</span>
							</button>
							{projectMenuOpen ? renderProjectMenu() : null}
						</div>
					) : null}
					<div className="sidebar-search-wrap">
						<Icon name="search" size={13} />
						<input
							aria-label="搜索会话"
							placeholder={t("searchSessions")}
							value={sessionSearch}
							onChange={(event) => setSessionSearch(event.target.value)}
						/>
						{sessionSearch ? (
							<button type="button" aria-label="清除搜索" onClick={() => setSessionSearch("")}>
								×
							</button>
						) : null}
					</div>
				</header>
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
					aria-valuemin={180}
					aria-valuemax={480}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					onPointerDown={(event) => beginResize("sidebar", event.clientX)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight")
							resizeByKeyboard("sidebar", event.key === "ArrowLeft" ? -16 : 16);
					}}
				/>
			) : null}
			<section
				className={`chat-workspace ${!session?.messages.length ? "is-session-empty" : ""}`}
				aria-label="智能体对话"
			>
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
					<div className="chat-title" title={topBarTitle}>
						<span>{topBarTitle}</span>
						<small>{topBarSubtitle}</small>
					</div>
					<div className="top-bar-actions">
						<button
							className="native-toolbar-button"
							type="button"
							disabled={!session?.messages.length}
							onClick={() => void handleExportSession()}
						>
							<Icon name="history" size={12} />
							<span>{t("fullHistory")}</span>
						</button>
						<BranchNavigator
							tree={snapshot.branchTree ?? []}
							activeLeafId={snapshot.branchActiveLeafId}
							hasSession={Boolean(session)}
							onLeafChange={handleNavigateTree}
							onFork={() => void handleForkSession()}
							open={topPanel === "branches"}
							onToggle={() => setTopPanel((current) => (current === "branches" ? undefined : "branches"))}
						/>
						<div className="top-bar-more-wrap">
							<button
								className={`native-toolbar-button app-topbar-more-trigger ${moreMenuOpen ? "is-active" : ""}`}
								type="button"
								aria-expanded={moreMenuOpen}
								onClick={() => setMoreMenuOpen((open) => !open)}
							>
								<Icon name="more" size={12} />
								<span>{t("more")}</span>
							</button>
							{moreMenuOpen ? (
								<div className="top-bar-more-menu" role="menu">
									<button
										className="app-topbar-more-item"
										type="button"
										disabled={!session?.messages.length || namingState === "loading"}
										onClick={() => void handleAutoName()}
									>
										<span className="app-topbar-more-icon">
											<Icon name="sparkles" size={14} />
										</span>
										<span className="app-topbar-more-copy">
											<span>
												{namingState === "loading"
													? "正在生成标题…"
													: namingState === "success"
														? "已生成标题"
														: namingState === "error"
															? "生成失败，请重试"
															: "生成标题"}
											</span>
											<small>根据对话内容自动命名会话</small>
										</span>
									</button>
									<button
										className="app-topbar-more-item"
										type="button"
										disabled={!session}
										onClick={() => {
											setMoreMenuOpen(false);
											setTopPanel((current) => (current === "system" ? undefined : "system"));
										}}
									>
										<span className="app-topbar-more-icon">
											<Icon name="terminal" size={14} />
										</span>
										<span className="app-topbar-more-copy">
											<span>系统提示词</span>
											<small>{session?.systemPrompt ? "查看当前系统指令" : "未设置系统提示词"}</small>
										</span>
									</button>
									<button
										className="app-topbar-more-item"
										type="button"
										disabled={!session}
										onClick={() => {
											setMoreMenuOpen(false);
											setTopPanel((current) => (current === "session" ? undefined : "session"));
										}}
									>
										<span className="app-topbar-more-icon">
											<Icon name="chart" size={14} />
										</span>
										<span className="app-topbar-more-copy">
											<span>会话统计</span>
											<small>{statsSummary ?? "暂无统计数据"}</small>
										</span>
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
						{topPanel === "system" ? (
							<div className="session-info-popover" role="dialog" aria-label="系统提示词">
								<div className="session-info-header">
									<strong>系统提示词</strong>
									<button
										className="icon-button compact"
										type="button"
										aria-label="关闭"
										onClick={() => setTopPanel(undefined)}
									>
										×
									</button>
								</div>
								{session?.systemPrompt ? (
									<pre className="system-prompt-body">{session.systemPrompt}</pre>
								) : (
									<p className="stats-empty">系统提示词为空（工具已禁用）。</p>
								)}
							</div>
						) : null}
						{topPanel === "session" ? (
							<SessionStatsPanel
								stats={snapshot.sessionStats}
								sessionPath={snapshot.sessions.find((item) => item.id === session?.id)?.path}
								sessionId={session?.id}
								sessionName={session?.name}
								onClose={() => setTopPanel(undefined)}
							/>
						) : null}
					</div>
				</header>
				{!isOnline || startupError ? (
					<output className="offline-banner">
						<span className="offline-banner-dot" />
						<span>
							{isOnline ? "Pi Agent 初始化失败，部分功能暂不可用。" : "当前处于离线状态，模型请求将无法发送。"}
						</span>
						<button type="button" onClick={() => void startDesktopStore()}>
							重试
						</button>
					</output>
				) : null}
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
						{notices.length ? (
							// biome-ignore lint/a11y/useSemanticElements: 通知容器非单独状态区
							<div className="notice-shelf" role="status">
								{notices.map((notice) => (
									<button
										className={`notice-shelf-item is-${notice.kind}`}
										key={notice.id}
										type="button"
										onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
									>
										<span className="notice-dot" />
										<span className="notice-text">{notice.text}</span>
									</button>
								))}
							</div>
						) : null}
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
							{visibleItemCount < transcriptItems.length ? (
								<div className="load-earlier-sentinel" ref={earlierMessagesSentinelRef} aria-hidden="true" />
							) : null}
							{visibleItemCount < transcriptItems.length ? (
								<button
									className="load-earlier"
									type="button"
									onClick={() => setVisibleItemCount((current) => current + 60)}
								>
									加载更早的消息 ({transcriptItems.length - visibleItemCount})
								</button>
							) : null}
							{session?.messages.length
								? transcriptItems.slice(-visibleItemCount).map((item) => {
										if (item.type === "process") {
											return (
												<div
													className="process-details"
													key={`process:${item.messages[0]?.id ?? item.blocks.map((block) => block.type).join(":")}`}
												>
													<details>
														<summary className="process-details-trigger">
															<span>{t("processDetails")}</span>
															<small>{item.messageCount} 条记录</small>
															{item.toolCallCount > 0 ? (
																<small>{item.toolCallCount} 次工具调用</small>
															) : null}
															{item.durationMs !== undefined ? (
																<small>{(item.durationMs / 1000).toFixed(1)}s</small>
															) : null}
														</summary>
														<div className="process-details-content">
															{item.blocks.map((block, blockIndex) => (
																<TranscriptBlock
																	key={`${block.type}:${blockIndex}`}
																	block={block}
																	durationMs={
																		block.type === "thinking" &&
																		blockIndex ===
																			item.blocks.findIndex(
																				(candidate) => candidate.type === "thinking",
																			)
																			? item.durationMs
																			: undefined
																	}
																/>
															))}
															{item.messages.map((message) => {
																const call = message.toolCallId
																	? item.blocks.find(
																			(block) =>
																				block.type === "toolCall" &&
																				block.id === message.toolCallId,
																		)
																	: undefined;
																return (
																	<CollapsibleTranscriptEntry
																		key={message.id}
																		message={message}
																		previousTimestamp={previousMessageTimestamps.get(message.id)}
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
										const turnIndex = conversationTurnIndexes.get(item.message.id) ?? -1;
										return (
											<div
												data-conversation-turn={turnIndex >= 0 ? turnIndex : undefined}
												data-turn-id={item.message.id}
												key={item.message.id}
											>
												<TranscriptMessage
													message={item.message}
													modelLabel={session.model?.id}
													isLastAssistant={
														item.message.id === lastMessage?.id && item.message.role === "assistant"
													}
													isStreaming={item.message.id === lastMessage?.id && session.phase === "running"}
													previousTimestamp={previousMessageTimestamps.get(item.message.id)}
													onEdit={(message) => void handleEditMessage(message)}
													onFork={(entryId) => void handleForkFromMessage(entryId)}
												/>
											</div>
										);
									})
								: null}
							{session?.pendingMessages.length ? (
								<div className="queued-panel">
									<div className="queued-panel-header">
										<span>QUEUED ({session.pendingMessages.length})</span>
										<button
											type="button"
											onClick={() => {
												const texts = session.pendingMessages.map((message) => message.text);
												setDraft((current) =>
													current ? `${texts.join("\n\n")}\n\n${current}` : texts.join("\n\n"),
												);
												promptRef.current?.focus();
											}}
										>
											取回
										</button>
									</div>
									{session.pendingMessages.map((message, index) => (
										<div className="queued-message" key={`${message.behavior}:${index}:${message.text}`}>
											<span className={message.behavior === "steer" ? "is-steer" : ""}>
												{message.behavior === "steer" ? "引导" : "跟进"}
											</span>
											<p>{message.text}</p>
										</div>
									))}
								</div>
							) : null}
							{session?.phase === "running" ? (
								<output className="agent-running-status">
									<span className="status-indicator is-running" />
									{session.runningTools?.length
										? `正在运行 ${session.runningTools.slice(0, 3).join("、")}${session.runningTools.length > 3 ? ` 等 ${session.runningTools.length} 个工具` : ""}`
										: "等待模型响应…"}
								</output>
							) : null}
							{session?.autoRetry ? (
								<div className="retry-banner">
									<span className="retry-banner-title">
										正在自动重试（第 {session.autoRetry.attempt}/{session.autoRetry.maxAttempts} 次）
									</span>
									<span className="retry-banner-error">{session.autoRetry.errorMessage}</span>
								</div>
							) : null}
							{compactionBanner ? <div className="compaction-banner">{compactionBanner}</div> : null}
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
					{compactError ? (
						<output className="compact-editor-error" role="alert">
							{compactError}
							<button type="button" onClick={() => setCompactError(undefined)} aria-label="关闭压缩错误">
								×
							</button>
						</output>
					) : null}
					{!session?.messages.length ? (
						<div className="start-task-copy">
							<strong>{snapshot.workspacePath ? "Start a task" : "Get started"}</strong>
							{!snapshot.workspacePath ? <span>1. 打开项目文件夹　2. 描述你想完成的任务</span> : null}
						</div>
					) : null}
					<ExtensionWidgetStack
						widgets={(snapshot.extensionWidgets ?? []).filter((widget) => widget.placement === "aboveEditor")}
					/>
					<div className="composer-inner">
						{slashActive ? (
							<div className="slash-menu" role="listbox" aria-label="斜杠命令">
								<div className="slash-menu-header">
									<span>{visibleSlashCommands.length} 个命令</span>
									<small>Tab ↹ / Enter 选择 · Esc 关闭</small>
								</div>
								{visibleSlashCommands.length ? (
									<div className="slash-command-grid">
										{visibleSlashCommands.map((command, index) => (
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
												<small>{command.category}</small>
											</button>
										))}
									</div>
								) : (
									<p className="slash-empty">没有匹配的桌面端命令，可直接发送给已加载的插件。</p>
								)}
							</div>
						) : null}
						{hashActive ? (
							<div className="slash-menu" role="listbox" aria-label="会话提及">
								<div className="slash-menu-header">
									<span>会话</span>
									<small>Tab ↹ / Enter 选择 · Esc 关闭</small>
								</div>
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
						{atActive ? (
							<div className="slash-menu" role="listbox" aria-label="文件提及">
								<div className="slash-menu-header">
									<span>项目文件</span>
									<small>Tab ↹ / Enter 选择 · Esc 关闭</small>
								</div>
								{atEntries.length ? (
									atEntries.map((entry, index) => {
										const dirIndex = mentionNameStart(entry.path, atQuery);
										return (
											<button
												aria-selected={suggestionIndex === index}
												className={`slash-command ${suggestionIndex === index ? "is-selected" : ""}`}
												key={entry.path}
												role="option"
												type="button"
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => selectComposerSuggestion(index)}
											>
												<span className="tree-file-icon">
													<Icon
														name={entry.type === "directory" ? "folder" : fileIconFor(entry.path)}
														size={13}
													/>
												</span>
												<span className="mention-path">
													{dirIndex > 0 ? (
														<>
															<small>{entry.path.slice(0, dirIndex)}</small>
															{entry.path.slice(dirIndex)}
															{entry.type === "directory" ? "/" : ""}
														</>
													) : (
														<>
															{entry.path}
															{entry.type === "directory" ? "/" : ""}
														</>
													)}
												</span>
											</button>
										);
									})
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
									<div
										className="attachment-chip"
										key={attachment.id}
										title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
									>
										{attachment.thumbnailDataUrl ? (
											<img className="attachment-thumbnail" src={attachment.thumbnailDataUrl} alt="" />
										) : (
											<span className="attachment-placeholder">
												<Icon name="image" size={20} />
											</span>
										)}
										<button
											aria-label={`移除 ${attachment.name}`}
											type="button"
											onClick={() => {
												setAttachments((current) =>
													current.filter((currentAttachment) => currentAttachment.id !== attachment.id),
												);
												void discardImageAttachment(attachment.id).catch(() => undefined);
											}}
										>
											<Icon name="close" size={12} />
										</button>
									</div>
								))}
							</div>
						) : null}
						{bashMode ? (
							<div className={`bash-mode-hint ${draft.startsWith("!!") ? "is-excluded" : ""}`}>
								<Icon name="terminal" size={12} />
								<span>{draft.startsWith("!!") ? "Shell · 输出不进入上下文" : "Shell · 输出发送给模型"}</span>
							</div>
						) : null}
						<div className="composer-editor">
							{historyMenuOpen && promptHistoryRef.current.length > 0 ? (
								<div className="prompt-history-menu" role="listbox" aria-label="输入历史">
									<div className="prompt-history-header">
										<Icon name="history" size={13} />
										<span>输入历史</span>
										<small>↑↓ 选择 · Enter 回填 · Esc 关闭</small>
									</div>
									<div className="prompt-history-list">
										{promptHistoryRef.current.map((item, index) => (
											<button
												key={`${index}:${item}`}
												type="button"
												role="option"
												aria-selected={index === historyActiveIndex}
												className={index === historyActiveIndex ? "is-active" : ""}
												onMouseDown={(event) => event.preventDefault()}
												onMouseEnter={() => setHistoryActiveIndex(index)}
												onClick={() => {
													setDraft(item);
													setHistoryMenuOpen(false);
													promptHistoryIndexRef.current = index;
													requestAnimationFrame(() => promptRef.current?.focus());
												}}
											>
												<span>{index + 1}</span>
												<strong>{item}</strong>
											</button>
										))}
									</div>
								</div>
							) : null}
							<textarea
								ref={promptRef}
								id="prompt"
								value={draft}
								onChange={(event) => {
									setDraft(event.target.value);
									setSuggestionIndex(0);
									setMenusDismissed(false);
									setHistoryMenuOpen(false);
									promptHistoryIndexRef.current = -1;
									resizePrompt(event.currentTarget);
								}}
								onCompositionStart={() => {
									composingRef.current = true;
								}}
								onCompositionEnd={() => {
									composingRef.current = false;
								}}
								onPaste={(event) => {
									const files = Array.from(event.clipboardData.files).filter((file) =>
										file.type.startsWith("image/"),
									);
									if (files.length === 0) return;
									event.preventDefault();
									void handleDroppedImages(files);
								}}
								onKeyDown={(event) => {
									if (historyMenuOpen) {
										if (event.key === "ArrowUp" || event.key === "ArrowDown") {
											event.preventDefault();
											const count = promptHistoryRef.current.length;
											if (count > 0) {
												setHistoryActiveIndex((current) =>
													event.key === "ArrowUp" ? (current - 1 + count) % count : (current + 1) % count,
												);
											}
											return;
										}
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											const value = promptHistoryRef.current[historyActiveIndex];
											if (value !== undefined) {
												setDraft(value);
												setHistoryMenuOpen(false);
												promptHistoryIndexRef.current = historyActiveIndex;
											}
											return;
										}
										if (event.key === "Escape") {
											event.preventDefault();
											setHistoryMenuOpen(false);
											return;
										}
									}
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
										setHistoryActiveIndex(promptHistoryRef.current.length - 1);
										setHistoryMenuOpen(true);
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
										className="composer-steer-button"
										type="button"
										disabled={!draft.trim() || submitting || attachments.length > 0}
										onClick={() => void handleSteer()}
									>
										引导
									</button>
									<button
										className="composer-followup-button"
										type="submit"
										disabled={!canSubmit || attachments.length > 0}
									>
										{submitting ? "排队中" : "跟进"}
									</button>
								</div>
							) : (
								<button className="send-button composer-send-button" type="submit" disabled={!canSubmit}>
									<Icon name="send" size={14} />
									{submitting ? "正在发送" : t("send")}
								</button>
							)}
						</div>
						<div className="composer-footer">
							<div className="composer-footer-left">
								{snapshot.extensionStatuses?.length ? (
									<div
										className="extension-status-bar"
										title={snapshot.extensionStatuses
											.map((status) => `${status.key}: ${status.text}`)
											.join("\n")}
									>
										{snapshot.extensionStatuses.slice(0, 3).map((status) => (
											<span key={status.key}>{status.text}</span>
										))}
									</div>
								) : null}
								<div className="composer-control-group">
									<button
										className="composer-control-button"
										type="button"
										disabled={attachments.length >= MAX_IMAGE_ATTACHMENTS || session?.phase === "running"}
										aria-label={t("addImage")}
										title={t("addImage")}
										onClick={() => void handleChooseImages()}
									>
										<Icon name="image" size={15} />
									</button>
									<div className="composer-control-anchor">
										<button
											className="composer-control-button chat-project-context"
											type="button"
											disabled={!canChooseWorkspace}
											title={snapshot.workspacePath ?? "选择项目文件夹"}
											aria-expanded={composerMenu === "project"}
											onClick={() => {
												setProjectFilter("");
												setComposerMenu((current) => (current === "project" ? undefined : "project"));
											}}
										>
											<Icon name="folder" size={15} />
											<span>
												{snapshot.workspacePath
													? (snapshot.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ??
														snapshot.workspacePath)
													: "选择项目"}
											</span>
										</button>
										{composerMenu === "project" ? (
											<div className="composer-popover project-composer-popover" role="menu">
												<button
													type="button"
													onClick={() => {
														setComposerMenu(undefined);
														void handleChooseWorkspace();
													}}
												>
													<Icon name="folder" size={13} />
													{t("chooseFolder")}
												</button>
												{recentWorkspaces.length > 7 ? (
													<input
														className="composer-popover-filter"
														value={projectFilter}
														onChange={(event) => setProjectFilter(event.target.value)}
														placeholder={language === "en" ? "Filter projects…" : "筛选项目…"}
														aria-label={language === "en" ? "Filter projects" : "筛选项目"}
													/>
												) : null}
												{knownWorkspacePaths
													.filter(
														(path) =>
															!projectFilter.trim() ||
															path
																.toLocaleLowerCase()
																.includes(projectFilter.trim().toLocaleLowerCase()),
													)
													.slice(0, projectFilter.trim() ? undefined : 7)
													.map((path) => (
														<button
															key={path}
															type="button"
															className={path === snapshot.workspacePath ? "is-current" : ""}
															onClick={() => {
																setComposerMenu(undefined);
																setProjectFilter("");
																void handleSwitchWorkspacePath(path);
															}}
														>
															{path === snapshot.workspacePath ? "✓ " : ""}
															{formatWorkspace(path)}
														</button>
													))}
												{knownWorkspacePaths.length > 0 &&
												knownWorkspacePaths.every(
													(path) =>
														!path.toLocaleLowerCase().includes(projectFilter.trim().toLocaleLowerCase()),
												) ? (
													<p className="composer-popover-empty">
														{language === "en" ? "No matching projects." : "没有匹配的项目。"}
													</p>
												) : null}
											</div>
										) : null}
									</div>
									<div className="composer-control-anchor">
										<button
											className="composer-control-button"
											type="button"
											disabled={!canSetModel || settingModel}
											onClick={() =>
												setComposerMenu((current) => (current === "model" ? undefined : "model"))
											}
										>
											<Icon name="model" size={15} />
											<span>{session?.model?.id ?? "模型"}</span>
										</button>
										{composerMenu === "model" ? (
											<div className="composer-popover" role="menu">
												{snapshot.availableModels.length > 8 ? (
													<input
														// biome-ignore lint/a11y/noAutofocus: 打开菜单即筛选，参考项目行为
														autoFocus
														className="composer-popover-filter"
														placeholder="筛选模型"
														value={modelFilter}
														onChange={(event) => setModelFilter(event.target.value)}
														onKeyDown={(event) => {
															if (event.key === "Escape") {
																event.stopPropagation();
																setModelFilter("");
																setComposerMenu(undefined);
															}
														}}
													/>
												) : null}
												{filteredModels.length === 0 ? (
													<p className="composer-popover-empty">没有匹配的模型。</p>
												) : (
													filteredModels.map((model) => (
														<button
															key={getModelKey(model.provider, model.id)}
															type="button"
															className={
																session?.model?.id === model.id &&
																session.model.provider === model.provider
																	? "is-current"
																	: ""
															}
															onClick={() => {
																setComposerMenu(undefined);
																void handleChangeModel(getModelKey(model.provider, model.id));
															}}
														>
															{session?.model?.id === model.id &&
															session.model.provider === model.provider
																? "✓ "
																: ""}
															{model.provider} / {model.name}
														</button>
													))
												)}
											</div>
										) : null}
									</div>
									<ContextUsageRing
										stats={snapshot.sessionStats}
										onToggle={() => setTopPanel((current) => (current === "session" ? undefined : "session"))}
									/>
								</div>
								<div className="composer-control-group composer-control-group-right">
									<div className="composer-control-anchor">
										<button
											className="composer-control-button"
											type="button"
											disabled={!session || session.phase === "running"}
											onClick={() =>
												setComposerMenu((current) => (current === "thinking" ? undefined : "thinking"))
											}
										>
											<Icon name="bulb" size={14} />
											<span>{session?.thinkingLevel ?? "auto"}</span>
										</button>
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
													<button
														key={level}
														type="button"
														onClick={() => void handleChangeThinking(level)}
													>
														{level}
													</button>
												))}
											</div>
										) : null}
									</div>
									<div className="composer-control-anchor">
										<button
											className="composer-control-button"
											type="button"
											onClick={() =>
												setComposerMenu((current) => (current === "tools" ? undefined : "tools"))
											}
										>
											<Icon name="wrench" size={14} />
											<span>{toolPreset}</span>
										</button>
										{composerMenu === "tools" ? (
											<div className="composer-popover" role="menu">
												{(["off", "default", "full"] as const).map((preset) => (
													<button
														key={preset}
														type="button"
														onClick={() => handleToolPresetChange(preset)}
													>
														{preset}
													</button>
												))}
											</div>
										) : null}
									</div>
									<button
										className="composer-control-button"
										type="button"
										disabled={!session || session.phase === "running" || aborting}
										onClick={() => void (compacting ? handleAbort() : handleCompact())}
									>
										<Icon name="compact" size={14} />
										<span>{compacting ? "停止压缩" : "压缩"}</span>
									</button>
									<button
										className="composer-control-button"
										type="button"
										aria-label="切换完成提示音"
										aria-pressed={soundOnComplete}
										title={soundOnComplete ? "完成提示音已开启" : "完成提示音已关闭"}
										onClick={() => setSoundOnComplete((current) => !current)}
									>
										<Icon name={soundOnComplete ? "speaker" : "close"} size={14} />
									</button>
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
					</div>
					<ExtensionWidgetStack
						widgets={(snapshot.extensionWidgets ?? []).filter((widget) => widget.placement === "belowEditor")}
					/>
				</form>
			</section>
			{inspectorOpen ? (
				<hr
					className="column-resizer inspector-resizer"
					aria-label="调整检查器宽度"
					aria-orientation="vertical"
					aria-valuemin={300}
					aria-valuemax={1200}
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
								className={`icon-button ${rightPanelMode === "source" ? "is-active" : ""}`}
								type="button"
								aria-label="源代码管理"
								aria-pressed={rightPanelMode === "source"}
								disabled={!snapshot.workspacePath || !snapshot.projectTrusted}
								title={!snapshot.projectTrusted ? "信任项目后可查看源代码管理" : "源代码管理"}
								onClick={() => setRightPanelMode((mode) => (mode === "source" ? "files" : "source"))}
							>
								<Icon name="branch" size={15} />
							</button>
							<button
								className={`icon-button ${fileTreeOpen ? "is-active" : ""}`}
								type="button"
								aria-label={fileTreeOpen ? "隐藏文件树" : "显示文件树"}
								disabled={rightPanelMode === "source"}
								onClick={() => setFileTreeOpen((open) => !open)}
							>
								<Icon name="files" size={15} />
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
					<div className="right-panel-body">
						{rightPanelMode === "source" ? <SourceControl key={workspaceRefreshToken} /> : null}
						{rightPanelMode === "files" ? (
							<Inspector
								changedHint={changedFileHint}
								onReloadChanged={() => {
									setChangedFileHint(false);
									if (activeTabPath) void handleReloadActiveTab(activeTabPath);
								}}
								tabs={fileTabs}
								activeTabPath={activeTabPath}
								onClose={() => setInspectorOpen(false)}
								onOpenFile={(path) => void handleOpenFileWithDefaultApp(path)}
								onRevealFile={(path) => void handleRevealFile(path)}
								onDownload={(path) => void handleDownloadFile(path)}
								onCopyPath={(path) => {
									void navigator.clipboard.writeText(path).then(
										() => pushNotice("success", "已复制文件路径。"),
										() => pushNotice("error", "无法复制文件路径。"),
									);
								}}
								onCopyContent={(content) => {
									void navigator.clipboard.writeText(content).then(
										() => pushNotice("success", "已复制文件内容。"),
										() => pushNotice("error", "无法复制文件内容。"),
									);
								}}
								onQuoteLine={handleQuoteLine}
								onQuoteLineRange={handleQuoteLineRange}
							/>
						) : null}
						{rightPanelMode === "files" && fileTreeOpen ? (
							<>
								<hr
									className="file-tree-resizer"
									aria-label="调整文件树宽度"
									aria-orientation="vertical"
									aria-valuemin={220}
									aria-valuemax={520}
									aria-valuenow={fileTreeWidth}
									tabIndex={0}
									onPointerDown={(event) => beginResize("fileTree", event.clientX)}
									onKeyDown={(event) => {
										if (event.key === "ArrowLeft" || event.key === "ArrowRight")
											resizeByKeyboard("fileTree", event.key === "ArrowLeft" ? 16 : -16);
									}}
								/>
								<div className="right-file-tree">
									<Explorer
										entries={workspaceEntries}
										error={fileExplorerError}
										isLoading={loadingFiles || loadingFilePath !== undefined}
										isTrusted={snapshot.projectTrusted}
										selectedPath={activeTabPath}
										workspacePath={snapshot.workspacePath}
										onChooseWorkspace={() => void handleChooseWorkspace()}
										onDownload={(path) => void handleDownloadFile(path)}
										onMention={(path) => {
											setDraft((current) => `${current}${current ? " " : ""}@${path} `);
											promptRef.current?.focus();
										}}
										onOpenFile={(entry) => void handleOpenFile(entry)}
										onRefresh={() => void refreshWorkspaceFiles()}
										onTrustProject={() => void handleProjectTrust()}
										onUpload={(files) => void handleImportWorkspaceFiles(files)}
									/>
								</div>
							</>
						) : null}
					</div>
				</aside>
			) : null}
			{directoryPickerOpen ? (
				<DirectoryPicker
					busy={openingWorkspace}
					error={directoryPickerError}
					onClose={() => {
						if (!openingWorkspace) setDirectoryPickerOpen(false);
					}}
					onSelect={(path) => void handleDirectorySelect(path)}
				/>
			) : null}
			{configModal === "models" ? (
				<ModelsConfigModal
					providers={snapshot.apiKeyProviders}
					selectedProviderId={selectedProviderId}
					providerSetupInProgress={snapshot.providerSetupInProgress}
					settingUpProvider={settingUpProvider}
					authenticationPrompt={authenticationPrompt}
					authenticationNotice={snapshot.authenticationNotice}
					authenticationUrl={snapshot.authenticationUrl}
					authenticationUserCode={snapshot.authenticationUserCode}
					authenticationExpiresAt={snapshot.authenticationExpiresAt}
					authenticationResponse={authenticationResponse}
					authenticationResolving={respondingToAuthenticationPromptId === authenticationPrompt?.id}
					onChangeProvider={setSelectedProviderId}
					onStartProviderSetup={(providerId, authType) => void beginProviderSetup(providerId, authType)}
					onChangeAuthenticationResponse={setAuthenticationResponse}
					onSubmitAuthentication={handleAuthenticationPrompt}
					onCancelProviderSetup={() => void cancelProviderSetup()}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "skills" ? (
				<SkillsConfigModal
					workspacePath={snapshot.workspacePath}
					projectTrusted={snapshot.projectTrusted}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "plugins" ? (
				<PluginsConfigModal
					plugins={snapshot.plugins}
					workspacePath={snapshot.workspacePath}
					projectTrusted={snapshot.projectTrusted}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "settings" ? (
				<AppSettingsModal
					theme={theme}
					language={language}
					notifyOnComplete={notifyOnComplete}
					onChangeTheme={setTheme}
					onChangeLanguage={setLanguage}
					onToggleNotify={() => setNotifyOnComplete((current) => !current)}
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
			{extensionDialog && extensionDialogSessionId === session?.id ? (
				<ExtensionDialog
					dialog={extensionDialog}
					busy={respondingExtension}
					onRespond={(id, value) => {
						setRespondingExtension(true);
						void respondToExtensionDialog(id, value)
							.catch(() => {})
							.finally(() => {
								setRespondingExtension(false);
								setExtensionDialog(undefined);
								setExtensionDialogSessionId(undefined);
							});
					}}
				/>
			) : null}
			{extensionCustomUi && extensionCustomUi.sessionId === session?.id ? (
				<ExtensionCustomPanel
					id={extensionCustomUi.id}
					lines={extensionCustomUi.lines}
					onInput={(id, data) => void sendExtensionCustomInput(id, data).catch(() => {})}
				/>
			) : null}
			{pendingFileConflicts ? (
				<div className="modal-backdrop">
					<div className="models-discard-dialog" role="dialog" aria-modal="true" aria-label="处理同名文件">
						<strong>项目中已有同名文件</strong>
						<p>
							{pendingFileConflicts.names.slice(0, 4).join("、")}
							{pendingFileConflicts.names.length > 4 ? ` 等 ${pendingFileConflicts.names.length} 个文件` : ""}
						</p>
						<p>替换会覆盖项目中的现有内容；跳过则保留现有文件。</p>
						<div>
							<button
								className="outline-button"
								type="button"
								onClick={() => void handleFileConflictDecision(false)}
							>
								全部跳过
							</button>
							<button
								className="accent-button"
								type="button"
								onClick={() => void handleFileConflictDecision(true)}
							>
								全部替换
							</button>
						</div>
					</div>
				</div>
			) : null}
			<UpdateReminder onOpenSettings={() => setConfigModal("settings")} />
		</main>
	);
}
