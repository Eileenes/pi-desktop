import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
	DesktopAuthenticationPrompt,
	DesktopExtensionDialog,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopImportedFileResult,
	DesktopModel,
	DesktopOpenWithApp,
	DesktopPermissionMode,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopThinkingLevel,
	DesktopToolApproval,
	DesktopTranscriptBlock,
	DesktopTranscriptMessage,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { formatSessionReference } from "../shared/session-reference.ts";
import { flattenSessionTree } from "../shared/session-tree.ts";
import { permitsTool } from "../shared/tool-permissions.ts";
import { parseAnsiLine } from "./ansi.ts";
import { type AppAccent, AppSettingsModal, isAppAccent } from "./app-settings-modal.tsx";
import { BranchNavigator } from "./branch-navigator.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { FILE_TREE_ROW, NATIVE_TOOLBAR_ACTIVE, NATIVE_TOOLBAR_BUTTON } from "./chrome-classes.ts";
import {
	formatExtensionStatusLine,
	getComposerThinkingLevels,
	getModelDisplayName,
	getPlainExtensionStatusLine,
	getThinkingDisplayLabel,
} from "./composer-controls.ts";
import { ConversationNavigator } from "./conversation-navigator.tsx";
import {
	abortSession,
	attachDroppedImages,
	autoNameSession,
	cancelProviderSetup,
	chooseImages,
	chooseWorkspace,
	clearSessionQueue,
	closeWindow,
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
	getOpenWithApps,
	importDroppedFiles,
	listGitChanges,
	listGitWorktrees,
	listWorkspaceDirectory,
	minimizeWindow,
	navigateTree,
	newSession,
	notifyComplete,
	onExtensionUi,
	onWorkspaceChanged,
	openSession,
	openWorkspaceFile,
	openWorkspacePath,
	openWorkspaceWith,
	readFullBashOutput,
	readWorkspaceFile,
	reloadSession,
	renameSession,
	respondToAuthenticationPrompt,
	respondToExtensionDialog,
	restoreImageAttachments,
	restoreMessageImages,
	revealProjectPath,
	revealWorkspaceFile,
	saveFullBashOutput,
	saveWorkspaceFile,
	searchWorkspaceFiles,
	selectDirectory,
	sendExtensionCustomInput,
	setModel,
	setPermissionMode,
	setProjectTrust,
	setThinkingLevel,
	startDesktopStore,
	startProviderSetup,
	submitPrompt,
	subscribeDesktopSnapshot,
	toggleWindowMaximize,
	setToolPreset as updateToolPreset,
} from "./desktop-store.ts";
import { ExtensionCustomPanel, ExtensionWidgetStack } from "./extension-custom-panel.tsx";
import { ExtensionDialog } from "./extension-dialog.tsx";
import { type I18n, type TranslationKey, useI18n } from "./i18n.ts";
import { appShortcutFor, isComposingInput } from "./keyboard-shortcuts.ts";
import { MarkdownBody } from "./markdown.tsx";
import { ModelsConfigModal } from "./models-config-modal.tsx";
import { PermissionRiskDialog } from "./permission-risk-dialog.tsx";
import { PluginsConfigModal } from "./plugins-config-modal.tsx";
import { ProjectEditorDialog } from "./project-editor-dialog.tsx";
import { ProjectTrustDialog } from "./project-trust-dialog.tsx";
import { forgetScrollPosition, readScrollPosition, writeScrollPosition } from "./scroll-memory.ts";
import { SearchDialog } from "./search-dialog.tsx";
import { ContextUsageRing, SessionStatsPanel } from "./session-stats.tsx";
import { SkillsConfigModal } from "./skills-config-modal.tsx";
import { getLanguageForPath, HighlightedCode } from "./syntax-highlight.tsx";
import { TerminalPanel } from "./terminal-panel.tsx";
import { TokenActivityModal } from "./token-activity-modal.tsx";
import { buildConversationTurns, partitionTranscript, type TranscriptRenderItem } from "./transcript-group.ts";
import { Button } from "./ui/button.tsx";
import { Menu, MenuDivider, MenuEmpty, MenuFilter, MenuHeading, MenuItem } from "./ui/menu.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";
import { UpdateButton } from "./update-button.tsx";

import { WorktreeSection } from "./worktree-selector.tsx";

/** The configuration surfaces, reached from the footer's single entry point. */
const FOOTER_SETTINGS_ENTRIES: ReadonlyArray<{
	modal: ConfigModal;
	icon: IconName;
	label: TranslationKey;
}> = [
	{ modal: "settings", icon: "gear", label: "settings" },
	{ modal: "models", icon: "model", label: "models" },
	{ modal: "plugins", icon: "plugin", label: "plugins" },
	{ modal: "skills", icon: "skill", label: "skills" },
	{ modal: "usage", icon: "chart", label: "tokenActivity" },
];

/** Approval policies, in the order the menu lists them. */
const PERMISSION_MODES: readonly DesktopPermissionMode[] = ["ask", "autoEdit", "full"];

const PERMISSION_LABELS: Record<DesktopPermissionMode, TranslationKey> = {
	ask: "permissionAsk",
	autoEdit: "permissionAutoEdit",
	full: "permissionFull",
};

const PERMISSION_HINTS: Record<DesktopPermissionMode, TranslationKey> = {
	ask: "permissionAskHint",
	autoEdit: "permissionAutoEditHint",
	full: "permissionFullHint",
};

/*
 * Project presentation lives in the renderer: the sidebar already derives its
 * project list from the session index, so the name, the folded-in folders, the
 * pin, the section, and the archived-chat flag are local preferences rather
 * than runtime state.
 */
interface ProjectProfile {
	name?: string;
	folders?: string[];
}

interface ProjectSections {
	names: string[];
	assignments: Record<string, string>;
}

function readStoredStringSet(key: string): Set<string> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

function readStoredProjectProfiles(): Record<string, ProjectProfile> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem("pi-desktop-project-profiles") ?? "{}");
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const profiles: Record<string, ProjectProfile> = {};
		for (const [root, profile] of Object.entries(value as Record<string, unknown>)) {
			if (typeof profile !== "object" || profile === null || Array.isArray(profile)) continue;
			const record = profile as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : undefined;
			const folders = Array.isArray(record.folders)
				? record.folders.filter((item): item is string => typeof item === "string")
				: undefined;
			profiles[root] = { ...(name ? { name } : {}), ...(folders?.length ? { folders } : {}) };
		}
		return profiles;
	} catch {
		return {};
	}
}

function readStoredProjectSections(): ProjectSections {
	try {
		const value: unknown = JSON.parse(localStorage.getItem("pi-desktop-project-sections") ?? "{}");
		if (typeof value !== "object" || value === null || Array.isArray(value)) return { names: [], assignments: {} };
		const record = value as Record<string, unknown>;
		const names = Array.isArray(record.names)
			? record.names.filter((item): item is string => typeof item === "string" && item.length > 0)
			: [];
		const assignments: Record<string, string> = {};
		if (typeof record.assignments === "object" && record.assignments !== null && !Array.isArray(record.assignments)) {
			for (const [root, section] of Object.entries(record.assignments as Record<string, unknown>)) {
				if (typeof section === "string" && section.length > 0) assignments[root] = section;
			}
		}
		return { names, assignments };
	} catch {
		return { names: [], assignments: {} };
	}
}

/** The project's own folder name, for rows that have no custom name yet. */
function projectFolderLabel(path: string): string {
	return (
		path
			.replace(/[\\/]+$/u, "")
			.split(/[\\/]/u)
			.at(-1) || path
	);
}

/** Tool presets are built from a fixed name pair so the menu stays type-safe. */
type ToolPresetLabelKey = "toolPresetNone" | "toolPresetDefault" | "toolPresetFull";
type ToolPresetHintKey = "toolPresetNoneDescription" | "toolPresetDefaultDescription" | "toolPresetFullDescription";

/** Commands still ask under auto-edit, so running one needs full access. */
const COMMAND_TOOLS = new Set(["bash", "powershell", "execute", "shell", "run"]);
const EDIT_PERMISSION_TOOLS = new Set(["edit", "write", "str_replace", "apply_patch"]);
const READ_PERMISSION_TOOLS = new Set(["read", "grep", "find", "ls"]);
const TOOL_DENIED_REASON = "Desktop user denied this tool call.";

type PermissionAction = "command" | "edit" | "read" | "tool";

function permissionActionFor(toolName: string): PermissionAction {
	if (COMMAND_TOOLS.has(toolName)) return "command";
	if (EDIT_PERMISSION_TOOLS.has(toolName)) return "edit";
	if (READ_PERMISSION_TOOLS.has(toolName)) return "read";
	return "tool";
}

/** The mode that lets this tool through without another prompt. */
function permissionNeededFor(action: PermissionAction): DesktopPermissionMode | undefined {
	if (action === "read") return undefined;
	return action === "edit" ? "autoEdit" : "full";
}

function describeAssistantError(
	message: DesktopTranscriptMessage,
	isStreaming: boolean | undefined,
	hasContent: boolean,
	t: I18n["t"],
): string | undefined {
	if (message.role !== "assistant") return undefined;
	if (message.errorMessage) {
		return message.stopReason && message.stopReason !== "stop"
			? `${message.errorMessage}（${message.stopReason}）`
			: message.errorMessage;
	}
	if (message.stopReason === "error") return t("modelAborted");
	if (isStreaming || hasContent) return undefined;
	return message.stopReason
		? t("emptyModelResponseWithReason", { reason: message.stopReason })
		: t("emptyModelResponse");
}

function lastDeniedTool(
	messages: ReadonlyArray<{ role: string; text: string; toolName?: string }> | undefined,
): string | undefined {
	if (!messages) return undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || message.role !== "tool" || !message.text.includes(TOOL_DENIED_REASON)) continue;
		return message.toolName ?? "tool";
	}
	return undefined;
}

const LABEL_CHAR_LIMIT = 5;

/** Cuts a label to the sidebar's character budget; the tooltip keeps the rest. */
function truncateLabel(text: string): string {
	const characters = [...text];
	return characters.length > LABEL_CHAR_LIMIT ? `${characters.slice(0, LABEL_CHAR_LIMIT).join("")}…` : text;
}

function tipPosition(event: { currentTarget: HTMLElement }): { top: number; left: number } {
	const rect = event.currentTarget.getBoundingClientRect();
	return { top: rect.top, left: rect.right };
}

function displayPath(path: string): string {
	const home = path.startsWith("/Users/") ? path.replace(/^\/Users\/[^/]+/u, "~") : path;
	return home;
}

function sessionAgeLabel(timestamp: number, t: I18n["t"]): string {
	const days = Math.floor((Date.now() - timestamp) / 86_400_000);
	if (days <= 0) return t("sessionAgeToday");
	return t("sessionAgeDays", { count: days });
}

type IconName =
	| "archiveBox"
	| "branch"
	| "briefcase"
	| "briefcaseOpen"
	| "bulb"
	| "chart"
	| "chat"
	| "chevron"
	| "chevronDown"
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
	| "monitor"
	| "newChat"
	| "package"
	| "moon"
	| "more"
	| "panel"
	| "pin"
	| "plugin"
	| "plus"
	| "search"
	| "sections"
	| "send"
	| "shield"
	| "shieldAlert"
	| "stop"
	| "edit"
	| "check"
	| "skill"
	| "sparkles"
	| "speaker"
	| "speakerOff"
	| "sun"
	| "terminal"
	| "wrap"
	| "wrench";
type ConfigModal = "models" | "plugins" | "settings" | "skills" | "usage";

const DRAFT_STORAGE_PREFIX = "pi-desktop-draft:";
const DRAFT_INDEX_STORAGE_KEY = "pi-desktop-draft-index";
const MAX_STORED_DRAFTS = 40;
const MAX_IMAGE_ATTACHMENTS = 10;
const THINKING_LEVEL_DESCRIPTION_KEYS: Record<DesktopThinkingLevel, TranslationKey> = {
	auto: "thinkingUseDefaultDescription",
	off: "thinkingOffDescription",
	minimal: "thinkingMinimalDescription",
	low: "thinkingLowDescription",
	medium: "thinkingMediumDescription",
	high: "thinkingHighDescription",
	xhigh: "thinkingXhighDescription",
	max: "thinkingMaxDescription",
};

const COMPACT_COMPOSER_MEDIA_QUERY = "(max-width: 640px)";
const COMPOSER_SLASH_MENU =
	"absolute right-0 bottom-[calc(100%+8px)] left-0 z-50 grid max-h-[min(56vh,460px)] overflow-auto rounded-[var(--radius-lg)] border-[0.5px] border-[var(--ds-border-default)] bg-[color-mix(in_oklab,var(--ds-bg-elevated-opaque)_82%,transparent)] p-[5px] shadow-[0_0_0_0.5px_var(--ds-border-subtle),var(--ds-shadow-dialog)] backdrop-blur-[18px] backdrop-saturate-125 supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]";
const COMPOSER_SLASH_HEADER =
	"sticky top-0 z-[1] flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-[7px]";
const COMPOSER_SLASH_HEADER_LABEL =
	"text-[length:var(--text-2xs)] font-semibold tracking-[0.06em] text-[color:var(--muted)] uppercase";
const COMPOSER_SLASH_HEADER_HINT = "text-[length:var(--text-2xs)] text-[color:var(--muted)]";
const COMPOSER_SLASH_EMPTY = "m-0 px-3.5 py-2.5 text-[length:var(--text-xs)] text-[color:var(--muted)]";
const COMPOSER_SLASH_COMMAND =
	"flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[length:var(--text-sm-plus)] text-[color:var(--text-dim)] hover:bg-[var(--overlay-5)] [&>span]:truncate";
const COMPOSER_SLASH_COMMAND_SELECTED = "bg-[var(--overlay-5)] text-[color:var(--text)]";
const COMPOSER_SLASH_COMMAND_GRID =
	"grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-2 gap-y-0.5 rounded-[var(--radius-xs)] border border-transparent px-2.5 py-2 text-left text-[length:var(--text-sm-plus)] text-[color:var(--text-dim)] hover:border-[var(--border-subtle)] hover:bg-[var(--overlay-5)] [&>code]:col-span-full [&>code]:font-[family-name:var(--font-mono)] [&>code]:text-[length:var(--text-xs)] [&>code]:text-[color:var(--text)] [&>span]:col-start-1 [&>span]:text-[color:var(--text-dim)] [&>small]:col-start-2 [&>small]:justify-self-end [&>small]:text-[length:var(--text-2xs)] [&>small]:text-[color:var(--muted)] [&>small]:uppercase";
const COMPOSER_CONTROL_MENU =
	"absolute bottom-[calc(100%+6px)] z-40 grid max-h-80 min-w-[220px] max-w-[min(320px,80vw)] overflow-auto [&_.app-menu-copy]:whitespace-normal [&_.app-menu-hint]:whitespace-normal";
const SIDEBAR_HOVER_CARD =
	"fixed z-[80] grid w-max min-w-[220px] max-w-[320px] rounded-[var(--radius-md)] bg-[var(--ds-bg-elevated-opaque)] p-1.5 text-[color:var(--text-primary)] shadow-[var(--ds-elevation-stroke),var(--ds-shadow-dialog)]";
const SIDEBAR_HOVER_TITLE =
	"flex min-w-0 items-center gap-2 rounded-[var(--radius-xs)] border-0 bg-transparent px-2 py-1.5 text-left text-[length:var(--text-sm)] font-[var(--font-weight-medium)] [&>span]:truncate [&>small]:ml-auto [&>small]:whitespace-nowrap [&>small]:text-[length:var(--text-xs)] [&>small]:text-[color:var(--text-tertiary)]";
const SIDEBAR_HOVER_ROW =
	"flex min-w-0 items-center gap-2 rounded-[var(--radius-xs)] border-0 bg-transparent px-2 py-1.5 text-left text-[length:var(--text-sm)] text-[color:var(--text-secondary)] [&>span]:truncate";
const SIDEBAR_HOVER_DIVIDER = "mx-2 my-1 h-px bg-[var(--border-subtle)]";
const SIDEBAR_EMPTY =
	"grid justify-items-start gap-2.5 px-5 py-[26px] text-[color:var(--muted)] [&>svg]:mb-1 [&>svg]:text-[color:var(--muted)] [&>strong]:text-[length:var(--text-md)] [&>strong]:font-semibold [&>strong]:text-[color:var(--text)] [&>p]:mb-1.5 [&>p]:text-[length:var(--text-sm)] [&>p]:leading-[1.55]";
const SIDEBAR_SESSION_MORE_MENU =
	"absolute top-[calc(100%+2px)] right-1 z-[45] grid min-w-[150px] max-w-[240px] rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-float)] [&_button]:overflow-hidden [&_button]:rounded-[var(--radius-2xs)] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2.5 [&_button]:py-[7px] [&_button]:text-left [&_button]:text-[length:var(--text-sm)] [&_button]:text-ellipsis [&_button]:whitespace-nowrap [&_button]:text-[color:var(--text)] [&_button:hover:not(:disabled)]:bg-[var(--ds-bg-hover)] [&_button:disabled]:opacity-50 [&_button.is-danger]:text-[color:var(--ds-error)]";
const SIDEBAR_PROJECT_ACTION =
	"inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent p-0 text-[color:var(--muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] [&>svg]:block";

function subscribeCompactComposer(onStoreChange: () => void): () => void {
	const media = window.matchMedia(COMPACT_COMPOSER_MEDIA_QUERY);
	media.addEventListener("change", onStoreChange);
	return () => media.removeEventListener("change", onStoreChange);
}

function getCompactComposerSnapshot(): boolean {
	return typeof window !== "undefined" && window.matchMedia(COMPACT_COMPOSER_MEDIA_QUERY).matches;
}

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
	if (name === "speakerOff") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M11 5 6 9H3v6h3l5 4V5Z" />
				<path d="m17 9 4 4m0-4-4 4" />
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
	if (name === "package") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m7.5 4.3 9 5.2" />
				<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
				<path d="m3.3 7 8.7 5 8.7-5" />
				<path d="M12 22V12" />
			</svg>
		);
	}
	if (name === "chevronDown")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m6 9 6 6 6-6" />
			</svg>
		);
	if (name === "monitor") {
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="3" y="4.5" width="18" height="12" rx="2" />
				<path d="M8 20h8M12 16.5V20" />
			</svg>
		);
	}
	if (name === "newChat") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" />
				<path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6l-4 .8.8-4z" />
			</svg>
		);
	}
	if (name === "shield" || name === "shieldAlert") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
				{name === "shieldAlert" ? (
					<>
						<path d="M12 8v5" />
						<circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
					</>
				) : null}
			</svg>
		);
	}
	if (name === "stop") {
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
				<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
			</svg>
		);
	}
	if (name === "edit") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 20h9" />
				<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
			</svg>
		);
	}
	if (name === "check") {
		return (
			<svg {...shared} aria-hidden="true">
				<path d="m5 12.5 4.5 4.5L19 7" />
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
	if (name === "briefcase")
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="3" y="8" width="18" height="12" rx="2.5" />
				<path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" />
				<path d="M3 13h18" />
			</svg>
		);
	if (name === "briefcaseOpen")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M3 20v-5.5A2.5 2.5 0 0 1 5.5 12h13a2.5 2.5 0 0 1 2.5 2.5V20" />
				<path d="M3 20h18" />
				<path d="M9 12V9.5A1.5 1.5 0 0 1 10.5 8h3A1.5 1.5 0 0 1 15 9.5V12" />
				<path d="M5.5 12 7 6.5h10l1.5 5.5" />
			</svg>
		);
	if (name === "pin")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M12 17v5" />
				<path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z" />
			</svg>
		);
	if (name === "sections")
		return (
			<svg {...shared} aria-hidden="true">
				<path d="M9 6h12M9 12h12M9 18h12" />
				<path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
			</svg>
		);
	if (name === "archiveBox")
		return (
			<svg {...shared} aria-hidden="true">
				<rect x="3" y="4" width="18" height="16" rx="2.5" />
				<path d="M3 9h18" />
				<path d="M10 13h4" />
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

function formatWorkspace(path: string | undefined, t: I18n["t"]): string {
	if (!path) return t("noWorkspaceSelected");
	const segments = path.split(/[\\/]/u).filter(Boolean);
	return segments.at(-1) ?? path;
}

function sessionTitle(info: DesktopSessionInfo, t: I18n["t"]): string {
	if (info.name) return info.name;
	const first = info.firstMessage.trim();
	if (!first) return t("newSession");
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

function formatAttachmentSize(size: number, t: I18n["t"]): string {
	if (size < 1024 * 1024) return t("sizeKilobytes", { count: Math.ceil(size / 1024) });
	return t("sizeMegabytes", { value: (size / (1024 * 1024)).toFixed(1) });
}

function formatMessageTime(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function getFileKindLabel(path: string, t: I18n["t"]): string {
	const extension = getFileExtension(path);
	const labels: Record<string, string> = {
		c: "C",
		cpp: "C++",
		css: "CSS",
		gif: t("gifImage"),
		go: "Go",
		h: t("headerFile"),
		html: "HTML",
		java: "Java",
		jpeg: t("jpegImage"),
		jpg: t("jpegImage"),
		js: "JavaScript",
		jsx: "JSX",
		json: "JSON",
		md: "Markdown",
		markdown: "Markdown",
		mdx: "MDX",
		png: t("pngImage"),
		py: "Python",
		rs: "Rust",
		sh: "Shell",
		svg: t("svgImage"),
		toml: "TOML",
		ts: "TypeScript",
		tsx: "TSX",
		txt: t("textFile"),
		webp: t("webpImage"),
		yaml: "YAML",
		yml: "YAML",
	};
	return labels[extension] ?? (extension ? extension.toUpperCase() : t("fileLabel"));
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

function useCompletionAudio(): { play: () => void; unlock: () => void } {
	const contextRef = useRef<AudioContext | undefined>(undefined);

	const getContext = useCallback((): AudioContext | undefined => {
		const existing = contextRef.current;
		if (existing && existing.state !== "closed") return existing;
		try {
			contextRef.current = new AudioContext();
			return contextRef.current;
		} catch {
			return undefined;
		}
	}, []);

	const unlock = useCallback(() => {
		const context = getContext();
		if (context?.state === "suspended") void context.resume().catch(() => undefined);
	}, [getContext]);

	const play = useCallback(() => {
		const context = getContext();
		if (!context) return;
		const start = () => {
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
		};
		if (context.state === "suspended")
			void context
				.resume()
				.then(start)
				.catch(() => undefined);
		else start();
	}, [getContext]);

	useEffect(
		() => () => {
			const context = contextRef.current;
			if (context && context.state !== "closed") void context.close();
		},
		[],
	);

	return { play, unlock };
}

interface ToolApprovalCardProps {
	onOpenSession: (sessionId: string) => void;
	approval: DesktopToolApproval;
	resolving: boolean;
	onDecide: (id: string, approved: boolean) => Promise<void>;
}

const ToolApprovalCard = memo(function ToolApprovalCard({
	approval,
	resolving,
	onDecide,
	onOpenSession,
}: ToolApprovalCardProps) {
	const { t } = useI18n();
	const inputText = JSON.stringify(approval.input, null, 2);
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	const seconds = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000));
	return (
		<article className="approval-card grid gap-3.5 rounded-[var(--radius-lg)] border-[0.5px] border-[var(--ds-border-subtle)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-float)] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]">
			<div className="flex items-center justify-between gap-3 [&>div>h3]:mt-1 [&>div>h3]:mb-0 [&>div>h3]:text-[length:var(--text-lg-plus)] [&>div>h3]:font-semibold [&>div>h3]:tracking-[-0.01em]">
				<div>
					<p className="m-0 text-[length:var(--text-xs)] font-medium text-[color:var(--muted)]">
						{t("toolApproval")}
					</p>
					<h3>{approval.toolName}</h3>
				</div>
				<span className="font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[color:var(--muted)]">
					{approval.toolCallId.slice(0, 8)}
				</span>
			</div>
			<div className="my-2.5 grid justify-items-start gap-1.5 [&>code]:text-[12px] [&>code]:[overflow-wrap:anywhere] [&>small]:text-[color:var(--text-muted)]">
				<Button variant="outline" type="button" onClick={() => onOpenSession(approval.sessionId)}>
					{approval.sessionName ?? approval.sessionId}
				</Button>
				{approval.workspacePath ? <code>{approval.workspacePath}</code> : null}
				<small>{t("approvalExpires", { seconds })}</small>
			</div>
			<pre className="m-0 max-h-[180px] overflow-auto rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] p-3 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] leading-[1.55] text-[color:var(--text-dim)]">
				{inputText}
			</pre>
			<div className="flex items-center justify-end gap-3">
				<Button
					variant="outline"
					type="button"
					disabled={resolving || seconds === 0}
					onClick={() => void onDecide(approval.id, false)}
				>
					{t("reject")}
				</Button>
				<Button
					variant="primary"
					type="button"
					disabled={resolving || seconds === 0}
					onClick={() => void onDecide(approval.id, true)}
				>
					{resolving ? t("processing") : t("allowOnce")}
				</Button>
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
	const { t } = useI18n();
	return (
		<div className="my-1 ml-5 max-h-[560px] overflow-auto rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">
			<div className="sticky top-0 z-[1] grid grid-cols-2 border-b border-[var(--border-subtle)] bg-[var(--surface-recessed)] text-[color:var(--muted)] [&>span]:px-2.5 [&>span]:py-1.5 [&>span+span]:border-l [&>span+span]:border-[var(--border-subtle)]">
				<span>{t("oldContent")}</span>
				<span>{t("newContent")}</span>
			</div>
			{lines.map((line, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定
				<div className="grid min-h-[22px] grid-cols-2 items-stretch" key={index}>
					<div
						className={`grid min-w-0 grid-cols-[36px_16px_minmax(0,1fr)] items-baseline border-b border-[rgb(255_255_255/3%)] [&>code]:min-w-0 [&>code]:pr-2.5 [&>code]:break-all [&>code]:whitespace-pre-wrap ${line.kind === "add" ? "bg-[rgb(255_255_255/2%)] text-transparent" : "bg-[color-mix(in_oklab,var(--ds-error)_13%,transparent)] text-[color:var(--text-dim)] [&>code]:line-through [&>code]:decoration-[color-mix(in_oklab,var(--ds-error)_40%,transparent)]"}`}
					>
						<span className="pr-2 text-right text-[color:var(--muted)] select-none">{line.oldLine ?? ""}</span>
						<span
							className={`text-center select-none ${line.kind === "del" ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"}`}
						>
							{line.kind === "del" ? "−" : " "}
						</span>
						<code>{line.kind === "add" ? " " : line.text || " "}</code>
					</div>
					<div
						className={`grid min-w-0 grid-cols-[36px_16px_minmax(0,1fr)] items-baseline border-b border-l border-[var(--border-subtle)] border-b-[rgb(255_255_255/3%)] [&>code]:min-w-0 [&>code]:pr-2.5 [&>code]:break-all [&>code]:whitespace-pre-wrap ${line.kind === "del" ? "bg-[rgb(255_255_255/2%)] text-transparent" : "bg-[color-mix(in_oklab,var(--ds-success)_12%,transparent)] text-[color:var(--text)]"}`}
					>
						<span className="pr-2 text-right text-[color:var(--muted)] select-none">{line.newLine ?? ""}</span>
						<span
							className={`text-center select-none ${line.kind === "add" ? "text-[color:var(--success)]" : "text-[color:var(--muted)]"}`}
						>
							{line.kind === "add" ? "+" : " "}
						</span>
						<code>{line.kind === "del" ? " " : line.text || " "}</code>
					</div>
				</div>
			))}
		</div>
	);
});

function lastMeaningfulLine(text: string): string {
	const lines = text
		.split("\n")
		.map((line) =>
			line
				.replace(/^#+\s*/u, "")
				.replaceAll("**", "")
				.trim(),
		)
		.filter(Boolean);
	return lines.at(-1) ?? "";
}

function formatClockDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

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

const TranscriptBlock = memo(function TranscriptBlock({ block }: { block: DesktopTranscriptBlock }) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(false);
	if (block.type === "text") return <MarkdownBody text={block.text} />;
	if (block.type === "image") {
		return block.thumbnailDataUrl ? (
			<img
				className="block max-h-[240px] max-w-[min(240px,100%)] rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--accent)_18%,transparent)] object-contain"
				src={block.thumbnailDataUrl}
				alt={block.label}
			/>
		) : (
			<span className="inline-block rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] px-2 py-[5px] text-[length:var(--text-xs)] text-[color:var(--muted)]">
				{block.label}
			</span>
		);
	}
	if (block.type === "thinking") {
		const thinkingText = block.text.trim();
		const preview = lastMeaningfulLine(thinkingText) || thinkingText;
		if (!thinkingText) return null;
		return (
			<div className="my-[3px]">
				<Button
					variant="bare"
					className="mx-[-4px] flex w-full min-h-6 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border-0 bg-transparent px-1 py-0.5 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text-primary)]"
					aria-expanded={expanded}
					onClick={() => setExpanded((current) => !current)}
				>
					<span className="inline-flex shrink-0 text-[color:var(--ds-text-muted)]" aria-hidden="true">
						<Icon name="sparkles" size={14} />
					</span>
					<span className="shrink-0 font-medium">{t("thinkingLabel")}</span>
					{expanded || !preview ? null : (
						<span className="min-w-0 flex-1 truncate text-[length:var(--text-xs-plus)] text-[color:var(--ds-text-muted)]">
							{preview}
						</span>
					)}
					<span
						className={`ml-auto grid shrink-0 place-items-center opacity-65 transition-transform ${expanded ? "rotate-90" : ""}`}
					>
						<Icon name="chevron" size={12} />
					</span>
				</Button>
				{expanded ? (
					<pre className="my-1 max-h-80 overflow-auto rounded-[var(--radius-sm)] bg-[var(--ds-thinking-code-bg)] px-2.5 py-2 font-[inherit] text-[length:var(--text-xs)] text-[color:var(--ds-text-secondary)]">
						<code>{thinkingText}</code>
					</pre>
				) : null}
			</div>
		);
	}
	const editDiff = parseEditToolDiff(block.name, block.input);
	return (
		<div className="my-[3px]">
			<Button
				variant="bare"
				className="mx-[-4px] flex w-full min-h-6 min-w-0 items-center gap-2 rounded-[var(--radius-sm)] border-0 bg-transparent px-1 py-0.5 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text-primary)]"
				aria-expanded={expanded}
				onClick={() => setExpanded((current) => !current)}
			>
				<code className="font-[family-name:var(--font-sans)] text-[length:var(--text-sm-plus)] font-[var(--font-weight-medium)] text-[color:var(--text-dim)]">
					{block.name}
				</code>
				<span className="min-w-0 truncate font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--muted)]">
					{toolCallPreview(block.input)}
				</span>
				<span
					className={`ml-auto grid shrink-0 place-items-center opacity-65 transition-transform ${expanded ? "rotate-90" : ""}`}
				>
					<Icon name="chevron" size={12} />
				</span>
			</Button>
			{expanded ? (
				editDiff ? (
					<EditDiffView lines={editDiff.lines} />
				) : (
					<pre className="my-[3px] ml-5 max-h-80 overflow-auto rounded-[var(--radius-sm)] bg-[var(--ds-thinking-code-bg)] px-2.5 py-2 text-[length:var(--text-xs)] leading-[var(--leading-normal)] whitespace-pre-wrap text-[color:var(--text-secondary)]">
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

const COLLAPSE_HEIGHT = 220;

const UserMessageBody = memo(function UserMessageBody({
	text,
	blocks,
}: {
	text: string;
	blocks?: DesktopTranscriptBlock[];
}) {
	const { t } = useI18n();
	const [collapsed, setCollapsed] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const imageBlocks =
		blocks?.filter((block): block is Extract<DesktopTranscriptBlock, { type: "image" }> => block.type === "image") ??
		[];
	const imagePreview = imageBlocks.length ? (
		<div className="mb-2 flex flex-wrap gap-1.5">
			{imageBlocks.map((block, index) =>
				block.thumbnailDataUrl ? (
					<img
						className="block h-auto w-[240px] max-h-[240px] max-w-full rounded-[var(--radius-2xs)] border border-[color-mix(in_srgb,var(--accent)_18%,transparent)] object-contain"
						key={`${block.label}:${index}`}
						src={block.thumbnailDataUrl}
						alt={block.label}
					/>
				) : (
					<span
						className="inline-block rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] px-2 py-[5px] text-[length:var(--text-xs)] text-[color:var(--muted)]"
						key={`${block.label}:${index}`}
					>
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
			<div className="min-w-0" ref={bodyRef}>
				{imagePreview}
				{text ? <MarkdownBody text={text} /> : null}
			</div>
		);
	}
	return (
		<div className="min-w-0 max-w-full">
			<div
				className={`min-w-0 ${collapsed ? "max-h-[220px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent_100%)]" : ""}`}
				ref={bodyRef}
			>
				{imagePreview}
				{text ? <MarkdownBody text={text} /> : null}
			</div>
			<Button
				variant="bare"
				className="mt-[5px] inline-flex items-center gap-1 rounded-full border-0 bg-[var(--ds-tile-hover)] px-[9px] py-[3px] text-[length:var(--text-xs)] text-[color:var(--muted)] hover:bg-[var(--overlay-12)] hover:text-[color:var(--text)]"
				onClick={() => setCollapsed((current) => !current)}
			>
				{collapsed ? t("expandAll") : t("collapse")}
				<span className="grid place-items-center rotate-90">
					<Icon name="chevron" size={11} />
				</span>
			</Button>
		</div>
	);
});

function parseCompactionSummary(summary: string): { body: string; readFiles: string[]; modifiedFiles: string[] } {
	const readFiles: string[] = [];
	const modifiedFiles: string[] = [];
	const sections = /<(read-files|modified-files)>\s*([\s\S]*?)\s*<\/\1>/gu;
	let body = summary;
	for (const match of summary.matchAll(sections)) {
		const files = match[2]
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		if (match[1] === "read-files") readFiles.push(...files);
		else modifiedFiles.push(...files);
		body = body.replace(match[0], "");
	}
	return { body: body.trim(), readFiles, modifiedFiles };
}

const CompactionMessageBody = memo(function CompactionMessageBody({ message }: { message: DesktopTranscriptMessage }) {
	const { t } = useI18n();
	const { body, readFiles, modifiedFiles } = useMemo(() => parseCompactionSummary(message.text), [message.text]);
	const contextCount = readFiles.length + modifiedFiles.length;
	return (
		<section className="my-1 mb-3 overflow-visible bg-transparent">
			<header className="flex min-h-7 items-center rounded-[var(--radius-sm)] px-0.5 py-0.5 text-[color:var(--ds-text-secondary)] [&>strong]:shrink-0 [&>strong]:text-[length:var(--text-sm)] [&>strong]:font-medium [&>strong]:leading-5 [&>strong]:text-[color:var(--ds-text-secondary)] [&>span]:min-w-0 [&>span]:truncate [&>span]:text-[length:var(--text-sm)] [&>span]:leading-5 [&>span]:text-[color:var(--ds-text-muted)] [&>time]:ml-auto [&>time]:pl-2 [&>time]:font-[family-name:var(--font-sans)] [&>time]:text-[length:var(--text-xs)] [&>time]:text-[color:var(--ds-text-faint)]">
				<span
					className="mr-1.5 inline-grid size-4 shrink-0 place-items-center text-[color:var(--ds-text-muted)]"
					aria-hidden="true"
				>
					<Icon name="archiveBox" size={14} />
				</span>
				<strong>{t("compactionHintTitle")}</strong>
				<span className="mx-2 size-0.5 shrink-0 rounded-px bg-[var(--ds-text-faint)]" aria-hidden="true" />
				<span>{t("compactionDescription")}</span>
				{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
			</header>
			<div className="mt-1 rounded-[var(--radius-md)] bg-[var(--ds-bg-hover)] px-3 pt-2.5 pb-3 [&>p]:mb-2 [&>p]:text-[length:var(--text-sm)] [&>p]:leading-normal [&>p]:text-[color:var(--text-dim)] [&>strong]:text-[length:var(--text-base-plus)] [&>strong]:text-[color:var(--text)]">
				{body ? (
					<MarkdownBody text={body} />
				) : (
					<span className="text-[length:var(--text-sm)] text-[color:var(--muted)]">{t("noSummary")}</span>
				)}
				{contextCount ? (
					<details className="mt-3 text-[length:var(--text-xs)] text-[color:var(--text-dim)] [&>summary]:cursor-pointer [&>section]:mt-2 [&>section>strong]:text-[length:var(--text-2xs)] [&>section>strong]:text-[color:var(--muted)] [&>section>strong]:uppercase [&>section>ul]:mt-1 [&>section>ul]:pl-[18px] [&>section>ul]:font-[family-name:var(--font-mono)]">
						<summary>{t("fileContext", { count: contextCount })}</summary>
						{modifiedFiles.length ? (
							<section>
								<strong>{t("modifiedFiles")}</strong>
								<ul>
									{modifiedFiles.map((path) => (
										<li key={path}>{path}</li>
									))}
								</ul>
							</section>
						) : null}
						{readFiles.length ? (
							<section>
								<strong>{t("readFiles")}</strong>
								<ul>
									{readFiles.map((path) => (
										<li key={path}>{path}</li>
									))}
								</ul>
							</section>
						) : null}
					</details>
				) : null}
			</div>
		</section>
	);
});

const TranscriptMessage = memo(function TranscriptMessage({
	message,
	modelLabel,
	isStreaming,
	previousTimestamp,
	onEdit,
	onFork,
}: {
	message: DesktopTranscriptMessage;
	modelLabel?: string;
	isStreaming?: boolean;
	previousTimestamp?: number;
	onEdit: (message: DesktopTranscriptMessage) => void;
	onFork: (entryId: string) => void;
}) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);
	const [usageOpen, setUsageOpen] = useState(false);
	const [streamTps, setStreamTps] = useState<number>();
	const streamStartRef = useRef<number | undefined>(undefined);
	const streamCharacterCountRef = useRef(0);
	const isAssistant = message.role === "assistant";
	const hasAssistantContent =
		Boolean(message.text.trim()) ||
		Boolean(
			message.blocks?.some(
				(block) =>
					block.type === "toolCall" ||
					block.type === "image" ||
					((block.type === "text" || block.type === "thinking") && Boolean(block.text.trim())),
			),
		);
	const assistantError = describeAssistantError(message, isStreaming, hasAssistantContent, t);
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

	const usageTitle = [
		message.usage && (message.usage.input > 0 || message.usage.output > 0)
			? formatUsageSummary(message.usage)
			: undefined,
		durationSeconds ? `${durationSeconds}s` : undefined,
		completedTps ? `${completedTps.toFixed(1)} t/s` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
	const showActions =
		message.role === "user" || (isAssistant && !isStreaming && (hasAssistantContent || Boolean(assistantError)));

	return (
		<article
			className={`group max-w-full ${message.role === "user" ? "flex flex-col items-end py-2 pt-3" : "py-1.5 pb-3.5"}`}
		>
			<div
				className={
					message.role === "user"
						? "w-max max-w-[min(82%,600px)] rounded-[var(--radius-lg-plus)] rounded-br-[var(--radius-xs)] bg-[color-mix(in_oklab,var(--ds-text-primary)_8%,transparent)] px-[15px] py-2.5 text-[length:var(--text-base)] leading-[var(--leading-chat)] [overflow-wrap:break-word] text-[color:var(--ds-text-primary)] [&_.markdown-body]:text-[length:inherit] [&_.markdown-body]:leading-[inherit] [&_.markdown-body>:first-child]:mt-0 [&_.markdown-body>:last-child]:mb-0 [&>p]:m-0 [&>p]:whitespace-pre-wrap [&>p]:text-[length:var(--text-base)] [&>p]:leading-[1.72] [&>p]:text-[color-mix(in_oklab,var(--ds-text-primary)_92%,transparent)]"
						: ""
				}
			>
				{assistantError ? (
					<div
						className="grid gap-1.5 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--danger)_46%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2.5 text-[length:var(--text-md)] leading-normal text-[color:var(--text)] [&>strong]:text-[length:var(--text-sm)] [&>pre]:m-0 [&>pre]:max-h-[220px] [&>pre]:overflow-auto [&>pre]:whitespace-pre-wrap"
						role="alert"
					>
						<strong>{t("providerError")}</strong>
						<span>{assistantError}</span>
					</div>
				) : null}
				{isAssistant && hasAssistantContent && message.blocks?.length ? (
					message.blocks.map((block, index) => <TranscriptBlock key={`${block.type}:${index}`} block={block} />)
				) : isAssistant && hasAssistantContent ? (
					<MarkdownBody text={message.text} />
				) : isAssistant ? null : message.role === "custom" && message.customType === "compaction" ? (
					<CompactionMessageBody message={message} />
				) : message.role === "custom" ? (
					<div className="grid gap-1.5 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--danger)_46%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2.5 text-[length:var(--text-md)] leading-normal text-[color:var(--text)] [&>strong]:text-[length:var(--text-sm)] [&>pre]:m-0 [&>pre]:max-h-[220px] [&>pre]:overflow-auto [&>pre]:whitespace-pre-wrap">
						{message.display ? <strong>{message.display}</strong> : null}
						{message.text ? <MarkdownBody text={message.text} /> : null}
						{message.details ? <pre>{message.details}</pre> : null}
					</div>
				) : (
					<UserMessageBody text={message.text} blocks={message.blocks} />
				)}
			</div>
			{isAssistant && !isStreaming && modelLabel ? (
				<div className="mt-2 inline-flex min-h-5 flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--ds-text-muted)]">
					<Button
						variant="bare"
						className="inline-flex max-w-full min-h-5 cursor-pointer items-center gap-1 overflow-hidden rounded-full border-0 bg-[color-mix(in_oklab,var(--ds-text-primary)_5%,transparent)] px-2 py-px text-[length:var(--text-xs)] leading-[1.3] whitespace-nowrap text-[color:var(--ds-text-secondary)] font-[inherit] disabled:cursor-default disabled:opacity-100"
						aria-expanded={usageTitle ? usageOpen : undefined}
						disabled={!usageTitle}
						onClick={() => setUsageOpen((current) => !current)}
					>
						{modelLabel}
						{usageTitle ? (
							<span
								className={`grid shrink-0 place-items-center opacity-65 transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] ${usageOpen ? "rotate-90" : ""}`}
							>
								<Icon name="chevron" size={10} />
							</span>
						) : null}
					</Button>
					{usageOpen && usageTitle ? (
						<span className="m-0 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--muted)] opacity-100">
							{usageTitle}
						</span>
					) : null}
				</div>
			) : null}
			{isAssistant && isStreaming && streamTps !== undefined ? (
				<div className="mt-2 inline-flex min-h-5 flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--ds-text-muted)]">
					<span className="inline-flex max-w-full min-h-5 items-center gap-1 overflow-hidden rounded-full border-0 bg-[color-mix(in_oklab,var(--ds-text-primary)_5%,transparent)] px-2 py-px text-[length:var(--text-xs)] leading-[1.3] whitespace-nowrap text-[color:var(--ds-text-secondary)]">
						{streamTps.toFixed(1)} t/s
					</span>
				</div>
			) : null}
			{showActions ? (
				<div
					className={`flex min-h-6 items-center gap-0.5 pt-0.5 text-[length:var(--text-xs)] text-[color:var(--muted)] ${message.role === "user" ? "justify-end opacity-0 transition-opacity duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] group-hover:opacity-100 group-focus-within:opacity-100" : "justify-start"}`}
				>
					{message.timestamp ? (
						<time className="m-0 px-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[color:var(--muted)] [font-variant-numeric:tabular-nums]">
							{formatMessageTime(message.timestamp)}
						</time>
					) : null}
					<Button
						size="icon"
						className="compact"
						aria-label={copied ? t("copied") : t("copy")}
						title={copied ? t("copied") : t("copy")}
						onClick={() => void copyMessage()}
						disabled={!message.text}
					>
						<Icon name={copied ? "check" : "copy"} size={13} />
					</Button>
					{message.role === "user" && (message.text || message.blocks?.some((block) => block.type === "image")) ? (
						<Button
							size="icon"
							className="compact"
							aria-label={t("edit")}
							title={t("edit")}
							onClick={() => onEdit(message)}
						>
							<Icon name="edit" size={13} />
						</Button>
					) : null}
					{message.forkEntryId ? (
						<Button
							size="icon"
							className="compact"
							aria-label={t("forkResponse")}
							title={t("forkResponse")}
							onClick={() => onFork(message.forkEntryId ?? "")}
						>
							<Icon name="branch" size={13} />
						</Button>
					) : null}
				</div>
			) : null}
		</article>
	);
});

function transcriptDiffLineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return "font-semibold text-[color:var(--muted)]";
	if (line.startsWith("@@")) return "text-[color:var(--accent)]";
	if (line.startsWith("+"))
		return "is-add bg-[color-mix(in_oklab,var(--ds-success)_12%,transparent)] text-[color:var(--success)] [&>code]:text-[color:var(--text)]";
	if (line.startsWith("-"))
		return "is-del bg-[color-mix(in_oklab,var(--ds-error)_13%,transparent)] text-[color:var(--danger)] [&>code]:text-[color:var(--text-dim)] [&>code]:line-through [&>code]:decoration-[color-mix(in_oklab,var(--ds-error)_40%,transparent)]";
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
	const { t } = useI18n();
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
		<article className="my-[3px]">
			<Button
				variant="bare"
				className={`mx-[-4px] inline-flex min-h-6 items-center gap-1 rounded-[var(--radius-sm)] border-0 bg-transparent px-1 py-0.5 text-[length:var(--text-sm-plus)] hover:bg-[var(--hover)] ${message.isError ? "text-[color:var(--danger)]" : "text-[color:var(--text-dim)] hover:text-[color:var(--text-dim)]"}`}
				aria-expanded={expanded}
				onClick={() => setExpanded((current) => !current)}
			>
				<span
					className={`grid place-items-center transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
				>
					<Icon name="chevron" size={11} />
				</span>
				<span>
					{message.command
						? t("terminalEntry", { command: message.command })
						: message.role === "tool"
							? `${message.isError ? t("toolFailed") : t("toolResult")}${message.toolName ? ` · ${message.toolName}` : toolCall ? ` · ${toolCall.name}` : ""}`
							: t("systemMessage")}
				</span>
				{message.toolCallId ? (
					<code className="ml-auto font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[color:var(--muted)]">
						#{message.toolCallId.slice(-6)}
					</code>
				) : null}
				{durationSeconds !== undefined ? (
					<small className="font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] font-normal text-[color:var(--muted)]">
						{durationSeconds}s
					</small>
				) : null}
				{message.timestamp ? <time>{formatMessageTime(message.timestamp)}</time> : null}
			</Button>
			{expanded ? (
				<div className="mt-1.5">
					{toolCall ? (
						<pre className="mb-1 max-h-[140px] overflow-auto rounded-[var(--radius-sm)] border-0 bg-[var(--ds-thinking-code-bg)] px-[11px] py-[9px] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
							<code>{toolCall.input}</code>
						</pre>
					) : null}
					<pre
						className={`m-0 max-h-[220px] overflow-auto rounded-[var(--radius-sm)] border-0 bg-[var(--ds-bg-inset)] px-3 py-2.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] ${message.isError ? "text-[color:var(--danger)]" : "text-[color:var(--text-secondary)]"} ${isDiff ? "[&>code]:grid" : ""}`}
					>
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
								{message.cancelled ? t("cancelled") : t("exitCode", { code: message.exitCode ?? t("unknown") })}
								{message.truncated ? ` · ${t("outputTruncated")}` : ""}
							</small>
						) : null}
					</pre>
					<div className="mt-[5px] flex items-center gap-1.5 text-[length:var(--text-2xs)] text-[color:var(--muted)]">
						<Button size="sm" type="button" onClick={() => void copyOutput()} disabled={!displayedOutput}>
							{copied ? t("copied") : t("copyOutput")}
						</Button>
						{message.truncated && message.fullOutputAvailable && fullOutput === undefined ? (
							<Button size="sm" type="button" disabled={loadingFullOutput} onClick={() => void loadFullOutput()}>
								{loadingFullOutput ? t("reading") : t("viewFullOutput")}
							</Button>
						) : message.truncated && fullOutput === undefined ? (
							<span>{t("outputTruncated")}</span>
						) : null}
						{message.fullOutputAvailable ? (
							<Button
								size="sm"
								type="button"
								disabled={savingFullOutput}
								onClick={() => void downloadFullOutput()}
							>
								{savingFullOutput ? t("saving") : t("downloadFullOutput")}
							</Button>
						) : null}
						{fullOutput !== undefined ? <span>{t("fullOutputShown")}</span> : null}
						{fullOutputError ? <span className="is-error">{fullOutputError}</span> : null}
					</div>
				</div>
			) : null}
		</article>
	);
});

const ProcessDetails = memo(function ProcessDetails({
	item,
	isActive,
	previousTimestamps,
}: {
	item: Extract<TranscriptRenderItem, { type: "process" }>;
	isActive: boolean;
	previousTimestamps: Map<string, number>;
}) {
	const { t } = useI18n();
	const baseSeconds = Math.max(0, Math.floor((item.durationMs ?? 0) / 1000));
	const [liveSeconds, setLiveSeconds] = useState(baseSeconds);
	useEffect(() => {
		setLiveSeconds(baseSeconds);
		if (!isActive) return;
		const timer = window.setInterval(() => setLiveSeconds((current) => current + 1), 1000);
		return () => window.clearInterval(timer);
	}, [baseSeconds, isActive]);
	const time = formatClockDuration(isActive ? liveSeconds : baseSeconds);
	const hasThinking =
		item.blocks.some((block) => block.type === "thinking") ||
		item.messages.some((message) => message.blocks?.some((block) => block.type === "thinking"));
	const thinkingOnly = hasThinking && item.toolCallCount === 0;
	const labelKey = isActive ? (thinkingOnly ? "thinkingFor" : "processingFor") : "processedFor";
	const processBlocks =
		item.blocks.length > 0
			? item.blocks
			: item.messages.flatMap((message) =>
					(message.blocks ?? []).filter((block) => block.type === "thinking" || block.type === "toolCall"),
				);
	return (
		<div className="mb-2 w-full min-w-0">
			<details className="group border-l-0 pl-0">
				<summary className="flex w-full min-h-[26px] min-w-0 cursor-pointer list-none items-center gap-[5px] mx-[-3px] rounded-[var(--radius-sm)] px-[5px] py-0.5 text-[length:var(--text-sm-plus)] text-[color:var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] hover:text-[color:var(--ds-text-primary)] [&::-webkit-details-marker]:hidden">
					<span className="inline-flex shrink-0 text-[color:var(--ds-text-muted)]" aria-hidden="true">
						<Icon name="sparkles" size={14} />
					</span>
					<span className="min-w-0 truncate font-medium">{t(labelKey, { time })}</span>
					{item.toolCallCount > 0 ? (
						<span className="min-w-0 truncate text-[length:var(--text-xs)] text-[color:var(--ds-text-muted)]">
							{t("processTools", { count: item.toolCallCount })}
						</span>
					) : null}
					<span className="ml-auto grid place-items-center text-[color:var(--ds-text-muted)] opacity-65 transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] group-open:rotate-90">
						<Icon name="chevron" size={12} />
					</span>
				</summary>
				<div className="relative grid gap-0.5 pt-0.5 pb-1 pl-[18px]">
					{processBlocks.map((block, blockIndex) => (
						<TranscriptBlock key={`${block.type}:${blockIndex}`} block={block} />
					))}
					{item.messages
						.filter((message) => message.role === "tool" || Boolean(message.command) || message.role === "custom")
						.map((message) => {
							const call = message.toolCallId
								? processBlocks.find((block) => block.type === "toolCall" && block.id === message.toolCallId)
								: undefined;
							return (
								<CollapsibleTranscriptEntry
									key={message.id}
									message={message}
									previousTimestamp={previousTimestamps.get(message.id)}
									toolCall={call?.type === "toolCall" ? { name: call.name, input: call.input } : undefined}
								/>
							);
						})}
				</div>
			</details>
		</div>
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
	const { t } = useI18n();
	const isSelection = prompt.type === "select";
	return (
		<form
			className="grid gap-3.5 rounded-[var(--radius-lg)] border-[0.5px] border-[var(--ds-border-subtle)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-float)] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)] [&>select>option]:bg-[var(--surface-1)] [&>select>option]:text-[color:var(--text-dim)]"
			onSubmit={(event) => {
				event.preventDefault();
				void onSubmit(prompt.id, response);
			}}
		>
			<div className="flex items-center justify-between gap-3 [&>div>h3]:mt-1 [&>div>h3]:mb-0 [&>div>h3]:text-[length:var(--text-lg-plus)] [&>div>h3]:font-semibold [&>div>h3]:tracking-[-0.01em]">
				<div>
					<p className="m-0 text-[length:var(--text-xs)] font-medium text-[color:var(--muted)]">
						{t("modelConfig")}
					</p>
					<h3>{prompt.message}</h3>
				</div>
				<span className="font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[color:var(--muted)]">
					{prompt.type.replaceAll("_", " ")}
				</span>
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
			<Button variant="primary" type="submit" disabled={resolving}>
				{resolving ? t("processing") : t("continue")}
			</Button>
		</form>
	);
});

interface DirectoryNode {
	status: "loading" | "loaded" | "error";
	directories: DesktopWorkspaceEntry[];
	files: DesktopWorkspaceEntry[];
	error?: string;
	truncated?: boolean;
}

interface ExplorerProps {
	error: string | undefined;
	isTrusted: boolean;
	/** Bumped to reload every already-loaded directory (manual refresh, watcher events). */
	reloadSignal: number;
	/** Requests a reload of a single directory (for example after an upload). */
	directoryReload: { path: string; token: number } | undefined;
	selectedPath: string | undefined;
	workspacePath: string | undefined;
	onChooseWorkspace: () => void;
	onDownload: (path: string) => void;
	onMention: (path: string) => void;
	onOpenFile: (entry: DesktopWorkspaceEntry) => void;
	onRefresh: () => void;
	onTrustProject: () => void;
	onUpload: (files: File[], targetDirectory: string) => Promise<DesktopImportedFileResult[]>;
}

function Explorer({
	error,
	isTrusted,
	reloadSignal,
	directoryReload,
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
	const { t } = useI18n();
	const [directoryNodes, setDirectoryNodes] = useState<Record<string, DirectoryNode>>({});
	const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<DesktopWorkspaceEntry[] | undefined>();
	const [searching, setSearching] = useState(false);
	const [uploadDirectory, setUploadDirectory] = useState("");
	const [changesCollapsed, setChangesCollapsed] = useState(false);
	const [uploadStatus, setUploadStatus] = useState<
		| { state: "uploading"; count: number }
		| { state: "complete"; count: number; conflicts: number; failed: number }
		| undefined
	>();
	const [gitChanges, setGitChanges] = useState<DesktopGitChange[]>([]);
	const [gitError, setGitError] = useState<string>();

	const loadDirectory = useCallback(async (path: string): Promise<void> => {
		setDirectoryNodes((current) => ({
			...current,
			[path]: {
				status: "loading",
				directories: current[path]?.directories ?? [],
				files: current[path]?.files ?? [],
			},
		}));
		try {
			const listing = await listWorkspaceDirectory(path || undefined);
			setDirectoryNodes((current) => ({
				...current,
				[path]: {
					status: "loaded",
					directories: listing.directories,
					files: listing.files,
					...(listing.truncated ? { truncated: true } : {}),
				},
			}));
		} catch (loadError) {
			setDirectoryNodes((current) => ({
				...current,
				[path]: {
					status: "error",
					directories: [],
					files: [],
					error: loadError instanceof Error ? loadError.message : String(loadError),
				},
			}));
		}
	}, []);

	// Reset the whole tree when the workspace or trust state changes.
	useEffect(() => {
		setDirectoryNodes({});
		setExpandedDirectories(new Set());
		setUploadDirectory("");
		if (!workspacePath || !isTrusted) return;
		void loadDirectory("");
	}, [isTrusted, loadDirectory, workspacePath]);

	// Global reloads (watcher events, manual refresh) invalidate loaded directories only.
	const lastReloadSignalRef = useRef(reloadSignal);
	const directoryNodesRef = useRef(directoryNodes);
	directoryNodesRef.current = directoryNodes;
	useEffect(() => {
		if (lastReloadSignalRef.current === reloadSignal) return;
		lastReloadSignalRef.current = reloadSignal;
		if (!workspacePath || !isTrusted) return;
		for (const [path, node] of Object.entries(directoryNodesRef.current)) {
			if (node.status === "loaded" || node.status === "error") void loadDirectory(path);
		}
	}, [isTrusted, loadDirectory, reloadSignal, workspacePath]);

	// Targeted reload after uploads.
	const lastDirectoryReloadTokenRef = useRef(0);
	useEffect(() => {
		if (!directoryReload || directoryReload.token === lastDirectoryReloadTokenRef.current) return;
		lastDirectoryReloadTokenRef.current = directoryReload.token;
		void loadDirectory(directoryReload.path);
	}, [directoryReload, loadDirectory]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadSignal invalidates Git after filesystem and task events.
	useEffect(() => {
		setGitError(undefined);
		if (!workspacePath || !isTrusted) {
			setGitChanges([]);
			return;
		}
		let cancelled = false;
		void listGitChanges().then(
			(changes) => {
				if (!cancelled) setGitChanges(changes);
			},
			(error: unknown) => {
				if (!cancelled) {
					setGitChanges([]);
					setGitError(error instanceof Error ? error.message : String(error));
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [workspacePath, isTrusted, reloadSignal]);

	// Composer-style search reuses the bounded deep workspace index.
	useEffect(() => {
		const query = searchQuery.trim();
		if (!query) {
			setSearchResults(undefined);
			setSearching(false);
			return;
		}
		let active = true;
		setSearching(true);
		const timer = window.setTimeout(() => {
			void searchWorkspaceFiles(query)
				.then((entries) => {
					if (active) {
						setSearchResults(entries.filter((entry) => entry.type === "file"));
						setSearching(false);
					}
				})
				.catch(() => {
					if (active) {
						setSearchResults([]);
						setSearching(false);
					}
				});
		}, 160);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [searchQuery]);

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

	function toggleDirectory(path: string, node: DirectoryNode | undefined): void {
		setExpandedDirectories((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
		if (!node && !directoryNodes[path]) void loadDirectory(path);
	}

	async function uploadFiles(files: File[], targetDirectory: string): Promise<void> {
		if (!files.length) return;
		setUploadStatus({ state: "uploading", count: files.length });
		try {
			const results = await onUpload(files, targetDirectory);
			setUploadStatus({
				state: "complete",
				count: results.filter((item) => !item.error && !item.conflict).length,
				conflicts: results.filter((item) => item.conflict).length,
				failed: results.filter((item) => item.error && !item.conflict).length,
			});
		} catch {
			setUploadStatus({ state: "complete", count: 0, conflicts: 0, failed: files.length });
		}
	}

	function renderFileRow(entry: DesktopWorkspaceEntry, displayPath: string): ReactNode {
		const gitStatus = gitStatusByPath.get(entry.path);
		return (
			<div
				className={`group ${FILE_TREE_ROW} ${selectedPath === entry.path ? "bg-[color-mix(in_oklab,var(--ds-accent)_14%,transparent)] text-[color:var(--text)] [:root[data-accent=mono]_&]:bg-[var(--hover-strong)]" : "hover:bg-[var(--surface-3)] hover:text-[color:var(--text)]"}`}
				key={entry.path}
				style={{ "--entry-depth": entry.depth } as CSSProperties}
			>
				<Button
					variant="bare"
					className="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
					onClick={() => onOpenFile(entry)}
				>
					<span className="grid w-[13px] shrink-0 place-items-center text-[color:var(--muted)]">
						<Icon name={fileIconFor(entry.path)} size={13} />
					</span>
					<span className="min-w-0 truncate">{displayPath}</span>
				</Button>
				{gitStatus ? (
					<span
						className={`ml-auto font-[family-name:var(--font-mono)] font-semibold ${gitStatus === "added" || gitStatus === "untracked" ? "text-[color:var(--success)]" : gitStatus === "deleted" || gitStatus === "conflict" ? "text-[color:var(--danger)]" : "text-[color:var(--accent)]"}`}
					>
						{gitStatus.slice(0, 1).toUpperCase()}
					</span>
				) : null}
				<div className="hidden items-center gap-px group-hover:flex group-focus-within:flex [&>button]:grid [&>button]:size-5 [&>button]:place-items-center [&>button]:rounded-[var(--radius-3xs)] [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:font-[family-name:var(--font-mono)] [&>button]:text-[length:var(--text-xs)] [&>button]:text-[color:var(--muted)] [&>button:hover]:bg-[var(--hover-strong)] [&>button:hover]:text-[color:var(--text)]">
					<Button size="icon" title={t("mentionAria", { path: entry.path })} onClick={() => onMention(entry.path)}>
						@
					</Button>
					<Button
						size="icon"
						title={t("downloadAria", { path: entry.path })}
						onClick={() => onDownload(entry.path)}
					>
						↓
					</Button>
				</div>
			</div>
		);
	}

	function renderChangedFiles(): ReactNode {
		if (searchQuery.trim()) return null;
		if (gitError)
			return (
				<p
					className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]"
					role="alert"
				>
					{t("gitLoadFailed", { message: gitError })}
				</p>
			);
		if (gitChanges.length === 0) return null;
		return (
			<section className="mb-1.5 border-b border-[var(--border-subtle)] py-0.5 pb-1.5">
				<Button
					variant="bare"
					className="flex w-full min-h-[25px] items-center gap-[5px] rounded-[var(--radius-s)] border-0 bg-transparent px-[7px] py-0.5 text-left text-[length:var(--text-2xs)] font-semibold tracking-[0.04em] text-[color:var(--accent-strong)] uppercase hover:bg-[var(--hover)]"
					aria-expanded={!changesCollapsed}
					onClick={() => setChangesCollapsed((collapsed) => !collapsed)}
				>
					<span
						className={`grid w-3 shrink-0 place-items-center transition-transform duration-150 ${changesCollapsed ? "rotate-0" : "rotate-90"}`}
					>
						<Icon name="chevron" size={12} />
					</span>
					<span>{t("changesWithCount", { count: gitChanges.length })}</span>
				</Button>
				{!changesCollapsed
					? gitChanges.map((change) =>
							renderFileRow(
								{
									path: change.path,
									name: change.path.split("/").at(-1) ?? change.path,
									type: "file",
									depth: 0,
								},
								change.path,
							),
						)
					: null}
			</section>
		);
	}

	function renderNodeRows(path: string): ReactNode {
		const node = directoryNodes[path];
		if (!node) {
			return (
				<p
					className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
					key={`${path}:loading`}
				>
					{t("reading")}
				</p>
			);
		}
		if (node.status === "loading") {
			return (
				<p
					className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
					key={`${path}:loading`}
				>
					{t("reading")}
				</p>
			);
		}
		if (node.status === "error") {
			return (
				<div
					className="my-0.5 flex items-center gap-2 px-2.5 py-1 text-[length:var(--text-xs)] text-[color:var(--danger)] [&>span]:truncate"
					key={`${path}:error`}
				>
					<span>{node.error}</span>
					<Button size="sm" variant="outline" type="button" onClick={() => void loadDirectory(path)}>
						{t("retry")}
					</Button>
				</div>
			);
		}
		const rows: ReactNode[] = [];
		for (const entry of node.directories) {
			const expanded = expandedDirectories.has(entry.path);
			rows.push(
				<Button
					variant="bare"
					className={`relative flex w-full min-h-7 items-center gap-1.5 rounded-[var(--radius-s)] border-0 bg-transparent py-1 pr-[7px] pl-[calc(9px+var(--entry-depth)*14px)] text-left font-medium font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--text)] transition-[background,color] duration-150 hover:bg-[var(--hover)] [&>svg]:text-[color:var(--muted)] ${uploadDirectory === entry.path ? "bg-[color-mix(in_srgb,var(--accent)_12%,var(--hover))] text-[color:var(--text)] outline outline-[color-mix(in_srgb,var(--accent)_70%,transparent)] -outline-offset-1" : ""}`}
					key={entry.path}
					style={{ "--entry-depth": entry.depth } as CSSProperties}
					onDragOver={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setUploadDirectory(entry.path);
					}}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void uploadFiles(Array.from(event.dataTransfer.files), entry.path);
					}}
					onClick={() => {
						setUploadDirectory(entry.path);
						toggleDirectory(entry.path, directoryNodes[entry.path]);
					}}
				>
					<span
						className={`grid w-3 shrink-0 place-items-center transition-transform duration-150 ${expanded ? "rotate-90" : "rotate-0"}`}
					>
						<Icon name="chevron" size={12} />
					</span>
					<Icon name="folder" size={14} />
					<span>{entry.name}</span>
					{changedDirectories.has(entry.path) ? (
						<span className="ml-auto size-[5px] rounded-full bg-[var(--accent)]" />
					) : null}
				</Button>,
			);
			if (expanded) rows.push(renderNodeRows(entry.path));
		}
		for (const entry of node.files) {
			rows.push(renderFileRow(entry, entry.name));
		}
		if (node.directories.length === 0 && node.files.length === 0) {
			rows.push(
				<p
					className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
					key={`${path}:empty`}
				>
					{t("emptyDirectory")}
				</p>,
			);
		}
		if (node.truncated) {
			rows.push(
				<p
					className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
					key={`${path}:truncated`}
				>
					{t("listingTruncated")}
				</p>,
			);
		}
		return rows;
	}

	if (!workspacePath)
		return (
			<div className={SIDEBAR_EMPTY}>
				<Icon name="folder" size={22} />
				<strong>{t("openProject")}</strong>
				<p>{t("openProjectHint")}</p>
				<Button variant="outline" type="button" onClick={onChooseWorkspace}>
					{t("chooseFolder")}
				</Button>
			</div>
		);
	if (!isTrusted)
		return (
			<div className={SIDEBAR_EMPTY}>
				<span className="text-[length:var(--text-display)] leading-none">⌁</span>
				<strong>{t("fileBrowsingLocked")}</strong>
				<p>{t("trustToBrowse")}</p>
				<Button variant="outline" type="button" onClick={onTrustProject}>
					{t("trustProject")}
				</Button>
			</div>
		);
	return (
		<section
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
			aria-label={t("explorerAria")}
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				event.preventDefault();
				void uploadFiles(Array.from(event.dataTransfer.files), uploadDirectory);
			}}
		>
			<div className="mt-1 flex min-h-[34px] items-center justify-between py-1 pr-2 pl-1.5 text-[length:var(--text-md)] font-semibold tracking-[0.12em] text-[color:var(--muted)]">
				<span>{t("files")}</span>
				<label
					className="grid size-[22px] cursor-pointer place-items-center rounded-[var(--radius-2xs)] text-[color:var(--muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] [&>input]:hidden"
					title={t("uploadTo", { dir: uploadDirectory || t("rootDirectory") })}
				>
					＋
					<input
						type="file"
						multiple
						onChange={(event) => {
							void uploadFiles(Array.from(event.target.files ?? []), uploadDirectory);
							event.currentTarget.value = "";
						}}
					/>
				</label>
				<Button
					size="sm"
					className="ml-auto max-w-[112px] min-w-0 cursor-pointer truncate rounded-[var(--radius-3xs)] border-0 bg-transparent text-right font-[inherit] text-[length:var(--text-xs)] leading-[22px] text-[color:var(--muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
					title={t("uploadTargetTitle")}
					onClick={() => setUploadDirectory("")}
				>
					{uploadDirectory || t("rootDirectory")}
				</Button>
				<Button size="icon" className="compact" type="button" aria-label={t("refreshFiles")} onClick={onRefresh}>
					↻
				</Button>
			</div>
			<label className="mx-2 mb-2 flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-2 py-[5px] text-[color:var(--muted)] focus-within:border-[var(--border-strong)] focus-within:text-[color:var(--text-dim)] [&>input]:w-full [&>input]:min-w-0 [&>input]:border-0 [&>input]:bg-transparent [&>input]:p-0 [&>input]:text-[length:var(--text-xs)] [&>input]:text-[color:var(--text)] [&>input]:outline-none [&>input]:placeholder:text-[color:var(--muted)]">
				<Icon name="search" size={13} />
				<input
					type="search"
					value={searchQuery}
					placeholder={t("searchFilesPlaceholder")}
					onChange={(event) => setSearchQuery(event.target.value)}
				/>
			</label>
			{error ? (
				<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">{error}</p>
			) : null}
			{uploadStatus ? (
				<output
					className={`mx-2.5 mt-0.5 text-[length:var(--text-xs)] ${uploadStatus.state === "uploading" ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]"}`}
				>
					{uploadStatus.state === "uploading"
						? t("uploadingFiles", { count: uploadStatus.count })
						: t("uploadedFiles", {
								count: uploadStatus.count,
								conflicts: uploadStatus.conflicts,
								failed: uploadStatus.failed,
							})}
				</output>
			) : null}
			<div className="overflow-auto px-2 pb-3.5">
				{renderChangedFiles()}
				{searchResults
					? searching
						? [
								<p
									className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
									key="searching"
								>
									{t("searchingShort")}
								</p>,
							]
						: searchResults.length
							? searchResults.map((entry) => renderFileRow(entry, entry.path))
							: [
									<p
										className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]"
										key="no-match"
									>
										{t("noMatchingFiles")}
									</p>,
								]
					: renderNodeRows("")}
			</div>
		</section>
	);
}

interface FileTab {
	path: string;
	preview: DesktopWorkspaceFilePreview;
}

function Inspector({
	workspacePath,
	reloadSignal,
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
	onQuoteLines,
}: {
	workspacePath: string | undefined;
	reloadSignal: number;
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
	onQuoteLines: (path: string, start: number, end: number) => void;
}) {
	const { t } = useI18n();
	const [mode, setMode] = useState<"diff" | "preview" | "source">("source");
	const [contentQuery, setContentQuery] = useState("");
	const [wrapLines, setWrapLines] = useState(() => localStorage.getItem("pi-desktop-file-wrap") === "on");
	const [diffText, setDiffText] = useState<string>();
	const [diffLoading, setDiffLoading] = useState(false);
	const [diffError, setDiffError] = useState<string>();
	const [diffRetry, setDiffRetry] = useState(0);
	const sourceRootRef = useRef<HTMLDivElement>(null);
	const [selectedLineRange, setSelectedLineRange] = useState<{ start: number; end: number }>();
	const activeTab = tabs.find((tab) => tab.path === activeTabPath);
	const preview = activeTab?.preview;
	const isImage = preview ? preview.imageDataUrl !== undefined : false;
	const isAudio = preview ? preview.audioDataUrl !== undefined : false;
	const isPdf = preview ? preview.pdfDataUrl !== undefined : false;
	const isDocx = preview ? preview.docxHtml !== undefined : false;
	const isPreviewable = preview ? isMarkdownFile(preview.path) || isHtmlFile(preview.path) || isDocx : false;
	const previewPath = preview?.path;

	// biome-ignore lint/correctness/useExhaustiveDependencies: revisions and explicit retries reload the same file.
	useEffect(() => {
		if (mode !== "diff" || !previewPath || !workspacePath) return;
		let current = true;
		setDiffLoading(true);
		setDiffText(undefined);
		setDiffError(undefined);
		void getGitDiff(previewPath).then(
			(text) => {
				if (current) {
					setDiffText(text);
					setDiffLoading(false);
				}
			},
			(error: unknown) => {
				if (current) {
					setDiffError(error instanceof Error ? error.message : String(error));
					setDiffLoading(false);
				}
			},
		);
		return () => {
			current = false;
		};
	}, [mode, previewPath, workspacePath, reloadSignal, diffRetry]);

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
	useEffect(() => {
		const toggleWrap = () => setWrapLines((current) => !current);
		window.addEventListener("pi:file-toggle-wrap", toggleWrap);
		return () => window.removeEventListener("pi:file-toggle-wrap", toggleWrap);
	}, []);

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

	const getSelectedRange = useCallback((): { start: number; end: number } | undefined => {
		const root = sourceRootRef.current;
		const selection = window.getSelection();
		if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
		const findLine = (node: Node | null): number | undefined => {
			const element = node instanceof Element ? node : node?.parentElement;
			const line = element?.closest<HTMLElement>("[data-source-line]");
			if (!line || !root.contains(line)) return undefined;
			const value = Number(line.dataset.sourceLine);
			return Number.isInteger(value) && value > 0 ? value : undefined;
		};
		const anchor = findLine(selection.anchorNode);
		const focus = findLine(selection.focusNode);
		if (anchor === undefined || focus === undefined) return undefined;
		return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
	}, []);

	useEffect(() => {
		if (mode !== "source" || !preview || isImage || isAudio || isPdf) {
			setSelectedLineRange(undefined);
			return;
		}
		const updateRange = () => setSelectedLineRange(getSelectedRange());
		document.addEventListener("selectionchange", updateRange);
		return () => document.removeEventListener("selectionchange", updateRange);
	}, [getSelectedRange, isAudio, isImage, isPdf, mode, preview]);

	useEffect(() => {
		if (mode !== "source") return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || event.key.toLocaleLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey)) return;
			if (event.altKey || event.shiftKey) return;
			const target = event.target;
			if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
			const range = getSelectedRange();
			if (!range || !previewPath) return;
			event.preventDefault();
			onQuoteLines(previewPath, range.start, range.end);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [getSelectedRange, mode, onQuoteLines, previewPath]);

	return (
		<aside
			className="inspector flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface-1)]"
			aria-label={t("inspectorAria")}
		>
			<div className="inspector-header flex h-11 min-h-11 items-center justify-between gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3.5">
				<div className="flex min-w-0 items-center gap-2 [&>strong]:block [&>strong]:min-w-0 [&>strong]:truncate [&>strong]:text-[length:var(--text-md)] [&>strong]:font-semibold [&>strong]:text-[color:var(--text)]">
					{preview ? (
						<>
							<span className="grid shrink-0 place-items-center text-[color:var(--muted)]">
								<Icon name={fileIconFor(preview.path)} size={15} />
							</span>
							<strong title={preview.path}>{preview.path.split("/").at(-1) ?? preview.path}</strong>
							{changedHint ? (
								<Button
									size="sm"
									className="inline-flex items-center gap-[5px] rounded-full border-0 bg-[var(--success-overlay)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--success)]"
									title={t("reloadChangedHint")}
									onClick={onReloadChanged}
								>
									<span className="size-1.5 rounded-full bg-current" />
									{t("updated")}
								</Button>
							) : (
								<span className="inline-flex cursor-default items-center gap-[5px] rounded-full border-0 bg-[var(--overlay-5)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--muted)]">
									<span className="size-1.5 rounded-full bg-current" />
									Live
								</span>
							)}
							<small className="shrink-0 whitespace-nowrap text-[length:var(--text-xs)] text-[color:var(--muted)]">
								{isImage
									? getFileKindLabel(preview.path, t)
									: `${getFileKindLabel(preview.path, t)} · ${t("lines", { count: lineCount })} · ${formatByteSize(byteSize)}`}
							</small>
						</>
					) : (
						<strong>{t("noFileSelected")}</strong>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{preview && !isImage && !isAudio && !isPdf && !isDocx ? (
						<Segmented fill aria-label={t("displayModes")}>
							<Segment active={mode === "source"} onClick={() => setMode("source")}>
								{t("source")}
							</Segment>
							{isPreviewable ? (
								<Segment active={mode === "preview"} onClick={() => setMode("preview")}>
									{t("preview")}
								</Segment>
							) : null}
							<Segment active={mode === "diff"} onClick={() => setMode("diff")}>
								{t("diff")}
							</Segment>
						</Segmented>
					) : null}
					{preview && !isImage && !isAudio && !isPdf && !isDocx ? (
						<Button
							size="icon"
							className={wrapLines ? "is-active" : ""}
							type="button"
							aria-label={wrapLines ? t("disableWrap") : t("enableWrap")}
							aria-pressed={wrapLines}
							onClick={() => setWrapLines((current) => !current)}
						>
							<Icon name="wrap" size={16} />
						</Button>
					) : null}
					{preview ? (
						<Button
							size="icon"
							type="button"
							aria-label={t("copyPathAria")}
							onClick={() => onCopyPath(preview.path)}
						>
							<Icon name="copy" size={16} />
						</Button>
					) : null}
					{preview?.content ? (
						<Button
							size="icon"
							type="button"
							aria-label={t("copyContentAria")}
							onClick={() => onCopyContent(preview.content)}
						>
							<Icon name="copy" size={16} />
						</Button>
					) : null}
					{preview ? (
						<Button
							size="icon"
							type="button"
							aria-label={t("downloadFileAria")}
							onClick={() => onDownload(preview.path)}
						>
							<Icon name="doc" size={16} />
						</Button>
					) : null}
					{preview ? (
						<Button
							size="icon"
							type="button"
							aria-label={t("openWithDefaultAria")}
							onClick={() => onOpenFile(preview.path)}
						>
							<Icon name="external" size={16} />
						</Button>
					) : null}
					{preview ? (
						<Button
							size="icon"
							type="button"
							aria-label={t("revealInFinderAria")}
							onClick={() => onRevealFile(preview.path)}
						>
							<Icon name="folder" size={16} />
						</Button>
					) : null}
					<Button size="icon" type="button" aria-label={t("closePreviewAria")} onClick={onClose}>
						<Icon name="close" size={16} />
					</Button>
				</div>
			</div>
			{preview && !isImage && !isAudio && !isPdf && mode === "source" ? (
				<label className="mx-3 mb-2 flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-2 py-[5px] text-[color:var(--muted)] [&>input]:w-full [&>input]:min-w-0 [&>input]:border-0 [&>input]:bg-transparent [&>input]:text-[length:var(--text-xs)] [&>input]:text-[color:var(--text)] [&>input]:outline-none">
					<Icon name="search" size={13} />
					<input
						type="search"
						value={contentQuery}
						placeholder={t("searchContentPlaceholder")}
						onChange={(event) => setContentQuery(event.target.value)}
					/>
				</label>
			) : null}
			{selectedLineRange && previewPath && mode === "source" ? (
				<Button
					size="sm"
					className="mb-2 ml-3 mr-3 self-start cursor-pointer rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-2 py-[5px] text-[length:var(--text-xs)] text-[color:var(--text-muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onQuoteLines(previewPath, selectedLineRange.start, selectedLineRange.end)}
				>
					{t("mentionSelectedLines", { start: selectedLineRange.start, end: selectedLineRange.end })}
				</Button>
			) : null}
			{preview ? (
				isImage ? (
					<div className="grid flex-1 place-items-center overflow-auto p-4 [&>img]:max-h-full [&>img]:max-w-full [&>img]:rounded-[var(--radius-s)] [&>img]:object-contain">
						<img src={preview.imageDataUrl} alt={preview.path} />
					</div>
				) : isAudio ? (
					<div className="grid flex-1 place-items-center p-6 [&>audio]:w-full [&>audio]:max-w-[420px]">
						{/* biome-ignore lint/a11y/useMediaCaption: 音频文件预览，无字幕轨可提供 */}
						<audio
							controls
							src={preview.audioDataUrl}
							aria-label={t("audioPreviewAria", { path: preview.path })}
						/>
					</div>
				) : isPdf ? (
					<div className="flex min-h-0 flex-1 bg-[var(--surface-recessed)] p-2.5 [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:rounded-[var(--radius-s)] [&>iframe]:border [&>iframe]:border-[var(--border-subtle)] [&>iframe]:bg-white">
						<iframe src={preview.pdfDataUrl} title={t("pdfPreviewAria", { path: preview.path })} />
					</div>
				) : mode === "preview" && isPreviewable ? (
					isHtmlFile(preview.path) || isDocx ? (
						<div className="flex min-h-0 flex-1 bg-[var(--surface-recessed)] p-2.5 [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:rounded-[var(--radius-s)] [&>iframe]:border [&>iframe]:border-[var(--border-subtle)] [&>iframe]:bg-white">
							<iframe
								sandbox=""
								srcDoc={isDocx ? preview.docxHtml : preview.content}
								title={t("docPreviewAria", { kind: isDocx ? "DOCX" : "HTML", path: preview.path })}
							/>
						</div>
					) : (
						<div className="flex-1 overflow-auto px-[18px] pt-4 pb-5">
							<MarkdownBody text={preview.content} />
						</div>
					)
				) : mode === "diff" ? (
					diffLoading ? (
						<p className="px-[18px] py-6 text-[length:var(--text-sm)] text-[color:var(--muted)]">
							{t("loadingDiff")}
						</p>
					) : diffError ? (
						<div className="px-[18px] py-6 text-[length:var(--text-sm)] text-[color:var(--muted)]" role="alert">
							<p>{t("diffLoadFailed", { message: diffError })}</p>
							<Button variant="outline" type="button" onClick={() => setDiffRetry((value) => value + 1)}>
								{t("retry")}
							</Button>
						</div>
					) : diffText ? (
						<div className="file-preview-source is-diff-view overflow-auto pb-4 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] leading-[var(--leading-body)]">
							{diffText.split("\n").map((line, index) => (
								<span
									className={`source-line is-diff-line grid w-full cursor-default grid-cols-[42px_minmax(0,1fr)] border-0 bg-transparent pr-3 text-left text-[color:var(--text-dim)] select-text ${transcriptDiffLineClass(line)}`}
									key={`diff:${index}:${line}`}
								>
									<span className="pr-2.5 text-right font-[family-name:var(--font-mono)] text-[color:var(--muted)] select-none" />
									<code>{line || " "}</code>
								</span>
							))}
						</div>
					) : (
						<p className="px-[18px] py-6 text-[length:var(--text-sm)] text-[color:var(--muted)]">
							{t("noUncommittedDiff")}
						</p>
					)
				) : (
					<div
						ref={sourceRootRef}
						className={`overflow-auto pb-4 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] leading-[var(--leading-body)] ${wrapLines ? "[&_.source-line_code]:break-all [&_.source-line_code]:whitespace-pre-wrap" : ""}`}
					>
						{sourceLines.map((sourceLine) => (
							<div
								className={`grid w-full grid-cols-[42px_minmax(0,1fr)] border-0 bg-transparent pr-3 text-left text-[color:var(--text-dim)] select-text hover:bg-[var(--hover)] ${sourceLine.match ? "bg-[var(--hover)]" : ""}`}
								data-source-line={sourceLine.line}
								key={sourceLine.line}
							>
								<span className="pr-2.5 text-right font-[family-name:var(--font-mono)] text-[color:var(--muted)] select-none">
									{sourceLine.line}
								</span>
								<code>
									<HighlightedCode code={sourceLine.text || " "} language={getLanguageForPath(preview.path)} />
								</code>
							</div>
						))}
					</div>
				)
			) : (
				<div className="grid justify-items-start gap-2.5 p-[22px] text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)] [&>p]:m-0">
					<Icon name="panel" size={22} />
					<p>{t("inspectorEmptyHint")}</p>
				</div>
			)}
		</aside>
	);
}

const WindowControls = memo(function WindowControls() {
	const { t } = useI18n();
	const [maximized, setMaximized] = useState(false);
	if (navigator.userAgent.includes("Macintosh")) return null;
	return (
		<div className="ml-1 inline-flex self-stretch">
			<button
				type="button"
				className="grid w-[46px] cursor-pointer place-items-center border-0 bg-transparent text-[color:var(--text-muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-1"
				aria-label={t("minimizeWindow")}
				onClick={() => void minimizeWindow()}
			>
				<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
					<path d="M0 5h10" />
				</svg>
			</button>
			<button
				type="button"
				className="grid w-[46px] cursor-pointer place-items-center border-0 bg-transparent text-[color:var(--text-muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-1"
				aria-label={maximized ? t("restoreWindow") : t("maximizeWindow")}
				onClick={() => void toggleWindowMaximize().then(setMaximized)}
			>
				{maximized ? (
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
						<rect x="2" y="0.5" width="7.5" height="7.5" />
						<path d="M0.5 2.5v7h7" />
					</svg>
				) : (
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
						<rect x="0.5" y="0.5" width="9" height="9" />
					</svg>
				)}
			</button>
			<button
				type="button"
				className="grid w-[46px] cursor-pointer place-items-center border-0 bg-transparent text-[color:var(--text-muted)] hover:bg-[var(--ds-error)] hover:text-[color:var(--gray-0)] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-1"
				aria-label={t("closeWindow")}
				onClick={() => void closeWindow()}
			>
				<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
					<path d="m0 0 10 10M10 0 0 10" />
				</svg>
			</button>
		</div>
	);
});

export function App() {
	const snapshot = useSyncExternalStore(subscribeDesktopSnapshot, getDesktopSnapshot, getDesktopSnapshot);
	const startupError = getDesktopStartupError();
	const { t } = useI18n();
	const compactComposerControls = useSyncExternalStore(
		subscribeCompactComposer,
		getCompactComposerSnapshot,
		() => false,
	);
	const { play: playCompletionTone, unlock: unlockCompletionAudio } = useCompletionAudio();
	const [themeFollowsSystem, setThemeFollowsSystem] = useState(
		() => localStorage.getItem("pi-desktop-theme") !== "light" && localStorage.getItem("pi-desktop-theme") !== "dark",
	);
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const stored = localStorage.getItem("pi-desktop-theme");
		return stored === "light" || stored === "dark"
			? stored
			: window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
	});
	const [accent, setAccent] = useState<AppAccent>(() => {
		const stored = localStorage.getItem("pi-desktop-accent");
		return isAppAccent(stored) ? stored : "mono";
	});
	const [sidebarWidth, setSidebarWidth] = useState(
		() => Number(localStorage.getItem("pi-desktop-sidebar-width")) || 275,
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

	const [branchMenuOpen, setBranchMenuOpen] = useState(false);
	const [sessionMenuOpen, setSessionMenuOpen] = useState<string>();
	const [deleteSessionPath, setDeleteSessionPath] = useState<string>();
	const [moreMenuOpen, setMoreMenuOpen] = useState(false);
	const [terminalOpen, setTerminalOpen] = useState(false);
	const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
	const permissionMode = snapshot.session?.permissionMode ?? "ask";
	const permissionRiskSessionRef = useRef<string | undefined>(undefined);

	const [openWithMenuOpen, setOpenWithMenuOpen] = useState(false);
	const [openWithApps, setOpenWithApps] = useState<DesktopOpenWithApp[]>([]);
	const [openWithAppId, setOpenWithAppId] = useState(() => localStorage.getItem("pi-desktop-open-with") ?? "finder");
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
	const [submittingSessionIds, setSubmittingSessionIds] = useState<Set<string>>(new Set());
	const submittingSessionsRef = useRef(new Set<string>());
	const [aborting, setAborting] = useState(false);
	const [allowingPermission, setAllowingPermission] = useState(false);
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
		targetDirectory: string;
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
	// Installed apps are machine-specific, so the catalog is resolved once at startup.
	useEffect(() => {
		void getOpenWithApps().then(setOpenWithApps, () => setOpenWithApps([]));
	}, []);

	const openWith = useCallback(
		async (appId: string): Promise<void> => {
			setOpenWithMenuOpen(false);
			try {
				await openWorkspaceWith(appId);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice],
	);

	const applyPermissionMode = useCallback(
		async (mode: DesktopPermissionMode, sessionId = snapshot.session?.id): Promise<void> => {
			if (!sessionId) return;
			try {
				await setPermissionMode(sessionId, mode);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice, snapshot.session?.id],
	);

	const handlePermissionChange = useCallback(
		async (mode: DesktopPermissionMode): Promise<void> => {
			/*
			 * Full access is the one mode that removes the per-call confirmation
			 * step, so the risk is acknowledged in a dialog before the host policy
			 * moves. The choice applies only to the originating session.
			 */
			if (mode === "full" && permissionMode !== "full") {
				setComposerMenu(undefined);
				permissionRiskSessionRef.current = snapshot.session?.id;
				setPermissionRiskOpen(true);
				return;
			}
			await applyPermissionMode(mode);
		},
		[applyPermissionMode, permissionMode, snapshot.session?.id],
	);

	const handleToggleOpenWithMenu = useCallback((): void => {
		setMoreMenuOpen(false);
		setTopPanel(undefined);
		setOpenWithMenuOpen((current) => !current);
	}, []);

	const [workspaceEntries, setWorkspaceEntries] = useState<DesktopWorkspaceEntry[]>([]);
	const [mentionEntries, setMentionEntries] = useState<DesktopWorkspaceEntry[]>([]);
	const [gitWorktrees, setGitWorktrees] = useState<DesktopGitWorktree[]>([]);
	const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | undefined>();
	const [fileExplorerError, setFileExplorerError] = useState<string>();
	const [explorerReloadSignal, setExplorerReloadSignal] = useState(0);
	const [explorerDirectoryReload, setExplorerDirectoryReload] = useState<{ path: string; token: number }>();
	const explorerDirectoryReloadTokenRef = useRef(0);
	const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem("pi-desktop-inspector-open") === "on");
	const [fileActionsMenuOpen, setFileActionsMenuOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [hoverCard, setHoverCard] = useState<
		| { kind: "project"; root: string; count: number; top: number; left: number }
		| { kind: "session"; title: string; timestamp: number; top: number; left: number }
	>();
	const hoverCloseTimer = useRef<number | undefined>(undefined);
	const clearHoverClose = useCallback(() => {
		if (hoverCloseTimer.current !== undefined) window.clearTimeout(hoverCloseTimer.current);
		hoverCloseTimer.current = undefined;
	}, []);
	const scheduleHoverClose = useCallback(() => {
		clearHoverClose();
		hoverCloseTimer.current = window.setTimeout(() => setHoverCard(undefined), 180);
	}, [clearHoverClose]);
	const [isOnline, setIsOnline] = useState(() => navigator.onLine);
	const [configModal, setConfigModal] = useState<ConfigModal | undefined>();
	const [topPanel, setTopPanel] = useState<"branches" | "session" | "system" | undefined>();
	const [namingState, setNamingState] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [searchOpen, setSearchOpen] = useState(false);
	const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
	const [projectsInitialized, setProjectsInitialized] = useState(false);
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
	const [archivedProjectRoots, setArchivedProjectRoots] = useState<Set<string>>(() => {
		try {
			const value: unknown = JSON.parse(localStorage.getItem("pi-desktop-archived-projects") ?? "[]");
			return new Set(Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [pinnedProjectRoots, setPinnedProjectRoots] = useState<Set<string>>(() =>
		readStoredStringSet("pi-desktop-pinned-projects"),
	);
	const [archivedChatRoots, setArchivedChatRoots] = useState<Set<string>>(() =>
		readStoredStringSet("pi-desktop-archived-chats"),
	);
	const [projectProfiles, setProjectProfiles] = useState<Record<string, ProjectProfile>>(() =>
		readStoredProjectProfiles(),
	);
	const [projectSections, setProjectSections] = useState<ProjectSections>(() => readStoredProjectSections());
	const [editingProjectRoot, setEditingProjectRoot] = useState<string>();
	const [openProjectSection, setOpenProjectSection] = useState<string>();
	const [pendingSectionRoot, setPendingSectionRoot] = useState<string>();
	const [sectionNameDraft, setSectionNameDraft] = useState("");
	const [permissionRiskOpen, setPermissionRiskOpen] = useState(false);
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem("pi-desktop-unread-sessions") ?? "[]");
			return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [composerMenu, setComposerMenu] = useState<
		"project" | "model" | "thinking" | "tools" | "permission" | undefined
	>();
	const [composerControlsOpen, setComposerControlsOpen] = useState(false);
	const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
	const [historyActiveIndex, setHistoryActiveIndex] = useState(-1);
	const [projectFilter, setProjectFilter] = useState("");
	const [compacting, setCompacting] = useState(false);
	const [compactError, setCompactError] = useState<string>();
	const [automaticThinkingModelKey, setAutomaticThinkingModelKey] = useState<string>();
	const [suggestionIndex, setSuggestionIndex] = useState(0);
	const fileRequestId = useRef(0);
	const fileOpenRequestId = useRef(0);
	const chatScrollRef = useRef<HTMLDivElement>(null);
	const earlierMessagesSentinelRef = useRef<HTMLDivElement>(null);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const loadingEarlierMessagesRef = useRef(false);
	const stickToBottomRef = useRef(true);
	const previousMessageSignatureRef = useRef("");
	const previousSessionIdRef = useRef<string | undefined>(undefined);
	const lastScrollPersistAtRef = useRef(0);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const composerEditorRef = useRef<HTMLDivElement>(null);
	const composerControlsRef = useRef<HTMLDivElement>(null);
	const composingRef = useRef(false);
	const promptHistoryRef = useRef<string[]>([]);
	const promptHistoryIndexRef = useRef(-1);
	const selectedSessionReferenceLabelsRef = useRef(new Set<string>());
	const draftBeforeHistoryRef = useRef("");
	const hydratedDraftKeyRef = useRef<string | undefined>(undefined);
	const extensionEditorRequestRef = useRef<number | undefined>(undefined);
	const previousPhaseRef = useRef<{ id: string; phase: DesktopSessionPhase } | undefined>(undefined);
	const previousSessionPhasesRef = useRef<Map<string, DesktopSessionPhase | undefined>>(new Map());
	const soundedExtensionDialogIdRef = useRef<string | undefined>(undefined);
	const restorationAttemptedRef = useRef(false);
	const apiKeyProviderIds = snapshot.apiKeyProviders.map((provider) => provider.id).join("\u0000");
	const authenticationPrompt = snapshot.pendingAuthenticationPrompts[0];
	const session = snapshot.session;
	const currentThinkingModelKey =
		session?.id && session.model
			? `${session.id}\u0000${getModelKey(session.model.provider, session.model.id)}`
			: undefined;
	const usingAutomaticThinkingLevel =
		automaticThinkingModelKey !== undefined && automaticThinkingModelKey === currentThinkingModelKey;
	const activeModel = useMemo<DesktopModel | undefined>(
		() =>
			snapshot.availableModels.find(
				(model) => model.provider === session?.model?.provider && model.id === session?.model?.id,
			),
		[snapshot.availableModels, session?.model?.id, session?.model?.provider],
	);
	const selectedThinkingLevel: DesktopThinkingLevel = usingAutomaticThinkingLevel
		? "auto"
		: (session?.thinkingLevel ?? "auto");
	const thinkingLevels = useMemo(
		() => getComposerThinkingLevels(session?.availableThinkingLevels),
		[session?.availableThinkingLevels],
	);
	const thinkingLabel = getThinkingDisplayLabel(selectedThinkingLevel, activeModel?.thinkingLevelMap);
	// The persisted choice is only honoured while that app is still installed.
	const selectedOpenWith = openWithApps.find((app) => app.id === openWithAppId) ?? openWithApps[0];

	const composerBranch = (() => {
		const root = snapshot.workspacePath?.replace(/[\\/]+$/u, "");
		if (!root) return undefined;
		return gitWorktrees.find((tree) => tree.path.replace(/[\\/]+$/u, "") === root)?.branch;
	})();

	const extensionStatusLine = useMemo(
		() => formatExtensionStatusLine(snapshot.extensionStatuses ?? []),
		[snapshot.extensionStatuses],
	);
	const plainExtensionStatusLine = useMemo(
		() => getPlainExtensionStatusLine(extensionStatusLine),
		[extensionStatusLine],
	);
	const activeFileTab = useMemo(() => fileTabs.find((tab) => tab.path === activeTabPath), [activeTabPath, fileTabs]);
	const toolPreset = useMemo<"none" | "default" | "full">(() => {
		const toolNames = session?.activeToolNames ?? ["read", "bash", "edit", "write"];
		if (toolNames.length === 0) return "none";
		const activeNames = new Set(toolNames);
		return ["grep", "find", "ls"].every((name) => activeNames.has(name)) ? "full" : "default";
	}, [session?.activeToolNames]);
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
	const submitting = !!session?.id && submittingSessionIds.has(session.id);
	const draftKey = `${DRAFT_STORAGE_PREFIX}${session?.id ?? snapshot.workspacePath ?? "new"}`;
	const lastMessage = session?.messages.at(-1);
	const messageSignature = `${session?.id ?? ""}:${session?.messages.length ?? 0}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}`;
	const firstUserText = session?.messages.find((message) => message.role === "user")?.text.trim() ?? "";
	const topBarTitle =
		session?.name ??
		(firstUserText ? (firstUserText.length > 40 ? `${firstUserText.slice(0, 40)}…` : firstUserText) : t("newTask"));
	const topBarSubtitle = snapshot.workspacePath
		? (snapshot.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? snapshot.workspacePath)
		: (snapshot.userHomeName ?? "Pi");
	const stats = snapshot.sessionStats;
	const compactionHint = (() => {
		const compaction = session?.lastCompaction;
		if (!compaction) return undefined;
		const saved = compaction.tokensAfter !== undefined ? compaction.tokensBefore - compaction.tokensAfter : undefined;
		const tokens =
			compaction.tokensAfter !== undefined
				? `${formatCompact(compaction.tokensBefore)}k → ${formatCompact(compaction.tokensAfter)}k`
				: `${formatCompact(compaction.tokensBefore)}k`;
		const savedLabel =
			saved !== undefined && saved > 0 ? t("compactionSavedShort", { saved: formatCompact(saved) }) : "";
		return [compaction.reason, tokens, savedLabel].filter(Boolean).join(" · ");
	})();
	const filteredModels = (() => {
		const query = modelFilter.trim().toLocaleLowerCase();
		if (!query) return snapshot.availableModels;
		return snapshot.availableModels.filter(
			(model) =>
				model.id.toLocaleLowerCase().includes(query) ||
				model.name.toLocaleLowerCase().includes(query) ||
				model.provider.toLocaleLowerCase().includes(query),
		);
	})();
	const filteredModelsByProvider = useMemo(() => {
		const groups = new Map<string, typeof filteredModels>();
		for (const model of filteredModels) {
			const current = groups.get(model.provider);
			if (current) current.push(model);
			else groups.set(model.provider, [model]);
		}
		return [...groups.entries()];
	}, [filteredModels]);
	const statsSummary = (() => {
		if (!stats || stats.tokens.total === 0) return undefined;
		const parts = [`↑${formatCompact(stats.tokens.input)}`, `↓${formatCompact(stats.tokens.output)}`];
		if (stats.cost > 0) parts.push(stats.cost >= 0.01 ? `$${stats.cost.toFixed(2)}` : "<$0.01");
		if (stats.contextUsage?.percent !== null && stats.contextUsage?.percent !== undefined)
			parts.push(`${stats.contextUsage.percent.toFixed(1)}% ctx`);
		return parts.join(" · ");
	})();
	const transcriptItems = useMemo(() => partitionTranscript(session?.messages ?? []), [session?.messages]);
	const hasUserMessage = Boolean(session?.messages.some((message) => message.role === "user"));
	const isSessionEmpty = !session?.messages.length;
	const modelScopeNotice = (() => {
		const scope = snapshot.modelScope;
		if (!scope) return undefined;
		const parts = [...scope.warnings];
		if (scope.matched === 0) parts.push(t("modelScopeUnmatched"));
		return parts.length ? parts.join(" ") : undefined;
	})();
	const scopedThinkingFixed = (() => {
		const scope = snapshot.modelScope;
		const model = session?.model;
		if (!scope || !model) return undefined;
		return scope.fixedLevels.find((entry) => entry.provider === model.provider && entry.modelId === model.id)?.level;
	})();
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
	const canChangeToolPreset = !!session && session.phase !== "running" && snapshot.projectTrusted;
	const slashMatch = draft.match(/^\s*\/([^\s]*)$/u);
	const slashActive = slashMatch !== null;
	const slashQuery = slashMatch?.[1]?.toLocaleLowerCase() ?? "";
	const slashCommands = [
		{ name: "compact", description: t("cmdCompact"), category: t("categorySession") },
		{ name: "name", description: t("cmdName"), category: t("categorySession") },
		{ name: "copy", description: t("cmdCopy"), category: t("categorySession") },
		{ name: "session", description: t("cmdSession"), category: t("categorySession") },
		{ name: "reload", description: t("cmdReload"), category: t("categorySession") },
		{ name: "help", description: t("cmdHelp"), category: t("categoryHelp") },
		{ name: "model", description: t("cmdModel"), category: t("categoryModels") },
		{ name: "login", description: t("cmdLogin"), category: t("categoryModels") },
		{ name: "project", description: t("cmdProject"), category: t("categoryProject") },
		{ name: "files", description: t("cmdFiles"), category: t("categoryProject") },
		{ name: "settings", description: t("cmdSettings"), category: t("categorySettings") },
		{ name: "skills", description: t("cmdSkills"), category: t("categoryExtensions") },
		{ name: "plugins", description: t("cmdPlugins"), category: t("categoryExtensions") },
		{ name: "trust", description: t("cmdTrust"), category: t("categorySecurity") },
		...snapshot.skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			category: t("categorySkills"),
		})),
		...snapshot.plugins.flatMap((plugin) =>
			plugin.commands.map((command) => ({
				name: command,
				description: t("pluginCommand", { name: plugin.name }),
				category: t("categoryPlugins"),
			})),
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
		toggleTerminal: (): void => undefined,
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
				composerControlsOpen ||
				historyMenuOpen ||
				projectMenuOpen ||
				sessionMenuOpen ||
				deleteSessionPath ||
				moreMenuOpen ||
				fileActionsMenuOpen ||
				projectRowMenuOpen,
		),
		running: session?.phase === "running",
		newSession: handleNewSession,
		toggleTerminal: handleToggleTerminal,
		abort: handleAbort,
	};
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isComposingInput(event, composingRef.current)) return;
			const target = event.target instanceof Element ? event.target : undefined;
			const command = appShortcutFor(
				event,
				Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')),
				Boolean(target?.closest(".xterm")),
			);
			if (!command) return;
			event.preventDefault();
			if (command === "search") setSearchOpen((open) => !open);
			else if (command === "focusComposer") promptRef.current?.focus();
			else if (command === "newSession") void shortcutStateRef.current.newSession();
			else if (command === "toggleTerminal") shortcutStateRef.current.toggleTerminal();
		};
		window.addEventListener("keydown", onKeyDown);
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || isComposingInput(event, composingRef.current)) return;
			if (
				document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') ||
				(event.target instanceof Element && event.target.closest(".xterm"))
			)
				return;
			const shortcutState = shortcutStateRef.current;
			setMenusDismissed(true);
			setComposerMenu(undefined);
			setComposerControlsOpen(false);
			setHistoryMenuOpen(false);
			setTopPanel(undefined);
			close();
			setSessionMenuOpen(undefined);
			setMoreMenuOpen(false);
			setFileActionsMenuOpen(false);
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
		if (composerMenu !== "project") setProjectFilter("");
		if (composerMenu !== "model") setModelFilter("");
	}, [composerMenu]);
	useEffect(() => {
		if (!compactComposerControls) setComposerControlsOpen(false);
	}, [compactComposerControls]);
	useEffect(() => {
		if (!composerMenu && !historyMenuOpen && !composerControlsOpen) return;
		const closeComposerControls = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (!composerControlsRef.current?.contains(target)) {
				setComposerMenu(undefined);
				setComposerControlsOpen(false);
			}
			if (!composerEditorRef.current?.contains(target)) setHistoryMenuOpen(false);
		};
		document.addEventListener("mousedown", closeComposerControls);
		return () => document.removeEventListener("mousedown", closeComposerControls);
	}, [composerControlsOpen, composerMenu, historyMenuOpen]);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		if (themeFollowsSystem) {
			localStorage.removeItem("pi-desktop-theme");
			return;
		}
		localStorage.setItem("pi-desktop-theme", theme);
	}, [theme, themeFollowsSystem]);
	useEffect(() => {
		document.documentElement.dataset.accent = accent;
		localStorage.setItem("pi-desktop-accent", accent);
	}, [accent]);

	useEffect(() => {
		if (!themeFollowsSystem) return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const updateTheme = () => setTheme(media.matches ? "dark" : "light");
		updateTheme();
		media.addEventListener("change", updateTheme);
		return () => media.removeEventListener("change", updateTheme);
	}, [themeFollowsSystem]);
	useEffect(() => {
		if (
			!projectMenuOpen &&
			!branchMenuOpen &&
			!sessionMenuOpen &&
			!moreMenuOpen &&
			!settingsMenuOpen &&
			!fileActionsMenuOpen &&
			!projectRowMenuOpen
		)
			return;
		const close = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				setProjectMenuOpen(false);
				setBranchMenuOpen(false);
				setSessionMenuOpen(undefined);
				setDeleteSessionPath(undefined);
				setMoreMenuOpen(false);
				setSettingsMenuOpen(false);
				setFileActionsMenuOpen(false);
				setProjectRowMenuOpen(undefined);
				return;
			}
			if (!target.closest(".project-menu-root")) {
				setProjectMenuOpen(false);
				setBranchMenuOpen(false);
				setProjectRowMenuOpen(undefined);
			}
			if (!target.closest(".session-row-wrap")) setSessionMenuOpen(undefined);
			if (!target.closest(".top-bar-more-wrap")) setMoreMenuOpen(false);
			if (!target.closest(".footer-menu-wrap")) setSettingsMenuOpen(false);
			if (!target.closest(".file-actions-menu-anchor")) setFileActionsMenuOpen(false);
			if (!target.closest(".top-bar")) setTopPanel(undefined);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [
		projectMenuOpen,
		branchMenuOpen,
		sessionMenuOpen,
		moreMenuOpen,
		settingsMenuOpen,
		fileActionsMenuOpen,
		projectRowMenuOpen,
	]);
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
		localStorage.setItem("pi-desktop-pinned-projects", JSON.stringify([...pinnedProjectRoots]));
	}, [pinnedProjectRoots]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-archived-chats", JSON.stringify([...archivedChatRoots]));
	}, [archivedChatRoots]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-project-profiles", JSON.stringify(projectProfiles));
	}, [projectProfiles]);
	useEffect(() => {
		localStorage.setItem("pi-desktop-project-sections", JSON.stringify(projectSections));
	}, [projectSections]);
	useEffect(() => {
		if (projectsInitialized || snapshot.sessions.length === 0) return;
		setCollapsedProjects(
			new Set(snapshot.sessions.map((item) => (item.projectRoot ?? item.cwd).replace(/[\\/]+$/, ""))),
		);
		setProjectsInitialized(true);
	}, [projectsInitialized, snapshot.sessions]);
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
				for (const item of completed) void notifyComplete(sessionTitle(item, t), true);
			}
		}
	}, [notifyOnComplete, session?.id, snapshot.sessions, t]);
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
		if (
			previousPhaseRef.current?.id === session?.id &&
			previousPhaseRef.current?.phase === "running" &&
			phase === "idle"
		) {
			setExplorerReloadSignal((value) => value + 1);
			if (soundOnComplete) playCompletionTone();
			if (notifyOnComplete && !document.hasFocus()) void notifyComplete(session?.name);
		}
		previousPhaseRef.current = session?.id && phase ? { id: session.id, phase } : undefined;
	}, [notifyOnComplete, playCompletionTone, session?.id, session?.name, session?.phase, soundOnComplete]);
	useEffect(() => {
		if (!extensionDialog || extensionDialogSessionId !== session?.id) return;
		if (soundedExtensionDialogIdRef.current === extensionDialog.id) return;
		soundedExtensionDialogIdRef.current = extensionDialog.id;
		if (soundOnComplete) playCompletionTone();
	}, [extensionDialog, extensionDialogSessionId, playCompletionTone, session?.id, soundOnComplete]);
	useEffect(() => {
		const scroll = chatScrollRef.current;
		if (!scroll) return;
		if (previousSessionIdRef.current !== session?.id) {
			if (previousSessionIdRef.current) {
				writeScrollPosition(previousSessionIdRef.current, { scrollTop: scroll.scrollTop, visibleItemCount });
			}
			previousSessionIdRef.current = session?.id;
			previousMessageSignatureRef.current = messageSignature;
			const remembered = session?.id ? readScrollPosition(session.id) : undefined;
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
		try {
			const listing = await listWorkspaceDirectory("");
			if (requestId === fileRequestId.current) {
				setWorkspaceEntries([...listing.directories, ...listing.files]);
			}
		} catch {
			if (requestId === fileRequestId.current) setWorkspaceEntries([]);
		}
	}, []);

	useEffect(() => {
		fileRequestId.current += 1;
		fileOpenRequestId.current += 1;
		setWorkspaceEntries([]);
		setFileTabs([]);
		setActiveTabPath(undefined);
		setFileExplorerError(undefined);
		setExplorerDirectoryReload(undefined);
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
	}, [fileTreeOpen, inspectorOpen]);
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
		let active = true;
		let previewRevision = 0;
		const unsubscribeChanges = onWorkspaceChanged((changes) => {
			if (!snapshot.projectTrusted || !snapshot.workspacePath) return;
			void refreshWorkspaceFiles();
			setExplorerReloadSignal((value) => value + 1);
			if (activeTabPath && changes.some((change) => change.path === activeTabPath)) {
				const workspacePath = snapshot.workspacePath;
				const requestId = ++previewRevision;
				void readWorkspaceFile(activeTabPath)
					.then((preview) => {
						if (!active || requestId !== previewRevision || getDesktopSnapshot().workspacePath !== workspacePath)
							return;
						setFileTabs((tabs) =>
							tabs.map((tab) => (tab.path === preview.path ? { path: preview.path, preview } : tab)),
						);
						setChangedFileHint(false);
					})
					.catch(() => {
						if (active && requestId === previewRevision && getDesktopSnapshot().workspacePath === workspacePath)
							setChangedFileHint(true);
					});
			}
		});
		return () => {
			active = false;
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
				const now = Date.now();
				if (isAway && now - lastScrollPersistAtRef.current > 1500) {
					lastScrollPersistAtRef.current = now;
					writeScrollPosition(session.id, { scrollTop: scroll.scrollTop, visibleItemCount });
				}
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
		setOpeningWorkspace(true);
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
		setAttachments([]);
		setDraft("");
	}

	function markSubmitting(sessionId: string | undefined, busy: boolean): void {
		if (!sessionId) return;
		if (busy) submittingSessionsRef.current.add(sessionId);
		else submittingSessionsRef.current.delete(sessionId);
		setSubmittingSessionIds(new Set(submittingSessionsRef.current));
	}

	async function handleSubmit(event?: FormEvent<HTMLFormElement>, behavior?: "steer" | "followUp"): Promise<void> {
		event?.preventDefault();
		if (!canSubmit) return;
		unlockCompletionAudio();
		const submissionSessionId = session?.id;
		if (!submissionSessionId || submittingSessionsRef.current.has(submissionSessionId)) return;
		const submissionDraftKey = draftKey;
		rememberPrompt(draft);
		if (draft.trim().startsWith("/") && (await handleDesktopSlashCommand(draft))) {
			localStorage.removeItem(submissionDraftKey);
			if (getDesktopSnapshot().session?.id === submissionSessionId) setDraft("");
			return;
		}
		if (draft.startsWith("!") && !draft.startsWith("!!")) {
			const command = draft.slice(1).trim();
			if (command) {
				markSubmitting(submissionSessionId, true);
				setActionError(undefined);
				try {
					const output = await executeBashCommand(command, false);
					pushNotice("success", output ? output.slice(0, 300) : t("commandDone"));
					clearSubmittedComposer(submissionSessionId, submissionDraftKey);
				} catch (error) {
					pushNotice("error", error instanceof Error ? error.message : String(error));
				} finally {
					markSubmitting(submissionSessionId, false);
				}
			}
			return;
		}
		if (draft.startsWith("!!")) {
			const command = draft.slice(2).trim();
			if (command) {
				markSubmitting(submissionSessionId, true);
				setActionError(undefined);
				try {
					const output = await executeBashCommand(command, true);
					pushNotice("success", output ? output.slice(0, 300) : t("commandDoneNoContext"));
					clearSubmittedComposer(submissionSessionId, submissionDraftKey);
				} catch (error) {
					pushNotice("error", error instanceof Error ? error.message : String(error));
				} finally {
					markSubmitting(submissionSessionId, false);
				}
			}
			return;
		}
		if (getDesktopSnapshot().session?.id !== submissionSessionId) return;
		if (session?.phase === "running" && attachments.length > 0) {
			setActionError(t("noImagesWhileRunning"));
			return;
		}
		markSubmitting(submissionSessionId, true);
		setActionError(undefined);
		try {
			await submitPrompt(
				submissionSessionId,
				draft,
				attachments.map((attachment) => attachment.id),
				behavior ?? (session?.phase === "running" ? "steer" : undefined),
				[...selectedSessionReferenceLabelsRef.current],
			);
			clearSubmittedComposer(submissionSessionId, submissionDraftKey);
		} catch (error) {
			if (getDesktopSnapshot().session?.id === submissionSessionId) {
				setActionError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			markSubmitting(submissionSessionId, false);
		}
	}

	async function handleAbort(): Promise<void> {
		if ((session?.phase !== "running" && !compacting) || aborting) return;
		setAborting(true);
		setActionError(undefined);
		try {
			if (session?.id) await abortSession(session.id);
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

	/*
	 * The integrated terminal runs a shell in the project root, which the host
	 * allows only for a trusted project. Asking for trust here keeps that policy
	 * from surfacing as a raw IPC error inside the panel.
	 */
	function handleToggleTerminal(): void {
		if (terminalOpen) {
			setTerminalOpen(false);
			return;
		}
		if (!snapshot.projectTrusted) {
			pushNotice("warning", t("terminalNeedsTrust"));
			setTrustDialogOpen(true);
			return;
		}
		setTerminalOpen(true);
	}

	function confirmPermissionRisk(): void {
		setPermissionRiskOpen(false);
		if (permissionRiskSessionRef.current) void applyPermissionMode("full", permissionRiskSessionRef.current);
		permissionRiskSessionRef.current = undefined;
	}

	const blockedApproval = snapshot.pendingToolApprovals.find(
		(approval) => approval.sessionId === session?.id && !permitsTool(permissionMode, approval.toolName),
	);
	const deniedTool = blockedApproval ? undefined : lastDeniedTool(session?.messages);
	const promptTool = blockedApproval?.toolName ?? deniedTool;
	const promptAction = promptTool ? permissionActionFor(promptTool) : undefined;
	const neededMode = promptAction ? permissionNeededFor(promptAction) : undefined;
	const permissionPrompt =
		promptTool && promptAction && neededMode && permissionMode !== neededMode && permissionMode !== "full"
			? {
					mode: neededMode,
					text: t(blockedApproval ? "permissionBlockedHint" : "permissionDeniedHint", {
						current: t(PERMISSION_LABELS[permissionMode]),
						needed: t(PERMISSION_LABELS[neededMode]),
						action:
							promptAction === "tool"
								? t("permissionActionTool", { tool: promptTool })
								: t(
										promptAction === "command"
											? "permissionActionCommand"
											: promptAction === "edit"
												? "permissionActionEdit"
												: "permissionActionRead",
									),
					}),
				}
			: undefined;

	async function allowBlockedPermission(): Promise<void> {
		if (!permissionPrompt || allowingPermission) return;
		setAllowingPermission(true);
		setActionError(undefined);
		try {
			await handlePermissionChange(permissionPrompt.mode);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setAllowingPermission(false);
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
			setAutomaticThinkingModelKey(undefined);
			pushNotice("success", t("modelSwitched", { id: modelId }));
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setSettingModel(false);
		}
	}

	async function handleChangeThinking(
		level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	): Promise<void> {
		if (!session || session.phase === "running") return;
		setComposerMenu(undefined);
		if (level === "auto") {
			setAutomaticThinkingModelKey(currentThinkingModelKey);
			return;
		}
		const wasAutomatic = usingAutomaticThinkingLevel;
		setAutomaticThinkingModelKey(undefined);
		if (session.thinkingLevel === level && !wasAutomatic) return;
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
			pushNotice("success", t("compactionDone"));
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
			pushNotice("success", t("compactionDone"));
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
			pushNotice("success", t("sessionRenamed"));
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
			const deletedId = snapshot.sessions.find((item) => item.path === sessionPath)?.id;
			if (deletedId) forgetScrollPosition(deletedId);
			await deleteSession(sessionPath);
			setDeleteSessionPath(undefined);
			pushNotice("success", t("sessionDeleted"));
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
	}

	async function handleToolPresetChange(next: "none" | "default" | "full"): Promise<void> {
		if (!canChangeToolPreset) return;
		try {
			await updateToolPreset(next);
			setComposerMenu(undefined);
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
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
				pushNotice("warning", t("maxImages", { count: MAX_IMAGE_ATTACHMENTS }));
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
				const ok = results.filter((item) => !item.error && !item.conflict);
				const conflicts = results.filter((item) => item.conflict);
				const failed = results.filter((item) => item.error && !item.conflict);
				if (ok.length) {
					const mention = ok.map((item) => `@${item.name}`).join(" ");
					setDraft((current) => (current ? `${current} ${mention}` : `${mention} `));
					promptRef.current?.focus();
					pushNotice("success", t("importedToRoot", { count: ok.length }));
				}
				if (conflicts.length) {
					const names = new Set(conflicts.map((item) => item.name));
					setPendingFileConflicts({
						files: others.filter((file) => names.has(file.name)),
						names: [...names],
						mentionAfterImport: true,
						targetDirectory: "",
					});
				}
				for (const item of failed) {
					pushNotice("warning", t("importFailed", { name: item.name, error: item.error ?? t("unknown") }));
				}
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		} else if (others.length) {
			pushNotice("warning", t("trustBeforeImport"));
		}
	}

	const handleImportWorkspaceFiles = useCallback(
		async (files: File[], targetDirectory = ""): Promise<DesktopImportedFileResult[]> => {
			if (!files.length) return [];
			try {
				const results = await importDroppedFiles(files, false, targetDirectory);
				const imported = results.filter((item) => !item.error && !item.conflict);
				const conflicts = results.filter((item) => item.conflict);
				const failed = results.filter((item) => item.error && !item.conflict);
				if (imported.length) {
					void refreshWorkspaceFiles();
					setExplorerDirectoryReload({ path: targetDirectory, token: ++explorerDirectoryReloadTokenRef.current });
					pushNotice(
						"success",
						t("uploadedTo", { count: imported.length, dir: targetDirectory || t("rootDirectory") }),
					);
				}
				if (conflicts.length) {
					const names = new Set(conflicts.map((item) => item.name));
					setPendingFileConflicts({
						files: files.filter((file) => names.has(file.name)),
						names: [...names],
						mentionAfterImport: false,
						targetDirectory,
					});
				}
				for (const item of failed)
					pushNotice("warning", t("itemError", { name: item.name, error: item.error ?? t("unknown") }));
				return results;
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
				return [];
			}
		},
		[pushNotice, refreshWorkspaceFiles, t],
	);

	async function handleFileConflictDecision(replace: boolean): Promise<void> {
		const pending = pendingFileConflicts;
		setPendingFileConflicts(undefined);
		if (!pending || !replace) {
			if (pending) pushNotice("warning", t("skippedConflicts", { count: pending.names.length }));
			return;
		}
		try {
			const results = await importDroppedFiles(pending.files, true, pending.targetDirectory);
			const imported = results.filter((item) => !item.error);
			void refreshWorkspaceFiles();
			setExplorerDirectoryReload({
				path: pending.targetDirectory,
				token: ++explorerDirectoryReloadTokenRef.current,
			});
			if (pending.mentionAfterImport && imported.length) {
				const mention = imported.map((item) => `@${item.path ?? item.name}`).join(" ");
				setDraft((current) => (current ? `${current} ${mention}` : `${mention} `));
				promptRef.current?.focus();
			}
			pushNotice("success", t("replacedConflicts", { count: imported.length }));
			for (const item of results.filter((result) => result.error)) {
				pushNotice("error", t("itemError", { name: item.name, error: item.error ?? t("unknown") }));
			}
		} catch (error) {
			pushNotice("error", error instanceof Error ? error.message : String(error));
		}
	}

	async function handleChooseImages(): Promise<void> {
		const remaining = Math.max(0, MAX_IMAGE_ATTACHMENTS - attachments.length);
		if (remaining === 0) {
			pushNotice("warning", t("maxImages", { count: MAX_IMAGE_ATTACHMENTS }));
			return;
		}
		try {
			const selected = await chooseImages();
			if (selected.length > remaining) {
				pushNotice("warning", t("maxImages", { count: MAX_IMAGE_ATTACHMENTS }));
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
			pushNotice("accent", t("helpNotice"));
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
				pushNotice("warning", t("nameUsage"));
				return true;
			}
			if (!currentSessionPath) {
				pushNotice("error", t("sessionNotSaved"));
				return true;
			}
			try {
				await renameSession(currentSessionPath, argument);
				pushNotice("success", t("sessionRenamedTo", { name: argument.slice(0, 40) }));
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
			return true;
		}
		if (command === "copy") {
			try {
				await copyLastAnswer();
				pushNotice("success", t("answerCopied"));
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
				pushNotice("success", t("resourcesReloaded"));
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
		if (command === "settings" || command === "skills" || command === "plugins" || command === "usage") {
			setConfigModal(command);
			return true;
		}
		if (command === "trust") {
			if (!snapshot.workspacePath) {
				setActionError(t("openProjectFirst"));
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
		const requestId = ++fileOpenRequestId.current;
		const workspacePath = getDesktopSnapshot().workspacePath;
		setFileExplorerError(undefined);
		try {
			const preview = await readWorkspaceFile(entry.path);
			if (requestId === fileOpenRequestId.current && getDesktopSnapshot().workspacePath === workspacePath) {
				setFileTabs((tabs) => {
					if (tabs.some((tab) => tab.path === preview.path)) return tabs;
					return [...tabs, { path: preview.path, preview }];
				});
				setActiveTabPath(preview.path);
				setInspectorOpen(true);
			}
		} catch (error) {
			if (requestId === fileOpenRequestId.current && getDesktopSnapshot().workspacePath === workspacePath) {
				setFileExplorerError(error instanceof Error ? error.message : String(error));
			}
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
				setActionError(t("clearDraftFirst"));
				return;
			}
			try {
				const hasImageBlocks = message.blocks?.some((block) => block.type === "image") ?? false;
				const restoredImages = hasImageBlocks
					? await restoreMessageImages(message.id).catch((error: unknown) => {
							pushNotice(
								"warning",
								t("imageRestoreFailed", { reason: error instanceof Error ? error.message : String(error) }),
							);
							return [];
						})
					: [];
				if (message.forkEntryId) await navigateTree({ entryId: message.forkEntryId });
				setDraft(message.text);
				if (restoredImages.length) {
					setAttachments((current) => [...current, ...restoredImages].slice(0, MAX_IMAGE_ATTACHMENTS));
				}
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
		[attachments.length, draft, pushNotice, t],
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

	const handleQuoteLines = useCallback((path: string, start: number, end: number): void => {
		const suffix = start === end ? `${start}` : `${start}-${end}`;
		setDraft((current) => `${current}${current ? "\n" : ""}@${path}:${suffix} `);
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

	/** Project rows prefer the custom name and fall back to the folder name. */
	function projectLabel(root: string): string {
		return projectProfiles[root]?.name?.trim() || projectFolderLabel(root);
	}

	const handleRevealProject = useCallback(
		async (path: string): Promise<void> => {
			setActionError(undefined);
			try {
				await revealProjectPath(path);
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice],
	);

	function togglePinnedProject(root: string): void {
		setPinnedProjectRoots((current) => {
			const next = new Set(current);
			if (next.has(root)) next.delete(root);
			else next.add(root);
			return next;
		});
	}

	function toggleArchivedChats(root: string): void {
		setArchivedChatRoots((current) => {
			const next = new Set(current);
			if (next.has(root)) next.delete(root);
			else next.add(root);
			return next;
		});
	}

	function assignProjectSection(root: string, section?: string): void {
		setProjectSections((current) => {
			const assignments = { ...current.assignments };
			if (section) assignments[root] = section;
			else delete assignments[root];
			return { names: current.names, assignments };
		});
	}

	function createProjectSection(root: string, name: string): void {
		const trimmed = name.trim();
		if (!trimmed) return;
		setProjectSections((current) => ({
			names: current.names.includes(trimmed) ? current.names : [...current.names, trimmed],
			assignments: { ...current.assignments, [root]: trimmed },
		}));
	}

	/** "Add folder" reuses the native directory picker; cancelling returns undefined. */
	function handleRequestProjectFolder(): Promise<string | undefined> {
		return selectDirectory();
	}

	function handleSaveProject(root: string, draft: { name: string; folders: string[] }): void {
		const folders = [root, ...draft.folders.filter((folder) => folder !== root)];
		/* A name equal to the folder name is the default, not an alias: storing it
		 * would freeze the label when the folder is renamed on disk. */
		const typed = draft.name.trim();
		const name = typed === projectFolderLabel(root) ? "" : typed;
		setProjectProfiles((current) => ({
			...current,
			[root]: { folders, ...(name ? { name } : {}) },
		}));
		setEditingProjectRoot(undefined);
		pushNotice("success", t("projectSaved"));
	}

	function handleRemoveLocalProject(root: string): void {
		setEditingProjectRoot(undefined);
		setArchivedProjectRoots((current) => new Set(current).add(root));
		setProjectProfiles((current) => {
			if (!(root in current)) return current;
			const next = { ...current };
			delete next[root];
			return next;
		});
		pushNotice("success", t("projectRemoved"));
	}

	const handleDownloadFile = useCallback(
		async (path: string): Promise<void> => {
			try {
				const saved = await saveWorkspaceFile(path);
				if (saved) pushNotice("success", t("savedTo", { path: saved }));
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice, t],
	);

	const handleReloadActiveTab = useCallback(
		async (path: string): Promise<void> => {
			try {
				const preview = await readWorkspaceFile(path);
				setFileTabs((tabs) => tabs.map((tab) => (tab.path === path ? { ...tab, preview } : tab)));
				pushNotice("success", t("fileReloaded"));
			} catch (error) {
				pushNotice("error", error instanceof Error ? error.message : String(error));
			}
		},
		[pushNotice, t],
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

	function resetResize(side: "fileTree" | "inspector" | "sidebar"): void {
		const width = side === "sidebar" ? 275 : side === "inspector" ? 500 : 280;
		const variable =
			side === "sidebar" ? "--sidebar-width" : side === "inspector" ? "--inspector-width" : "--file-tree-width";
		document.querySelector<HTMLElement>(".app-workbench")?.style.setProperty(variable, `${width}px`);
		if (side === "sidebar") setSidebarWidth(width);
		else if (side === "inspector") setInspectorWidth(width);
		else setFileTreeWidth(width);
		localStorage.removeItem(
			side === "sidebar"
				? "pi-desktop-sidebar-width"
				: side === "inspector"
					? "pi-desktop-inspector-width"
					: "pi-desktop-file-tree-width",
		);
	}

	function renderSidebar() {
		/*
		 * Folders a project absorbed are resolved to that project before grouping,
		 * so "add folder" really does mean "these chats belong together".
		 */
		const folderAliases = new Map<string, string>();
		for (const [root, profile] of Object.entries(projectProfiles)) {
			for (const folder of profile.folders ?? []) {
				const alias = folder.replace(/[/]+$/, "");
				if (alias !== root) folderAliases.set(alias, root);
			}
		}
		const projects = new Map<string, DesktopSessionInfo[]>();
		for (const item of snapshot.sessions) {
			const root = (item.projectRoot ?? item.cwd).replace(/[\\\\/]+$/, "");
			const entries = projects.get(root) ?? [];
			entries.push(item);
			projects.set(root, entries);
		}
		const mergedProjects = new Map<string, DesktopSessionInfo[]>();
		for (const [root, items] of projects) {
			const target = folderAliases.get(root) ?? root;
			mergedProjects.set(target, [...(mergedProjects.get(target) ?? []), ...items]);
		}
		/* Pinned projects lead the list; everything else stays newest-first. */
		const activeProjects = [...mergedProjects.entries()]
			.filter(([root]) => !archivedProjectRoots.has(root))
			.sort(([leftRoot, leftItems], [rightRoot, rightItems]) => {
				const pinned = Number(pinnedProjectRoots.has(rightRoot)) - Number(pinnedProjectRoots.has(leftRoot));
				if (pinned !== 0) return pinned;
				const leftRecent = Math.max(...leftItems.map((item) => item.modified));
				const rightRecent = Math.max(...rightItems.map((item) => item.modified));
				return rightRecent - leftRecent;
			});
		const projectGroups = [
			...projectSections.names.map((name) => ({
				section: name as string | undefined,
				entries: activeProjects.filter(([root]) => projectSections.assignments[root] === name),
			})),
			{
				section: undefined,
				entries: activeProjects.filter(([root]) => {
					const assigned = projectSections.assignments[root];
					return !assigned || !projectSections.names.includes(assigned);
				}),
			},
		].filter((group) => group.entries.length > 0);
		return (
			<section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pb-2" aria-label={t("sessions")}>
				<div className="project-menu-root relative mt-1 flex min-h-[34px] items-center justify-between pr-0.5 text-[length:var(--text-md)] font-[650] tracking-[0.12em] text-[color:var(--text-dim)]">
					<span>{t("projects")}</span>
					<div className="flex items-center gap-0.5">
						<Button
							size="icon"
							className="compact"
							type="button"
							aria-label={t("projectActions")}
							aria-expanded={projectMenuOpen}
							onClick={() => setProjectMenuOpen((open) => !open)}
						>
							<Icon name="more" size={14} />
						</Button>
						<Button
							size="icon"
							className="compact"
							type="button"
							aria-label={t("openProject")}
							disabled={!canChooseWorkspace}
							onClick={() => void handleChooseWorkspace()}
						>
							<Icon name="plus" size={14} />
						</Button>
					</div>
					{projectMenuOpen ? renderProjectMenu() : null}
				</div>
				{activeProjects.length
					? projectGroups.map((group, groupIndex) => (
							<div
								className="grid gap-1.5 not-first:mt-1.5"
								key={group.section ? `section-${group.section}` : `ungrouped-${groupIndex}`}
							>
								{group.section ? (
									<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-0.5 pl-3 text-[length:var(--text-2xs)] font-[var(--font-weight-medium)] tracking-[var(--tracking-wide)] text-[color:var(--ds-text-muted)] uppercase">
										<Icon name="sections" size={12} />
										<span>{group.section}</span>
									</div>
								) : null}
								{group.entries.map(([root, items]) => {
									const flattenedItems = flattenSessionTree(items);
									const active = items.some((item) => item.id === session?.id);
									const branch =
										items.find((item) => item.worktreeBranch)?.worktreeBranch ??
										gitWorktrees.find((tree) => tree.path.replace(/[\\/]+$/u, "") === root)?.branch;
									const collapsed = collapsedProjects.has(root);
									const expanded = expandedProjects.has(root);
									const visibleItems = (() => {
										if (archivedChatRoots.has(root)) return [];
										if (expanded) return flattenedItems;
										const first = flattenedItems.slice(0, 5);
										const current = flattenedItems.find((item) => item.info.id === session?.id);
										if (!current || first.some((item) => item.info.id === current.info.id)) return first;
										return [...first.slice(0, 4), current];
									})();
									return (
										<section className="min-w-0" key={root}>
											<div
												className={`flex h-[var(--ds-control-size)] min-h-[var(--ds-control-size)] items-center gap-0.5 rounded-[var(--radius-sm)] pr-2.5 hover:bg-[var(--hover-strong)] ${active ? "bg-[var(--hover-strong)]" : ""}`}
											>
												<Button
													variant="bare"
													className="flex min-w-0 flex-1 items-center gap-[7px] rounded-[var(--radius-sm)] border-0 bg-transparent py-1 pr-1.5 pl-2.5 text-left text-[length:var(--text-sm)] font-medium text-[color:var(--text)] [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-[color:var(--ds-text-secondary)]"
													onClick={() =>
														setCollapsedProjects((current) => {
															const next = new Set(current);
															if (next.has(root)) next.delete(root);
															else next.add(root);
															return next;
														})
													}
													aria-expanded={!collapsed}
													onMouseEnter={(event) => {
														clearHoverClose();
														setHoverCard({
															kind: "project",
															root,
															count: flattenedItems.length,
															...tipPosition(event),
														});
													}}
													onMouseLeave={scheduleHoverClose}
												>
													<Icon name={collapsed ? "briefcase" : "briefcaseOpen"} size={15} />
													<span className="grid min-w-0 flex-1 gap-px [&>small]:truncate [&>small]:text-[length:var(--text-xs)] [&>small]:font-normal [&>small]:text-[color:var(--muted)]">
														{/*
														 * The whole project name, wrapped over at most two lines:
														 * the five-character cut made "pi-desktop" read as
														 * "pi-de…" even when the sidebar had room for it.
														 */}
														<span
															className="min-w-0 truncate text-[length:var(--text-base)] font-[var(--font-weight-medium)]"
															title={projectLabel(root)}
														>
															{projectLabel(root)}
														</span>
														{branch ? <small>⎇ {formatGitBranch(branch)}</small> : null}
													</span>
												</Button>
												<div className="ml-1 flex flex-row-reverse items-center gap-px [&>button]:inline-grid [&>button]:place-items-center [&>button]:p-0 [&>button]:leading-none">
													<Button
														size="icon"
														className={SIDEBAR_PROJECT_ACTION}
														aria-label={t("newSessionAria")}
														onClick={() => void handleNewSessionForProject(root)}
													>
														<Icon name="plus" size={13} />
													</Button>
													<div className="project-menu-root relative">
														<Button
															size="icon"
															className={SIDEBAR_PROJECT_ACTION}
															aria-label={t("projectActions")}
															aria-expanded={projectRowMenuOpen === root}
															onClick={() =>
																setProjectRowMenuOpen((current) =>
																	current === root ? undefined : root,
																)
															}
														>
															<Icon name="more" size={13} />
														</Button>
														{projectRowMenuOpen === root ? (
															<Menu className={`${SIDEBAR_SESSION_MORE_MENU} min-w-[188px]`}>
																<MenuItem
																	icon={<Icon name="pin" size={15} />}
																	label={
																		pinnedProjectRoots.has(root) ? t("unpinProject") : t("pinProject")
																	}
																	onSelect={() => {
																		setProjectRowMenuOpen(undefined);
																		togglePinnedProject(root);
																	}}
																/>
																<MenuItem
																	icon={<Icon name="gear" size={15} />}
																	label={t("editProject")}
																	onSelect={() => {
																		setProjectRowMenuOpen(undefined);
																		setEditingProjectRoot(root);
																	}}
																/>
																<MenuDivider />
																<div className="[&_.app-menu-trailing]:transition-transform [&_.app-menu-trailing]:duration-[var(--motion-duration-fast)] [&_.app-menu-trailing]:ease-[var(--motion-ease-out)] [&_[aria-expanded=true]_.app-menu-trailing]:rotate-90">
																	<MenuItem
																		icon={<Icon name="sections" size={15} />}
																		label={t("projectSection")}
																		trailing={<Icon name="chevron" size={12} />}
																		onSelect={() =>
																			setOpenProjectSection((current) =>
																				current === root ? undefined : root,
																			)
																		}
																	/>
																	{openProjectSection === root ? (
																		<Menu className="mx-1 mt-0.5 mb-1 ml-1.5" inline>
																			{projectSections.names.map((name) => (
																				<MenuItem
																					key={name}
																					label={name}
																					current={projectSections.assignments[root] === name}
																					onSelect={() => {
																						assignProjectSection(root, name);
																						setOpenProjectSection(undefined);
																						setProjectRowMenuOpen(undefined);
																					}}
																				/>
																			))}
																			{projectSections.assignments[root] ? (
																				<MenuItem
																					label={t("projectSectionNone")}
																					onSelect={() => {
																						assignProjectSection(root, undefined);
																						setOpenProjectSection(undefined);
																						setProjectRowMenuOpen(undefined);
																					}}
																				/>
																			) : null}
																			{pendingSectionRoot === root ? (
																				<form
																					className="p-[3px]"
																					onSubmit={(event) => {
																						event.preventDefault();
																						createProjectSection(root, sectionNameDraft);
																						setSectionNameDraft("");
																						setPendingSectionRoot(undefined);
																						setOpenProjectSection(undefined);
																						setProjectRowMenuOpen(undefined);
																					}}
																				>
																					<input
																						// biome-ignore lint/a11y/noAutofocus: 用户刚触发新建分区, 输入框已就位
																						autoFocus
																						value={sectionNameDraft}
																						onChange={(event) =>
																							setSectionNameDraft(event.target.value)
																						}
																						placeholder={t("projectSectionPlaceholder")}
																						aria-label={t("projectSectionPlaceholder")}
																					/>
																				</form>
																			) : (
																				<MenuItem
																					icon={<Icon name="plus" size={15} />}
																					label={t("projectSectionNew")}
																					onSelect={() => {
																						setPendingSectionRoot(root);
																						setSectionNameDraft("");
																					}}
																				/>
																			)}
																		</Menu>
																	) : null}
																</div>
																<MenuItem
																	icon={<Icon name="archiveBox" size={15} />}
																	label={
																		archivedChatRoots.has(root)
																			? t("unarchiveChats")
																			: t("archiveChats")
																	}
																	onSelect={() => {
																		setProjectRowMenuOpen(undefined);
																		toggleArchivedChats(root);
																	}}
																/>
																<MenuDivider />
																<MenuItem
																	icon={<Icon name="close" size={15} />}
																	label={t("removeProject")}
																	danger
																	onSelect={() => {
																		setProjectRowMenuOpen(undefined);
																		handleRemoveLocalProject(root);
																	}}
																/>
															</Menu>
														) : null}
													</div>
												</div>
											</div>
											{!collapsed ? (
												<div className="grid gap-0.5 pt-1">
													{visibleItems.map(({ info: item, depth }) => {
														const isCurrent = item.id === session?.id;
														const isRenaming = renamingSession?.path === item.path;
														return (
															<div
																className={`session-row-wrap group relative flex h-[var(--ds-control-size)] min-h-[var(--ds-control-size)] items-center rounded-[var(--radius-xs)] ${isCurrent ? "bg-[var(--hover-strong)]" : ""} ${depth ? "rounded-l-none border-l border-[var(--border-subtle)]" : ""}`}
																key={item.path}
																style={{ "--session-depth": Math.min(depth, 5) } as CSSProperties}
															>
																{isRenaming ? (
																	<form
																		className="flex min-w-0 flex-1 items-center gap-1 py-0.5 pr-[5px] pl-2.5"
																		onSubmit={(event) => {
																			event.preventDefault();
																			void handleRenameSubmit();
																		}}
																	>
																		<input
																			// biome-ignore lint/a11y/noAutofocus: 用户刚触发了内联重命名
																			autoFocus
																			aria-label={t("sessionNameAria")}
																			value={renamingSession.name}
																			onChange={(event) =>
																				setRenamingSession({
																					...renamingSession,
																					name: event.target.value,
																				})
																			}
																			onKeyDown={(event) => {
																				if (event.key === "Escape") setRenamingSession(undefined);
																			}}
																		/>
																		<Button size="sm" variant="primary" type="submit">
																			{t("save")}
																		</Button>
																	</form>
																) : (
																	<Button
																		variant="bare"
																		className="flex h-[var(--ds-control-size)] min-h-[var(--ds-control-size)] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border-0 bg-transparent pr-[5px] pl-2.5 text-left text-[color:var(--text-dim)] transition-[background] duration-150 hover:bg-[var(--hover)] disabled:opacity-55"
																		onMouseEnter={(event) =>
																			setHoverCard({
																				kind: "session",
																				title:
																					item.name ??
																					(item.firstMessage.trim() || sessionTitle(item, t)),
																				timestamp: item.modified,
																				...tipPosition(event),
																			})
																		}
																		onMouseLeave={() => setHoverCard(undefined)}
																		onClick={() =>
																			isCurrent
																				? promptRef.current?.focus()
																				: void handleOpenSession(item.path)
																		}
																	>
																		<span className="grid shrink-0 place-items-center text-[color:var(--muted)]">
																			<Icon name="chat" size={14} />
																		</span>
																		<span className="min-w-0 flex-1 truncate text-[length:var(--text-md)] font-medium tracking-[-0.006em] text-[color:var(--text)]">
																			{truncateLabel(sessionTitle(item, t))}
																		</span>
																		{item.phase === "running" || item.phase === "error" ? (
																			<span
																				className={`inline-flex min-h-[17px] shrink-0 items-center gap-1 rounded-full border px-[7px] py-px text-[length:var(--text-2xs)] font-semibold leading-[1.2] ${item.phase === "running" ? "border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[color:var(--accent-deep)]" : "border-[var(--danger-border)] bg-[var(--danger-overlay)] text-[color:var(--danger)]"}`}
																			>
																				<span
																					className={`size-[5px] shrink-0 rounded-full bg-current ${item.phase === "running" ? "animate-[status-breath_1.4s_ease-in-out_infinite] motion-reduce:animate-none" : ""}`}
																					aria-hidden="true"
																				/>
																				{item.phase === "running"
																					? t("sessionRunning")
																					: t("sessionError")}
																			</span>
																		) : null}
																		{unreadSessionIds.has(item.id) ? (
																			<span className="size-1.5 shrink-0 rounded-full bg-[var(--accent)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_12%,transparent)]" />
																		) : null}
																	</Button>
																)}
																{!isRenaming ? (
																	<Button
																		size="icon"
																		className="mr-[3px] grid size-[26px] shrink-0 place-items-center rounded-[var(--radius-sm)] border-0 bg-transparent text-[color:var(--muted)] opacity-0 transition-[opacity,color,background] duration-[120ms] ease-linear hover:bg-[var(--hover)] hover:text-[color:var(--text)] group-hover:opacity-100 aria-expanded:opacity-100"
																		aria-label={t("sessionActions")}
																		aria-expanded={sessionMenuOpen === item.path}
																		onClick={() =>
																			setSessionMenuOpen((open) =>
																				open === item.path ? undefined : item.path,
																			)
																		}
																	>
																		<Icon name="more" size={14} />
																	</Button>
																) : null}
																{sessionMenuOpen === item.path ? (
																	<Menu className={SIDEBAR_SESSION_MORE_MENU}>
																		<MenuItem
																			icon={<Icon name="edit" size={15} />}
																			label={t("rename")}
																			onSelect={() => {
																				setSessionMenuOpen(undefined);
																				setRenamingSession({
																					path: item.path,
																					name: item.name ?? sessionTitle(item, t),
																				});
																			}}
																		/>
																		{isCurrent ? (
																			<MenuItem
																				icon={<Icon name="chart" size={15} />}
																				label={t("sessionStats")}
																				onSelect={() => {
																					setSessionMenuOpen(undefined);
																					setTopPanel("session");
																				}}
																			/>
																		) : null}
																		{isCurrent ? (
																			<MenuItem
																				icon={<Icon name="branch" size={15} />}
																				label={t("forkAsSession")}
																				disabled={session?.phase === "running"}
																				onSelect={() => {
																					setSessionMenuOpen(undefined);
																					void handleForkSession();
																				}}
																			/>
																		) : null}
																		<MenuDivider />
																		<MenuItem
																			icon={<Icon name="close" size={15} />}
																			label={t("deleteSession")}
																			danger
																			disabled={item.phase === "running"}
																			onSelect={(event) => {
																				setSessionMenuOpen(undefined);
																				void handleDeleteSession(item.path, event.shiftKey);
																			}}
																		/>
																		<div className="mx-1.5 mt-[3px] mb-0.5 flex items-center gap-[7px] border-t border-[var(--border-subtle)] px-1.5 pt-[5px] pb-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] whitespace-nowrap text-[color:var(--muted)] [&>span]:overflow-hidden [&>span]:text-ellipsis">
																			<span>{formatSessionDate(item.modified)}</span>
																			<span>{t("messageCount", { count: item.messageCount })}</span>
																			<span>
																				{item.parentSessionPath
																					? t("forkBadge")
																					: t("mainBranchBadge")}
																			</span>
																		</div>
																	</Menu>
																) : null}
															</div>
														);
													})}
													{!expanded && flattenedItems.length > 5 ? (
														<Button
															size="sm"
															className="border-0 bg-transparent py-[5px] px-0 text-left text-[length:var(--text-xs)] text-[color:var(--text-dim)] hover:text-[color:var(--text)]"
															onClick={() =>
																setExpandedProjects((current) => new Set(current).add(root))
															}
														>
															{t("showMore", { count: flattenedItems.length - 5 })}
														</Button>
													) : null}
													{expanded && flattenedItems.length > 5 ? (
														<Button
															size="sm"
															className="border-0 bg-transparent py-[5px] px-0 text-left text-[length:var(--text-xs)] text-[color:var(--text-dim)] hover:text-[color:var(--text)]"
															onClick={() =>
																setExpandedProjects((current) => {
																	const next = new Set(current);
																	next.delete(root);
																	return next;
																})
															}
														>
															{t("showLess")}
														</Button>
													) : null}
												</div>
											) : null}
										</section>
									);
								})}
							</div>
						))
					: null}
			</section>
		);
	}

	const bashMode = !attachments.length && draft.startsWith("!");
	const macOSClassName = navigator.userAgent.includes("Macintosh") ? "is-macos" : "";

	function renderProjectMenu(close: () => void = () => setProjectMenuOpen(false)) {
		const query = projectFilter.trim().toLocaleLowerCase();
		const archivedProjectPaths = [...archivedProjectRoots].sort((left, right) => left.localeCompare(right));
		const activeProjectRoots = [
			...new Set(
				snapshot.sessions
					.map((item) => (item.projectRoot ?? item.cwd).replace(/[\\/]+$/, ""))
					.filter((path) => !archivedProjectRoots.has(path)),
			),
		];
		const allProjectsCollapsed =
			activeProjectRoots.length > 0 && activeProjectRoots.every((path) => collapsedProjects.has(path));
		const visibleRecentWorkspaces = recentWorkspaces.filter(
			(path) => !query || path.toLocaleLowerCase().includes(query),
		);
		return (
			<Menu className="absolute top-[calc(100%+4px)] right-0 left-0 z-[45] grid max-h-[340px] max-w-[240px] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-float)]">
				<MenuItem
					icon={<Icon name="compact" size={15} />}
					label={allProjectsCollapsed ? t("expandProjects") : t("collapseProjects")}
					disabled={activeProjectRoots.length === 0}
					onSelect={() => {
						setCollapsedProjects((current) => {
							const next = new Set(current);
							for (const path of activeProjectRoots) {
								if (allProjectsCollapsed) next.delete(path);
								else next.add(path);
							}
							return next;
						});
						close();
					}}
				/>
				<MenuItem
					icon={<Icon name="folder" size={15} />}
					label={t("chooseFolder")}
					disabled={!canChooseWorkspace}
					onSelect={() => {
						close();
						void handleChooseWorkspace();
					}}
				/>
				{recentWorkspaces.length > 0 ? (
					<>
						<MenuHeading>{t("recentProjects")}</MenuHeading>
						{knownWorkspacePaths.length > 7 ? (
							<MenuFilter
								value={projectFilter}
								onChange={setProjectFilter}
								placeholder={t("filterProjects")}
								ariaLabel={t("filterProjects")}
							/>
						) : null}
						{visibleRecentWorkspaces.slice(0, query ? visibleRecentWorkspaces.length : 7).map((path) => (
							<MenuItem
								key={path}
								icon={<Icon name="folder" size={15} />}
								label={formatWorkspace(path, t)}
								title={path}
								disabled={session?.phase === "running"}
								onSelect={() => {
									close();
									void handleSwitchWorkspacePath(path);
									setProjectFilter("");
								}}
							/>
						))}
						{visibleRecentWorkspaces.length === 0 ? <MenuEmpty>{t("noMatchingProjects")}</MenuEmpty> : null}
					</>
				) : null}
				{archivedProjectPaths.length ? (
					<>
						<MenuDivider />
						<MenuHeading>{t("archivedProjects")}</MenuHeading>
						{archivedProjectPaths.map((path) => (
							<MenuItem
								key={path}
								icon={<Icon name="folder" size={15} />}
								label={formatWorkspace(path, t)}
								title={path}
								trailing={t("restore")}
								onSelect={() => {
									setArchivedProjectRoots((current) => {
										const next = new Set(current);
										next.delete(path);
										return next;
									});
									close();
								}}
							/>
						))}
					</>
				) : null}
				{snapshot.workspacePath ? (
					<WorktreeSection
						key={snapshot.workspacePath}
						workspacePath={snapshot.workspacePath}
						projectTrusted={snapshot.projectTrusted}
						onSwitch={(path) => {
							close();
							void handleSwitchWorkspacePath(path);
						}}
					/>
				) : null}
			</Menu>
		);
	}

	return (
		<main
			className={`app-workbench flex h-dvh w-full min-h-0 overflow-hidden bg-[var(--ds-bg-primary)] ${macOSClassName} ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-closed"} ${inspectorOpen ? "is-inspector-open" : ""}`}
			style={
				{
					"--sidebar-width": `${sidebarWidth}px`,
					"--inspector-width": `${inspectorWidth}px`,
					"--file-tree-width": `${fileTreeWidth}px`,
				} as CSSProperties
			}
		>
			{hoverCard?.kind === "project" ? (
				<div
					className={SIDEBAR_HOVER_CARD}
					style={{ top: hoverCard.top, left: hoverCard.left }}
					role="menu"
					onMouseEnter={clearHoverClose}
					onMouseLeave={scheduleHoverClose}
				>
					<div className={SIDEBAR_HOVER_TITLE}>
						<Icon name="folder" size={14} />
						<span>{projectLabel(hoverCard.root)}</span>
					</div>
					<div className={SIDEBAR_HOVER_ROW}>
						<Icon name="chat" size={14} />
						<span>{t("projectTaskCount", { count: hoverCard.count })}</span>
					</div>
					<div className={SIDEBAR_HOVER_DIVIDER} />
					<div className={SIDEBAR_HOVER_ROW}>
						<Icon name="folder" size={14} />
						<span>{displayPath(hoverCard.root)}</span>
					</div>
					<div className={SIDEBAR_HOVER_DIVIDER} />
					<Button
						size="sm"
						className={SIDEBAR_HOVER_ROW}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							setEditingProjectRoot(hoverCard.root);
							setHoverCard(undefined);
						}}
					>
						<Icon name="gear" size={14} />
						<span>{t("editProject")}</span>
					</Button>
					<Button
						size="sm"
						className={SIDEBAR_HOVER_ROW}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							void handleRevealProject(hoverCard.root);
							setHoverCard(undefined);
						}}
					>
						<Icon name="folder" size={14} />
						<span>{t("revealInFinder")}</span>
					</Button>
				</div>
			) : null}
			{hoverCard?.kind === "session" ? (
				<div className={SIDEBAR_HOVER_CARD} style={{ top: hoverCard.top, left: hoverCard.left }} role="tooltip">
					<div className={SIDEBAR_HOVER_TITLE}>
						<span>{hoverCard.title}</span>
						<small>{sessionAgeLabel(hoverCard.timestamp, t)}</small>
					</div>
				</div>
			) : null}
			<aside
				className={`flex min-h-0 flex-col overflow-hidden border-r-0 bg-[var(--sidebar-bg)] bg-no-repeat [background-image:linear-gradient(180deg,var(--ds-sidebar-glass-sheen-top),transparent_220px),linear-gradient(0deg,var(--ds-sidebar-glass-sheen-bottom),transparent_160px)] transition-[width,min-width,flex-basis] duration-200 max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:z-[250] max-sm:max-w-[85vw] max-sm:duration-250 ${sidebarOpen ? "w-[var(--sidebar-width,var(--ds-sidebar-width-default))] min-w-[var(--sidebar-width,var(--ds-sidebar-width-default))] flex-[0_0_var(--sidebar-width,var(--ds-sidebar-width-default))] max-sm:w-[280px] max-sm:min-w-[280px] max-sm:flex-[0_0_280px] max-sm:shadow-[4px_0_20px_rgb(0_0_0/15%)]" : "w-0 min-w-0 flex-[0_0_0] max-sm:pointer-events-none max-sm:w-[280px] max-sm:min-w-[280px] max-sm:flex-[0_0_280px] max-sm:-translate-x-full max-sm:shadow-none"}`}
				aria-label={t("projectNavAria")}
				aria-hidden={!sidebarOpen}
			>
				<header className={`grid gap-1.5 px-2 pb-1.5 pl-4 ${macOSClassName ? "pt-[30px]" : "pt-1.5"}`}>
					<div className="flex h-[var(--ds-control-size)] items-center justify-between gap-1 pl-2.5">
						<span className="inline-flex min-w-0 items-center gap-1">
							<BrandMark
								className="block size-[18px] shrink-0 rounded-[var(--radius-3xs)] object-contain"
								size={18}
							/>
							<span className="truncate text-[length:var(--text-md)] font-[var(--font-weight-semibold)] tracking-[var(--tracking-tight)] text-[color:var(--text-primary)]">
								Pi Desktop
							</span>
						</span>
						<div className="flex min-h-[var(--ds-control-size)] items-center justify-end gap-0.5">
							<Button
								size="icon"
								className="inline-flex size-[var(--ds-control-size)] items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
								aria-label={t("searchSessionsAria")}
								title={t("searchSessionsAria")}
								onClick={() => setSearchOpen(true)}
							>
								<Icon name="search" size={15} />
							</Button>
							<Button
								size="icon"
								className="inline-flex size-[var(--ds-control-size)] items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
								aria-label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
								onClick={() => {
									const next = theme === "dark" ? "light" : "dark";
									const apply = () => {
										document.documentElement.dataset.theme = next;
										setThemeFollowsSystem(false);
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
							</Button>
							<Button
								size="icon"
								className="inline-flex size-[var(--ds-control-size)] items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
								aria-label={t("hideSidebar")}
								onClick={() => setSidebarOpen(false)}
							>
								<Icon name="panel" size={15} />
							</Button>
						</div>
					</div>
					<Button
						className="flex h-[38px] w-full min-w-0 items-center justify-center gap-[7px] rounded-[var(--radius-md)] border-0 bg-[var(--ds-raised)] px-2.5 text-left text-[length:var(--text-base)] font-medium tracking-[var(--tracking-normal)] whitespace-nowrap text-[color:var(--text-primary)] shadow-[0_0_0_0.5px_var(--ds-border-subtle)] transition-[background] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] hover:enabled:bg-[var(--ds-bg-hover)] disabled:bg-[var(--ds-tile)] [&>svg]:shrink-0 [&>svg]:text-[color:var(--text-primary)] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]"
						disabled={session?.phase === "running"}
						onClick={() => void handleNewSession()}
					>
						<Icon name="plus" size={16} />
						<span>{t("newSessionShort")}</span>
					</Button>
				</header>
				<div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-1.5">{renderSidebar()}</div>
				<footer className="flex min-h-[41px] items-center justify-start gap-1.5 px-2 pt-1 pb-[5px]">
					<div className="footer-menu-wrap relative inline-flex">
						<Button
							size="icon"
							aria-label={t("settings")}
							aria-expanded={settingsMenuOpen}
							aria-haspopup="menu"
							className={`inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border-0 bg-transparent p-0 text-[color:var(--muted)] whitespace-nowrap transition-[background,color] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${settingsMenuOpen ? "bg-[var(--hover-strong)] text-[color:var(--text)]" : ""}`}
							title={t("settings")}
							onClick={() => setSettingsMenuOpen((open) => !open)}
						>
							<Icon name="gear" size={16} />
						</Button>
						{settingsMenuOpen ? (
							<Menu className="absolute bottom-[calc(100%+6px)] left-0 z-[60] grid min-w-[168px] rounded-[var(--radius-md-plus)] border border-[var(--ds-border-subtle)] bg-[var(--ds-bg-elevated-opaque)] p-[5px] shadow-[var(--ds-shadow-dialog)]">
								{FOOTER_SETTINGS_ENTRIES.map((entry) => (
									<MenuItem
										key={entry.modal}
										icon={<Icon name={entry.icon} size={15} />}
										label={t(entry.label)}
										onSelect={() => {
											setSettingsMenuOpen(false);
											setConfigModal(entry.modal);
										}}
									/>
								))}
							</Menu>
						) : null}
					</div>
					<UpdateButton variant="footer" />
					<span
						className="ml-auto py-0 pr-0.5 pl-0 font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] whitespace-nowrap text-[color:var(--ds-text-faint)] select-none"
						title={t("desktopApp")}
					>
						v{__APP_VERSION__}
					</span>
				</footer>
			</aside>
			{sidebarOpen ? (
				<button
					className="mobile-panel-backdrop sidebar-backdrop hidden max-sm:fixed max-sm:inset-0 max-sm:z-[240] max-sm:block max-sm:border-0 max-sm:bg-[rgb(0_0_0/24%)]"
					type="button"
					aria-label={t("hideSidebar")}
					onClick={() => setSidebarOpen(false)}
				/>
			) : null}
			{sidebarOpen ? (
				<hr
					className="column-resizer sidebar-resizer relative z-[220] m-0 mx-[-6px] w-3 shrink-0 cursor-col-resize touch-none border-0 bg-transparent outline-0 max-sm:hidden"
					aria-label={t("resizeSidebarAria")}
					aria-orientation="vertical"
					aria-valuemin={180}
					aria-valuemax={480}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					onPointerDown={(event) => beginResize("sidebar", event.clientX)}
					onDoubleClick={() => resetResize("sidebar")}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							resetResize("sidebar");
							return;
						}
						if (event.key === "ArrowLeft" || event.key === "ArrowRight")
							resizeByKeyboard("sidebar", event.key === "ArrowLeft" ? -16 : 16);
					}}
				/>
			) : null}
			<section
				className={`chat-workspace relative isolate grid min-h-0 min-w-0 flex-1 grid-rows-[var(--ds-toolbar-height)_minmax(0,1fr)_auto] overflow-hidden bg-[var(--ds-bg-primary)] bg-no-repeat [background-image:linear-gradient(180deg,color-mix(in_oklab,var(--ds-text-primary)_5%,transparent),transparent_340px),radial-gradient(120%_52%_at_50%_0%,color-mix(in_oklab,var(--ds-accent)_3%,transparent),transparent_72%),linear-gradient(0deg,color-mix(in_oklab,var(--ds-text-primary)_2.5%,transparent),transparent_200px)] ${isSessionEmpty ? "is-session-empty" : ""} ${terminalOpen ? "has-terminal" : ""} ${branchMenuOpen ? "overflow-visible" : ""}`}
				aria-label={t("chatAria")}
			>
				<header className="top-bar relative z-20 flex h-[var(--ds-toolbar-height)] min-h-[var(--ds-toolbar-height)] items-center justify-between gap-2 border-b-0 bg-transparent px-2 py-0 pl-3">
					{!sidebarOpen ? (
						<Button
							size="icon"
							className={`mr-1 inline-flex size-[var(--ds-control-size)] shrink-0 items-center justify-center self-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${macOSClassName && !sidebarOpen ? "relative -top-[5px]" : ""}`}
							aria-label={t("showSidebar")}
							onClick={() => setSidebarOpen(true)}
						>
							<Icon name="panel" size={16} />
						</Button>
					) : null}
					{/* One line, like the reference's .ct-title; the second line of detail
					    stays reachable through the tooltip. */}
					<div
						className={`chat-title flex min-w-0 items-center gap-0.5 [-webkit-app-region:drag] [&>span]:truncate [&>span]:text-[length:var(--text-md)] [&>span]:font-semibold [&>span]:text-[color:var(--text)] ${sidebarOpen ? "" : "hidden"}`}
						title={topBarSubtitle ? `${topBarTitle} — ${topBarSubtitle}` : topBarTitle}
					>
						<span title={topBarTitle}>{truncateLabel(topBarTitle)}</span>
					</div>
					<div className="top-bar-actions relative z-30 flex items-center gap-0.5">
						<Button
							size="sm"
							className={NATIVE_TOOLBAR_BUTTON}
							aria-label={t("fullHistory")}
							title={t("fullHistory")}
							disabled={!session?.messages.length}
							onClick={() => void handleExportSession()}
						>
							<Icon name="history" size={12} />
							<span>{t("fullHistory")}</span>
						</Button>
						<BranchNavigator
							tree={snapshot.branchTree ?? []}
							activeLeafId={snapshot.branchActiveLeafId}
							hasSession={Boolean(session)}
							onLeafChange={handleNavigateTree}
							onFork={() => void handleForkSession()}
							open={topPanel === "branches"}
							onToggle={() => setTopPanel((current) => (current === "branches" ? undefined : "branches"))}
						/>
						<Button
							size="sm"
							className={`${NATIVE_TOOLBAR_BUTTON} ${terminalOpen ? NATIVE_TOOLBAR_ACTIVE : ""}`}
							aria-label={t("toggleTerminal")}
							title={t("toggleTerminal")}
							aria-expanded={terminalOpen}
							disabled={!snapshot.workspacePath}
							onClick={handleToggleTerminal}
						>
							<Icon name="terminal" size={12} />
							<span>{t("toggleTerminal")}</span>
						</Button>
						<div className="top-bar-more-wrap relative z-40 isolate">
							<Button
								size="sm"
								className={`${NATIVE_TOOLBAR_BUTTON} app-topbar-more-trigger ${moreMenuOpen ? NATIVE_TOOLBAR_ACTIVE : ""}`}
								aria-label={t("more")}
								title={t("more")}
								aria-expanded={moreMenuOpen}
								onClick={() => setMoreMenuOpen((open) => !open)}
							>
								<Icon name="more" size={12} />
								<span>{t("more")}</span>
							</Button>
							{moreMenuOpen ? (
								<Menu className="top-bar-more-menu absolute top-[calc(100%+6px)] right-0 z-50 grid min-w-[260px] max-w-[380px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-[5px] opacity-100 shadow-[var(--shadow-float)]">
									<MenuItem
										icon={<Icon name="sparkles" size={15} />}
										label={
											namingState === "loading"
												? t("generatingTitle")
												: namingState === "success"
													? t("generatedTitle")
													: namingState === "error"
														? t("generateTitleFailed")
														: t("generateTitle")
										}
										hint={t("autoNameHint")}
										disabled={!session?.messages.length || namingState === "loading"}
										onSelect={() => void handleAutoName()}
									/>
									<MenuItem
										icon={<Icon name="terminal" size={15} />}
										label={t("systemPrompt")}
										hint={session?.systemPrompt ? t("viewSystemPromptHint") : t("noSystemPrompt")}
										disabled={!session}
										onSelect={() => {
											setMoreMenuOpen(false);
											setTopPanel((current) => (current === "system" ? undefined : "system"));
										}}
									/>
									<MenuItem
										icon={<Icon name="chart" size={15} />}
										label={t("sessionStats")}
										hint={statsSummary ?? t("noStats")}
										disabled={!session}
										onSelect={() => {
											setMoreMenuOpen(false);
											setTopPanel((current) => (current === "session" ? undefined : "session"));
										}}
									/>
									<MenuDivider />
									{(["none", "default", "full"] as const).map((preset) => (
										<MenuItem
											key={preset}
											icon={<Icon name="wrench" size={15} />}
											label={t(
												`toolPreset${preset[0].toUpperCase()}${preset.slice(1)}` as ToolPresetLabelKey,
											)}
											hint={t(
												`toolPreset${preset[0].toUpperCase()}${preset.slice(1)}Description` as ToolPresetHintKey,
											)}
											current={preset === toolPreset}
											disabled={!canChangeToolPreset}
											onSelect={() => {
												setMoreMenuOpen(false);
												void handleToolPresetChange(preset);
											}}
										/>
									))}
									<MenuItem
										icon={<Icon name="compact" size={15} />}
										label={compacting ? t("stopCompact") : t("compact")}
										hint={t("compactContextAria")}
										disabled={!session || aborting}
										onSelect={() => {
											setMoreMenuOpen(false);
											void (compacting ? handleAbort() : handleCompact());
										}}
									/>
									<MenuItem
										icon={<Icon name={soundOnComplete ? "speaker" : "speakerOff"} size={15} />}
										label={soundOnComplete ? t("soundOn") : t("soundOff")}
										hint={t("toggleSoundAria")}
										current={soundOnComplete}
										onSelect={() => {
											if (!soundOnComplete) unlockCompletionAudio();
											setSoundOnComplete((current) => !current);
										}}
									/>
								</Menu>
							) : null}
						</div>
						<div className="top-bar-more-wrap top-bar-openwith-wrap relative z-40 isolate inline-flex items-center">
							<Button
								size="sm"
								className="inline-flex h-[var(--ds-control-size)] w-auto min-w-0 items-center justify-center gap-1.5 rounded-none rounded-l-[var(--radius-2xs)] border-0 bg-transparent px-1 pl-1.5 text-[length:var(--text-sm-plus)] text-[color:var(--text-dim)] whitespace-nowrap transition-[background,color] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] disabled:opacity-40 [&>img]:size-[15px] [&>img]:shrink-0 [&>img]:object-contain [&>span]:max-w-[110px] [&>span]:truncate [&>span]:text-[length:var(--text-xs)] [&>svg]:shrink-0 [&>svg]:text-[color:var(--text-dim)]"
								aria-label={t("openWithMain", { name: selectedOpenWith?.name ?? "" })}
								title={t("openWithMain", { name: selectedOpenWith?.name ?? "" })}
								disabled={!snapshot.workspacePath || !selectedOpenWith}
								onClick={() => {
									if (selectedOpenWith) void openWith(selectedOpenWith.id);
								}}
							>
								{selectedOpenWith?.iconDataUrl ? (
									<img alt="" aria-hidden="true" src={selectedOpenWith.iconDataUrl} />
								) : (
									<Icon name="external" size={14} />
								)}
								<span>{selectedOpenWith?.name ?? t("openWithTitle")}</span>
							</Button>
							<Button
								size="icon"
								className={`inline-flex h-[var(--ds-control-size)] w-5 min-w-0 items-center justify-center rounded-none rounded-r-[var(--radius-2xs)] border-0 bg-transparent p-0 text-[color:var(--text-dim)] transition-[background,color] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] disabled:opacity-40 [&>svg]:shrink-0 ${openWithMenuOpen ? NATIVE_TOOLBAR_ACTIVE : ""}`}
								aria-label={t("openWithChoose")}
								title={t("openWithChoose")}
								aria-expanded={openWithMenuOpen}
								disabled={!snapshot.workspacePath}
								onClick={handleToggleOpenWithMenu}
							>
								<Icon name="chevronDown" size={12} />
							</Button>
							{openWithMenuOpen ? (
								<Menu className="top-bar-more-menu absolute top-[calc(100%+6px)] right-0 z-50 grid min-w-[200px] max-w-[380px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-[5px] opacity-100 shadow-[var(--shadow-float)]">
									{openWithApps.map((app) => (
										<MenuItem
											key={app.id}
											icon={
												app.iconDataUrl ? (
													<img alt="" aria-hidden="true" src={app.iconDataUrl} />
												) : (
													<Icon name="external" size={15} />
												)
											}
											label={app.name}
											current={app.id === selectedOpenWith?.id}
											onSelect={() => {
												setOpenWithAppId(app.id);
												localStorage.setItem("pi-desktop-open-with", app.id);
												void openWith(app.id);
											}}
										/>
									))}
								</Menu>
							) : null}
						</div>
						<Button
							size="icon"
							type="button"
							aria-label={t("openPreview")}
							onClick={() => setInspectorOpen((isOpen) => !isOpen)}
						>
							<Icon name="panel" size={16} />
						</Button>
						{topPanel === "system" ? (
							<div
								className="absolute top-[calc(100%+6px)] right-0 z-[60] max-h-[min(420px,60vh)] w-[min(680px,calc(100vw-80px))] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 shadow-[var(--shadow-float)]"
								role="dialog"
								aria-label={t("systemPrompt")}
							>
								<div className="mb-2 flex items-center justify-between [&>strong]:text-[length:var(--text-md)] [&>strong]:font-semibold [&>strong]:text-[color:var(--text)]">
									<strong>{t("systemPrompt")}</strong>
									<Button
										size="icon"
										className="compact"
										type="button"
										aria-label={t("close")}
										onClick={() => setTopPanel(undefined)}
									>
										×
									</Button>
								</div>
								{session?.systemPrompt ? (
									<pre className="m-0 max-h-[300px] overflow-auto rounded-[var(--radius-xs)] bg-[var(--surface-recessed)] px-3 py-2.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] leading-[1.6] whitespace-pre-wrap text-[color:var(--text-dim)]">
										{session.systemPrompt}
									</pre>
								) : (
									<p className="m-0 px-3 py-1 text-[length:var(--text-xs)] text-[color:var(--muted)]">
										{t("systemPromptEmpty")}
									</p>
								)}
							</div>
						) : null}
						{topPanel === "session" ? (
							<SessionStatsPanel
								stats={snapshot.sessionStats}
								sessionPath={snapshot.sessions.find((item) => item.id === session?.id)?.path}
								sessionId={session?.id}
								sessionName={session?.name}
								onOpenActivity={() => {
									setTopPanel(undefined);
									setConfigModal("usage");
								}}
								onClose={() => setTopPanel(undefined)}
							/>
						) : null}
					</div>
					<WindowControls />
				</header>
				{!isOnline || startupError ? (
					<output className="flex min-h-[30px] items-center gap-2 border-b border-[color-mix(in_srgb,var(--danger)_26%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface-1))] px-4 text-[length:var(--text-xs)] text-[color:var(--text-dim)]">
						<span className="size-[7px] shrink-0 rounded-full bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_15%,transparent)]" />
						<span>{isOnline ? t("initFailedBanner") : t("offlineBanner")}</span>
						<Button size="sm" variant="outline" type="button" onClick={() => void startDesktopStore()}>
							{t("retry")}
						</Button>
					</output>
				) : null}
				<div
					className="relative overflow-auto [scrollbar-gutter:stable]"
					ref={chatScrollRef}
					onScroll={handleChatScroll}
				>
					<ConversationNavigator
						turns={conversationTurns}
						scrollContainerRef={chatScrollRef}
						onSelect={(messageId) => {
							chatScrollRef.current
								?.querySelector(`[data-turn-id="${messageId}"]`)
								?.scrollIntoView({ block: "start", behavior: "smooth" });
						}}
					/>
					<div className="mx-auto w-[min(820px,calc(100%-24px))] pt-7 pb-[18px]">
						{startupError ? (
							<Button variant="outline" type="button" onClick={() => void startDesktopStore()}>
								{t("retryInit")}
							</Button>
						) : null}
						{actionError ? (
							<output className="mb-3.5 flex items-center gap-[9px] rounded-[var(--radius-m)] bg-[color-mix(in_oklab,var(--ds-error)_10%,transparent)] px-3 py-2 text-[length:var(--text-sm)] leading-[1.45] text-[color:var(--error-text)]">
								{actionError}
							</output>
						) : null}
						{notices.length ? (
							// biome-ignore lint/a11y/useSemanticElements: 通知容器非单独状态区
							<div
								className="pointer-events-none absolute top-3 right-[18px] z-[12] grid max-w-[min(460px,calc(100%-36px))] justify-items-end gap-1.5"
								role="status"
							>
								{notices.map((notice) => (
									<Button
										variant="bare"
										className={`pointer-events-auto flex max-w-full min-h-[34px] animate-[notice-in_180ms_ease] items-center gap-[9px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-[7px] text-left text-[length:var(--text-sm)] text-[color:var(--text-dim)] shadow-[0_1px_2px_rgb(0_0_0/6%)] ${notice.kind === "error" ? "[&_.notice-dot]:bg-[var(--danger)]" : notice.kind === "success" ? "[&_.notice-dot]:bg-[var(--success)]" : notice.kind === "warning" ? "[&_.notice-dot]:bg-[var(--warning)]" : ""}`}
										key={notice.id}
										onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
									>
										<span className="notice-dot size-2 shrink-0 rounded-full bg-[var(--accent)]" />
										<span className="line-clamp-3 overflow-hidden break-words">{notice.text}</span>
									</Button>
								))}
							</div>
						) : null}
						{snapshot.pendingToolApprovals.length > 0 ? (
							<section className="my-5 grid gap-3" aria-label={t("pendingApprovalsAria")}>
								{snapshot.pendingToolApprovals.map((approval) => (
									<ToolApprovalCard
										approval={approval}
										onOpenSession={(sessionId) => {
											const owner = snapshot.sessions.find((item) => item.id === sessionId);
											if (owner)
												void openSession({ sessionPath: owner.path }).catch((error: unknown) =>
													setActionError(String(error)),
												);
										}}
										key={approval.id}
										onDecide={handleToolApproval}
										resolving={resolvingApprovalId === approval.id}
									/>
								))}
							</section>
						) : null}
						{authenticationPrompt ? (
							<section className="my-5 grid gap-3" aria-label={t("pendingAuthPromptsAria")}>
								<AuthenticationPromptCard
									onChange={setAuthenticationResponse}
									onSubmit={handleAuthenticationPrompt}
									prompt={authenticationPrompt}
									resolving={respondingToAuthenticationPromptId === authenticationPrompt.id}
									response={authenticationResponse}
								/>
							</section>
						) : null}
						<div className="pb-6" key={session?.id}>
							{visibleItemCount < transcriptItems.length ? (
								<div
									className="pointer-events-none mt-[-1px] h-px"
									ref={earlierMessagesSentinelRef}
									aria-hidden="true"
								/>
							) : null}
							{visibleItemCount < transcriptItems.length ? (
								<Button
									className="mb-3 block w-full rounded-[var(--radius-xs)] border border-dashed border-[var(--border-subtle)] bg-transparent p-[7px] text-[length:var(--text-sm)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)]"
									onClick={() => setVisibleItemCount((current) => current + 60)}
								>
									{t("loadEarlier", { count: transcriptItems.length - visibleItemCount })}
								</Button>
							) : null}
							{hasUserMessage
								? transcriptItems.slice(-visibleItemCount).map((item) => {
										if (item.type === "process") {
											return (
												<ProcessDetails
													key={`process:${item.messages[0]?.id ?? item.blocks.map((block) => block.type).join(":")}`}
													item={item}
													isActive={session?.phase === "running" && item === transcriptItems.at(-1)}
													previousTimestamps={previousMessageTimestamps}
												/>
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
													modelLabel={session?.model?.id}
													isStreaming={item.message.id === lastMessage?.id && session?.phase === "running"}
													previousTimestamp={previousMessageTimestamps.get(item.message.id)}
													onEdit={(message) => void handleEditMessage(message)}
													onFork={(entryId) => void handleForkFromMessage(entryId)}
												/>
											</div>
										);
									})
								: null}
							{session?.pendingMessages.length ? (
								<div className="mb-2 ml-auto grid max-w-[min(76%,560px)] gap-1.5 rounded-[var(--radius-xs)] bg-[var(--surface-recessed)] px-2.5 py-2 text-[length:var(--text-sm)] text-[color:var(--text-dim)]">
									<div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] font-semibold tracking-[0.06em] text-[color:var(--muted)]">
										<span>{t("queuedCount", { count: session.pendingMessages.length })}</span>
										<Button
											size="sm"
											onClick={() => {
												void (async () => {
													try {
														const queueSessionId = session.id;
														const receipt = await clearSessionQueue(queueSessionId);
														const texts = receipt.messages.map((message) => message.text);
														if (!texts.length) return;
														if (getDesktopSnapshot().session?.id !== queueSessionId) {
															const key = `${DRAFT_STORAGE_PREFIX}${queueSessionId}`;
															localStorage.setItem(
																key,
																[texts.join("\n\n"), localStorage.getItem(key)]
																	.filter(Boolean)
																	.join("\n\n"),
															);
															return;
														}
														setDraft((current) =>
															current ? `${texts.join("\n\n")}\n\n${current}` : texts.join("\n\n"),
														);
														promptRef.current?.focus();
													} catch (error) {
														setActionError(error instanceof Error ? error.message : String(error));
													}
												})();
											}}
										>
											{t("retrieve")}
										</Button>
									</div>
									{session.pendingMessages.map((message, index) => (
										<div
											className="mb-2 ml-auto grid max-w-[76%] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 rounded-[var(--radius-xs)] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-[11px] py-2 text-[length:var(--text-sm)] text-[color:var(--text-dim)] [&>p]:m-0 [&>p]:truncate [&>span]:rounded-full [&>span]:border [&>span]:border-[var(--border-subtle)] [&>span]:px-1.5 [&>span]:py-px [&>span]:text-[length:var(--text-2xs)] [&>span]:text-[color:var(--muted)] [&>span]:uppercase"
											key={`${message.behavior}:${index}:${message.text}`}
										>
											<span
												className={
													message.behavior === "steer"
														? "border-[color-mix(in_oklab,var(--ds-warning)_45%,transparent)] text-[color-mix(in_oklab,var(--ds-warning)_90%,transparent)]"
														: ""
												}
											>
												{message.behavior === "steer" ? t("steer") : t("followUp")}
											</span>
											<p>{message.text}</p>
										</div>
									))}
								</div>
							) : null}
							{session?.phase === "running" &&
							transcriptItems.at(-1)?.type !== "process" &&
							transcriptItems.at(-1)?.type !== "assistant" ? (
								<output className="mb-2.5 inline-flex w-fit items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--ds-accent)_10%,transparent)] px-2.5 py-1 text-[length:var(--text-sm)] text-[color:var(--text-dim)]">
									<span className="inline-block size-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)] animate-[status-breath_2s_ease-in-out_infinite] motion-reduce:animate-none" />
									{session.runningTools?.length
										? t("runningTools", {
												tools: `${session.runningTools.slice(0, 3).join("、")}${session.runningTools.length > 3 ? "、" : ""}`,
												count: session.runningTools.length,
											})
										: t("waitingForModel")}
									<span
										className="ml-[5px] inline-flex items-center gap-[3px] [&>i]:size-[3px] [&>i]:rounded-full [&>i]:bg-current [&>i]:opacity-60"
										aria-hidden="true"
									>
										<i />
										<i />
										<i />
									</span>
								</output>
							) : null}
							{session?.autoRetry ? (
								<div className="mb-2 grid gap-0.5 rounded-[var(--radius-xs)] border border-[var(--warning-border)] bg-[color-mix(in_oklab,var(--ds-warning)_10%,transparent)] px-3 py-2">
									<span className="text-[length:var(--text-sm)] font-medium text-[color:var(--ds-warning)]">
										{t("autoRetry", {
											attempt: session.autoRetry.attempt,
											max: session.autoRetry.maxAttempts,
										})}
									</span>
									<span className="text-[length:var(--text-xs)] [overflow-wrap:anywhere] text-[color:var(--text-dim)]">
										{session.autoRetry.errorMessage}
									</span>
								</div>
							) : null}
							{compactionHint ? (
								<output className="mb-2 flex min-h-7 items-center rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-overlay)] px-2.5 py-0.5 text-[length:var(--text-sm)] leading-5 text-[color:var(--success)]">
									<span
										className="mr-1.5 inline-grid size-4 shrink-0 place-items-center text-[color:var(--ds-text-muted)]"
										aria-hidden="true"
									>
										<Icon name="archiveBox" size={14} />
									</span>
									<span className="shrink-0 text-[length:var(--text-sm)] font-medium leading-5 text-[color:var(--ds-text-secondary)]">
										{t("compactionHintTitle")}
									</span>
									<span
										className="mx-2 size-0.5 shrink-0 rounded-px bg-[var(--ds-text-faint)]"
										aria-hidden="true"
									/>
									<span className="min-w-0 truncate text-[length:var(--text-sm)] leading-5 text-[color:var(--ds-text-muted)]">
										{compactionHint}
									</span>
								</output>
							) : null}
						</div>
					</div>
				</div>
				{awayFromBottom ? (
					<Button
						className="absolute right-1/2 bottom-[102px] z-[8] flex translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-[11px] py-[7px] text-[length:var(--text-xs)] text-[color:var(--text-dim)] shadow-[0_5px_18px_rgb(0_0_0/18%)] hover:bg-[var(--surface-2)] hover:text-[color:var(--text)]"
						onClick={scrollToLatest}
					>
						<span>↓</span>
						{unseenMessages > 0 ? t("unseenCount", { count: unseenMessages }) : t("backToBottom")}
					</Button>
				) : null}
				<form
					className={`bg-transparent px-6 pb-4 ${isSessionEmpty && !terminalOpen ? "absolute top-1/2 right-0 left-0 -translate-y-1/2" : "relative"}`}
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
					{draggingImages ? (
						<div className="pointer-events-none absolute inset-x-6 top-0 bottom-2.5 z-20 grid place-items-center rounded-[var(--radius-m)] border border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] text-[length:var(--text-sm)] font-semibold text-[color:var(--text)]">
							{t("dropToAttach")}
						</div>
					) : null}
					{compactError ? (
						<output
							className="mb-2 flex items-start justify-between gap-2.5 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--danger)_46%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-2.5 py-2 text-[length:var(--text-sm)] leading-[1.45] whitespace-pre-wrap text-[color:var(--text)]"
							role="alert"
						>
							{compactError}
							<Button
								size="icon"
								className="compact"
								onClick={() => setCompactError(undefined)}
								aria-label={t("closeCompactError")}
							>
								×
							</Button>
						</output>
					) : null}
					{!hasUserMessage ? (
						<div className="mb-4 flex w-full min-h-0 flex-col items-center justify-center gap-4 p-0 text-center [&>h1]:m-0 [&>h1]:max-w-[min(100%,42rem)] [&>h1]:text-[length:var(--text-display)] [&>h1]:font-[var(--font-weight-normal)] [&>h1]:tracking-[var(--tracking-tight)] [&>h1]:leading-[var(--leading-tighter)] [&>h1]:text-[color:var(--ds-text-primary)] [&>h1]:text-balance">
							<span
								className="flex size-[100px] items-center justify-center text-[color:var(--ds-text-secondary)] select-none [&>img]:block [&>img]:size-[100px] [&>img]:rounded-[var(--radius-lg-plus)] [&>img]:object-contain [&>img]:shadow-[var(--ds-raised-shadow)]"
								aria-hidden="true"
							>
								<BrandMark size={100} />
							</span>
							<h1>{snapshot.workspacePath ? t("startTaskTitle") : t("startProjectTitle")}</h1>
							<p className="m-0 max-w-[min(100%,36rem)] text-[length:var(--text-base)] leading-[var(--leading-relaxed)] text-[color:var(--ds-text-muted)]">
								{snapshot.workspacePath ? t("startTaskHint") : t("startProjectHint")}
							</p>
						</div>
					) : null}
					<ExtensionWidgetStack
						widgets={(snapshot.extensionWidgets ?? []).filter((widget) => widget.placement === "aboveEditor")}
					/>
					{/*
					 * The composer carries no project name: the sidebar already says
					 * which project is open, and the row above the field is reserved
					 * for the branch chip.
					 */}
					{snapshot.workspacePath && composerBranch ? (
						<div className="mx-auto mb-2 flex w-[min(var(--ds-composer-max-width),100%)] items-center gap-[18px] pl-3.5 text-[length:var(--text-sm)] text-[color:var(--ds-text-muted)]">
							<div className="relative inline-flex min-w-0">
								<Button
									size="sm"
									className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent font-[inherit] text-inherit hover:text-[color:var(--ds-text-primary)] [&>svg]:shrink-0 [&>svg]:opacity-70 [&>span]:truncate"
									aria-expanded={branchMenuOpen}
									aria-haspopup="menu"
									onClick={() => setBranchMenuOpen((open) => !open)}
								>
									<Icon name="branch" size={14} />
									<span>{formatGitBranch(composerBranch)}</span>
								</Button>
								{branchMenuOpen ? (
									<Menu className="absolute top-[calc(100%+6px)] left-0 z-[80] max-h-[min(360px,46vh)] w-max min-w-[220px] overflow-auto">
										<WorktreeSection
											workspacePath={snapshot.workspacePath}
											projectTrusted={snapshot.projectTrusted}
											onSwitch={(path) => {
												setBranchMenuOpen(false);
												void handleSwitchWorkspacePath(path);
											}}
										/>
									</Menu>
								) : null}
							</div>
						</div>
					) : null}
					<div className="relative mx-auto w-[min(var(--ds-composer-max-width),100%)] rounded-[var(--ds-composer-radius)] border-0 bg-[var(--ds-bg-composer)] px-4 pt-3.5 pb-2.5 shadow-[0_0_0_0.5px_var(--ds-border-default),var(--ds-shadow-composer)] transition-[background,box-shadow] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] focus-within:shadow-[0_0_0_0.5px_color-mix(in_oklab,var(--ds-accent)_72%,transparent),0_4px_16px_rgb(0_0_0/6%)] supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]">
						{slashActive ? (
							<div className={COMPOSER_SLASH_MENU} role="listbox" aria-label={t("slashCommandsAria")}>
								<div className={COMPOSER_SLASH_HEADER}>
									<span className={COMPOSER_SLASH_HEADER_LABEL}>
										{t("commandCount", { count: visibleSlashCommands.length })}
									</span>
									<small className={COMPOSER_SLASH_HEADER_HINT}>{t("menuHint")}</small>
								</div>
								{visibleSlashCommands.length ? (
									<div className="grid grid-cols-2 gap-1 p-1.5">
										{visibleSlashCommands.map((command, index) => (
											<Button
												variant="bare"
												aria-selected={suggestionIndex === index}
												className={`${COMPOSER_SLASH_COMMAND_GRID} ${suggestionIndex === index ? `${COMPOSER_SLASH_COMMAND_SELECTED} border-[var(--border-subtle)]` : ""}`}
												key={command.name}
												role="option"
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => selectComposerSuggestion(index)}
											>
												<code>/{command.name}</code>
												<span>{command.description}</span>
												<small>{command.category}</small>
											</Button>
										))}
									</div>
								) : (
									<p className={COMPOSER_SLASH_EMPTY}>{t("noMatchingCommands")}</p>
								)}
							</div>
						) : null}
						{hashActive ? (
							<div className={COMPOSER_SLASH_MENU} role="listbox" aria-label={t("sessionMentionAria")}>
								<div className={COMPOSER_SLASH_HEADER}>
									<span className={COMPOSER_SLASH_HEADER_LABEL}>{t("sessions")}</span>
									<small className={COMPOSER_SLASH_HEADER_HINT}>{t("menuHint")}</small>
								</div>
								{hashSessions.length ? (
									hashSessions.map((item, index) => (
										<Button
											variant="bare"
											aria-selected={suggestionIndex === index}
											className={`${COMPOSER_SLASH_COMMAND} ${suggestionIndex === index ? COMPOSER_SLASH_COMMAND_SELECTED : ""}`}
											key={item.path}
											role="option"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => selectComposerSuggestion(index)}
										>
											<span>#{item.name ?? t("unnamedSession")}</span>
											<small>{item.firstMessage}</small>
										</Button>
									))
								) : (
									<p className={COMPOSER_SLASH_EMPTY}>{t("noMatchingSessions")}</p>
								)}
							</div>
						) : null}
						{atActive ? (
							<div className={COMPOSER_SLASH_MENU} role="listbox" aria-label={t("fileMentionAria")}>
								<div className={COMPOSER_SLASH_HEADER}>
									<span className={COMPOSER_SLASH_HEADER_LABEL}>{t("projectFiles")}</span>
									<small className={COMPOSER_SLASH_HEADER_HINT}>{t("menuHint")}</small>
								</div>
								{atEntries.length ? (
									atEntries.map((entry, index) => {
										const dirIndex = mentionNameStart(entry.path, atQuery);
										return (
											<Button
												variant="bare"
												aria-selected={suggestionIndex === index}
												className={`${COMPOSER_SLASH_COMMAND} ${suggestionIndex === index ? COMPOSER_SLASH_COMMAND_SELECTED : ""}`}
												key={entry.path}
												role="option"
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => selectComposerSuggestion(index)}
											>
												<span className="grid w-[13px] shrink-0 place-items-center text-[color:var(--muted)]">
													<Icon
														name={entry.type === "directory" ? "folder" : fileIconFor(entry.path)}
														size={13}
													/>
												</span>
												<span className="min-w-0 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] [&>small]:text-[color:var(--muted)]">
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
											</Button>
										);
									})
								) : (
									<p className={COMPOSER_SLASH_EMPTY}>
										{workspaceEntries.length ? t("noMatchingFilesShort") : t("readingFiles")}
									</p>
								)}
							</div>
						) : null}
						{attachments.length ? (
							<div className="flex flex-wrap gap-1.5 pb-2">
								{attachments.map((attachment) => (
									<div
										className="relative size-14 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-3)] [corner-shape:round]"
										key={attachment.id}
										title={`${attachment.name} · ${formatAttachmentSize(attachment.size, t)}`}
									>
										{attachment.thumbnailDataUrl ? (
											<img
												className="block size-14 rounded-full object-cover"
												src={attachment.thumbnailDataUrl}
												alt=""
											/>
										) : (
											<span className="grid size-full place-items-center text-[color:var(--text-dim)]">
												<Icon name="image" size={20} />
											</span>
										)}
										<Button
											size="icon"
											className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] p-0 text-[color:var(--muted)] hover:bg-[var(--overlay-7)] hover:text-[color:var(--text)]"
											aria-label={t("removeAria", { name: attachment.name })}
											onClick={() => {
												setAttachments((current) =>
													current.filter((currentAttachment) => currentAttachment.id !== attachment.id),
												);
												void discardImageAttachment(attachment.id).catch(() => undefined);
											}}
										>
											<Icon name="close" size={12} />
										</Button>
									</div>
								))}
							</div>
						) : null}
						{bashMode ? (
							<div
								className={`mb-1.5 ml-0.5 flex items-center gap-1.5 text-[length:var(--text-xs)] font-medium ${draft.startsWith("!!") ? "text-[color:var(--muted)]" : "text-[color:var(--accent-strong)]"}`}
							>
								<Icon name="terminal" size={12} />
								<span>{draft.startsWith("!!") ? t("shellExcludeFromContext") : t("shellSendToModel")}</span>
							</div>
						) : null}
						<div
							className="relative flex min-w-0 items-end gap-2 border-0 bg-transparent p-0"
							ref={composerEditorRef}
						>
							{historyMenuOpen && promptHistoryRef.current.length > 0 ? (
								<div
									className="absolute right-0 bottom-[calc(100%+8px)] left-0 z-[55] max-h-[min(44vh,360px)] overflow-hidden rounded-[var(--radius-lg)] border-[0.5px] border-[var(--ds-border-default)] bg-[color-mix(in_oklab,var(--ds-bg-elevated-opaque)_82%,transparent)] p-[5px] shadow-[0_0_0_0.5px_var(--ds-border-subtle),var(--ds-shadow-dialog)] backdrop-blur-[18px] backdrop-saturate-125 supports-[corner-shape:superellipse(1.5)]:[corner-shape:superellipse(1.5)]"
									role="listbox"
									aria-label={t("promptHistory")}
								>
									<div className="flex h-[31px] items-center gap-[7px] border-b border-[var(--border-subtle)] px-[11px] text-[length:var(--text-xs)] text-[color:var(--muted)]">
										<Icon name="history" size={13} />
										<span>{t("promptHistory")}</span>
										<small className="ml-auto text-[length:var(--text-2xs)] text-[color:var(--text-dim)]">
											{t("historyHint")}
										</small>
									</div>
									<div className="max-h-[calc(min(44vh,360px)-32px)] overflow-y-auto p-1">
										{promptHistoryRef.current.map((item, index) => (
											<Button
												variant="bare"
												key={`${index}:${item}`}
												role="option"
												aria-selected={index === historyActiveIndex}
												className={`flex w-full items-start gap-2 rounded-[var(--radius-2xs)] border-0 bg-transparent px-2 py-[7px] text-left text-[length:var(--text-sm-plus)] leading-[1.45] text-[color:var(--text)] hover:bg-[var(--overlay-5)] ${index === historyActiveIndex ? "bg-[var(--overlay-5)]" : ""}`}
												onMouseDown={(event) => event.preventDefault()}
												onMouseEnter={() => setHistoryActiveIndex(index)}
												onClick={() => {
													setDraft(item);
													setHistoryMenuOpen(false);
													promptHistoryIndexRef.current = index;
													requestAnimationFrame(() => promptRef.current?.focus());
												}}
											>
												<span className="w-[14px] shrink-0 pt-px text-right font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[color:var(--text-dim)]">
													{index + 1}
												</span>
												<strong className="min-w-0 overflow-hidden font-normal [overflow-wrap:anywhere] line-clamp-2">
													{item}
												</strong>
											</Button>
										))}
									</div>
								</div>
							) : null}
							<textarea
								ref={promptRef}
								id="prompt"
								className="h-[3lh] max-h-[3lh] min-h-[3lh] w-full min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0.5 py-1.5 text-[length:var(--text-base)] leading-[var(--leading-body)] text-[color:var(--text)] outline-none shadow-none placeholder:text-[color:var(--text-secondary)] placeholder:opacity-72 disabled:cursor-not-allowed focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
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
									if (isComposingInput(event.nativeEvent, composingRef.current)) return;
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
										if (event.altKey && session?.phase === "running")
											void handleSubmit(undefined, "followUp");
										else event.currentTarget.form?.requestSubmit();
									}
								}}
								placeholder={
									session?.phase === "running" ? t("composerRunningPlaceholder") : t("composerPlaceholder")
								}
								disabled={
									submitting ||
									openingWorkspace ||
									changingTrust ||
									settingUpProvider ||
									snapshot.providerSetupInProgress
								}
							/>
						</div>
						{modelScopeNotice ? (
							<output
								className="mb-1.5 flex items-center gap-1.5 overflow-hidden rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--ds-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-warning)_10%,transparent)] px-2.5 py-[5px] text-[length:var(--text-xs)] text-ellipsis whitespace-nowrap text-[color:var(--text)]"
								title={modelScopeNotice}
							>
								<span className="size-1.5 shrink-0 rounded-full bg-[var(--ds-warning)]" />
								{modelScopeNotice}
							</output>
						) : null}
						{permissionPrompt ? (
							<div className="mb-1.5 flex items-center gap-2.5 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--ds-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-warning)_10%,transparent)] py-1.5 pr-2 pl-2.5 text-[length:var(--text-xs)] text-[color:var(--text)]">
								<p className="m-0 min-w-0 leading-[1.4]">{permissionPrompt.text}</p>
								<Button
									variant="primary"
									disabled={allowingPermission}
									onClick={() => void allowBlockedPermission()}
								>
									{allowingPermission ? t("allowingPermissionChange") : t("allowPermissionChange")}
								</Button>
							</div>
						) : null}
						<div
							className="mt-0.5 flex min-w-0 items-center justify-between gap-1.5 pt-1 text-[length:var(--text-xs)] text-[color:var(--muted)]"
							ref={composerControlsRef}
						>
							<div className="flex min-w-0 items-center gap-1.5">
								<div className="relative flex items-center gap-0.5">
									<Button
										size="icon"
										disabled={attachments.length >= MAX_IMAGE_ATTACHMENTS || session?.phase === "running"}
										aria-label={t("addImage")}
										title={t("addImage")}
										onClick={() => void handleChooseImages()}
									>
										<Icon name="image" size={15} />
									</Button>
									<div className="relative inline-flex">
										<Button
											size="sm"
											className="[&_svg]:box-content [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:overflow-visible"
											disabled={!session}
											aria-label={t("permissionLabel")}
											aria-expanded={composerMenu === "permission"}
											aria-haspopup="menu"
											title={t(PERMISSION_HINTS[permissionMode])}
											onClick={() =>
												setComposerMenu((current) => (current === "permission" ? undefined : "permission"))
											}
										>
											<Icon name={permissionMode === "full" ? "shieldAlert" : "shield"} size={14} />
											<span>{t(PERMISSION_LABELS[permissionMode])}</span>
										</Button>
										{composerMenu === "permission" ? (
											<Menu className={`${COMPOSER_CONTROL_MENU} left-0`}>
												{PERMISSION_MODES.map((mode) => (
													<MenuItem
														key={mode}
														icon={<Icon name={mode === "full" ? "shieldAlert" : "shield"} size={14} />}
														label={t(PERMISSION_LABELS[mode])}
														hint={t(PERMISSION_HINTS[mode])}
														current={mode === permissionMode}
														onSelect={() => {
															setComposerMenu(undefined);
															void handlePermissionChange(mode);
														}}
													/>
												))}
											</Menu>
										) : null}
									</div>
									<div className="relative inline-flex">
										<Button
											size="sm"
											disabled={!canSetModel || settingModel}
											aria-label={t("changeModelAria")}
											aria-expanded={composerMenu === "model"}
											aria-haspopup="menu"
											title={t("changeModelAria")}
											onClick={() =>
												setComposerMenu((current) => (current === "model" ? undefined : "model"))
											}
										>
											<Icon name="model" size={15} />
											<span>
												{getModelDisplayName(snapshot.availableModels, session?.model) ??
													t("modelButtonLabel")}
											</span>
										</Button>
										{composerMenu === "model" ? (
											<Menu className={`${COMPOSER_CONTROL_MENU} left-0`}>
												{snapshot.availableModels.length > 8 ? (
													<MenuFilter
														autoFocus
														placeholder={t("filterModels")}
														ariaLabel={t("filterModels")}
														value={modelFilter}
														onChange={setModelFilter}
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
													<MenuEmpty>{t("noMatchingModels")}</MenuEmpty>
												) : (
													filteredModelsByProvider.map(([provider, models]) => (
														<Fragment key={provider}>
															{filteredModelsByProvider.length > 1 ? (
																<MenuHeading>{provider}</MenuHeading>
															) : null}
															{models.map((model) => {
																const current =
																	session?.model?.id === model.id &&
																	session?.model?.provider === model.provider;
																return (
																	<MenuItem
																		key={getModelKey(model.provider, model.id)}
																		label={model.name}
																		current={current}
																		onSelect={() => {
																			setComposerMenu(undefined);
																			void handleChangeModel(getModelKey(model.provider, model.id));
																		}}
																	/>
																);
															})}
														</Fragment>
													))
												)}
											</Menu>
										) : null}
									</div>
									<div className="relative inline-flex">
										<Button
											size="sm"
											disabled={!session}
											aria-label={t("changeThinkingAria")}
											aria-expanded={composerMenu === "thinking"}
											aria-haspopup="menu"
											title={
												scopedThinkingFixed
													? t("scopeThinkingFixed", { level: scopedThinkingFixed })
													: t("changeThinkingAria")
											}
											onClick={() =>
												setComposerMenu((current) => (current === "thinking" ? undefined : "thinking"))
											}
										>
											<Icon name="bulb" size={14} />
											<span>
												{thinkingLabel}
												{scopedThinkingFixed && selectedThinkingLevel === scopedThinkingFixed
													? t("scopeSuffix")
													: ""}
											</span>
										</Button>
										{composerMenu === "thinking" ? (
											<Menu className={`${COMPOSER_CONTROL_MENU} right-0`}>
												{thinkingLevels.map((level) => (
													<MenuItem
														key={level}
														label={getThinkingDisplayLabel(level, activeModel?.thinkingLevelMap)}
														hint={t(THINKING_LEVEL_DESCRIPTION_KEYS[level])}
														current={level === selectedThinkingLevel}
														onSelect={() => void handleChangeThinking(level)}
													/>
												))}
											</Menu>
										) : null}
									</div>
									{extensionStatusLine ? (
										<output
											className="inline-flex max-w-[min(34vw,340px)] items-center overflow-hidden px-1 text-[length:var(--text-xs)] whitespace-nowrap text-[color:var(--muted)] [&>span]:truncate"
											title={plainExtensionStatusLine}
										>
											{parseAnsiLine(extensionStatusLine).map((segment, index) => (
												<span key={`${index}:${segment.text}`} style={segment.style}>
													{segment.text}
												</span>
											))}
										</output>
									) : null}
								</div>
							</div>
							<div className="relative ml-auto flex min-w-0 shrink-0 items-center gap-1.5 overflow-visible">
								{compactComposerControls && !composerControlsOpen ? (
									<Button
										size="sm"
										className="shrink-0"
										aria-expanded={composerControlsOpen}
										onClick={() => setComposerControlsOpen(true)}
									>
										<Icon name="more" size={14} />
										<span>{t("moreComposerControls")}</span>
									</Button>
								) : null}
								<div
									className={
										compactComposerControls && !composerControlsOpen
											? "hidden"
											: compactComposerControls
												? "absolute right-0 bottom-[calc(100%+8px)] z-[41] flex min-w-0 items-center gap-1.5 rounded-[var(--radius-m)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-[5px] shadow-[var(--shadow-float)]"
												: "flex min-w-0 items-center gap-1.5"
									}
								>
									{compactComposerControls ? (
										<Button
											size="icon"
											className="shrink-0"
											aria-label={t("collapseComposerControls")}
											title={t("collapseComposerControls")}
											onClick={() => setComposerControlsOpen(false)}
										>
											<Icon name="close" size={14} />
										</Button>
									) : null}
								</div>
								{session?.phase === "running" ? (
									<div className="flex shrink-0 items-center">
										<Button
											variant="danger"
											size="icon"
											disabled={aborting}
											aria-label={aborting ? t("stopping") : t("stop")}
											title={aborting ? t("stopping") : t("stop")}
											onClick={() => void handleAbort()}
										>
											<Icon name="stop" size={14} />
										</Button>
									</div>
								) : (
									<>
										<ContextUsageRing
											stats={snapshot.sessionStats}
											onToggle={() =>
												setTopPanel((current) => (current === "session" ? undefined : "session"))
											}
										/>
										<Button
											variant="primary"
											size="icon"
											type="submit"
											disabled={!canSubmit}
											aria-label={submitting ? t("sending") : t("send")}
											title={submitting ? t("sending") : t("send")}
										>
											<Icon name="send" size={15} />
										</Button>
									</>
								)}
							</div>
						</div>
					</div>
					<ExtensionWidgetStack
						className="pt-[7px] pb-0"
						widgets={(snapshot.extensionWidgets ?? []).filter((widget) => widget.placement === "belowEditor")}
					/>
				</form>
				<TerminalPanel open={terminalOpen} onOpenChange={setTerminalOpen} />
			</section>
			{inspectorOpen ? (
				<hr
					className="column-resizer inspector-resizer relative z-[220] m-0 mx-[-6px] w-3 shrink-0 cursor-col-resize touch-none border-0 bg-transparent outline-0 max-sm:hidden max-[959px]:min-[641px]:hidden"
					aria-label={t("resizeInspectorAria")}
					aria-orientation="vertical"
					aria-valuemin={300}
					aria-valuemax={1200}
					aria-valuenow={inspectorWidth}
					tabIndex={0}
					onPointerDown={(event) => beginResize("inspector", event.clientX)}
					onDoubleClick={() => resetResize("inspector")}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							resetResize("inspector");
							return;
						}
						if (event.key === "ArrowLeft" || event.key === "ArrowRight")
							resizeByKeyboard("inspector", event.key === "ArrowLeft" ? 16 : -16);
					}}
				/>
			) : null}
			{inspectorOpen ? (
				<button
					className="mobile-panel-backdrop inspector-backdrop hidden max-[959px]:min-[641px]:fixed max-[959px]:min-[641px]:inset-0 max-[959px]:min-[641px]:z-[240] max-[959px]:min-[641px]:block max-[959px]:min-[641px]:border-0 max-[959px]:min-[641px]:bg-[rgb(0_0_0/24%)] max-sm:z-[260]"
					type="button"
					aria-label={t("closeRightPanel")}
					onClick={() => setInspectorOpen(false)}
				/>
			) : null}
			{inspectorOpen ? (
				<aside
					className="flex min-h-0 min-w-[300px] w-[var(--inspector-width,440px)] flex-[0_0_var(--inspector-width,440px)] flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-1)] min-[641px]:border-[var(--ds-border-subtle)] min-[641px]:bg-[var(--ds-bg-dock)] max-[959px]:min-[641px]:fixed max-[959px]:min-[641px]:inset-y-0 max-[959px]:min-[641px]:right-0 max-[959px]:min-[641px]:z-[250] max-[959px]:min-[641px]:w-[min(560px,calc(100vw-48px))] max-[959px]:min-[641px]:shadow-[-12px_0_32px_rgb(0_0_0/18%)] max-sm:fixed max-sm:inset-0 max-sm:z-[270] max-sm:w-full max-sm:min-w-0 max-sm:flex-[0_0_100%]"
					aria-label={t("files")}
				>
					<header className="flex h-12 min-h-12 items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg)_88%,var(--surface-1))] py-[5px] pr-2 pl-2.5">
						<div
							className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto bg-transparent px-0.5"
							role="tablist"
							aria-label={t("openFilesAria")}
						>
							{fileTabs.length === 0 ? (
								<div className="inline-flex h-9 items-center gap-1.5 px-2.5 text-[length:var(--text-sm)] text-[color:var(--muted)]">
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
										className={`inline-flex h-9 min-w-[120px] max-w-[min(280px,34vw)] shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-s)] border border-transparent bg-[var(--surface-1)] pr-[7px] pl-3 text-[length:var(--text-md)] font-medium text-[color:var(--muted)] transition-[color,background,border-color] duration-150 hover:bg-[var(--hover)] hover:text-[color:var(--text-dim)] [&>span]:truncate [&>button]:grid [&>button]:size-4 [&>button]:shrink-0 [&>button]:place-items-center [&>button]:rounded-[var(--radius-3xs)] [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-[color:var(--muted)] [&>button:hover]:bg-[var(--hover)] [&>button:hover]:text-[color:var(--text)] ${tab.path === activeTabPath ? "border-[var(--border-subtle)] bg-[var(--bg)] text-[color:var(--text)] shadow-[0_1px_2px_rgb(0_0_0/5%)]" : ""}`}
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
										<Button
											size="icon"
											className="compact"
											aria-label={t("closeTabAria", { path: tab.path })}
											onClick={(event) => {
												event.stopPropagation();
												handleCloseTab(tab.path);
											}}
										>
											<Icon name="close" size={12} />
										</Button>
									</div>
								))
							)}
						</div>
						<div className="flex shrink-0 items-center gap-0.5">
							<div className="file-actions-menu-anchor relative">
								<Button
									size="icon"
									className={fileActionsMenuOpen ? "is-active" : ""}
									type="button"
									aria-label={t("more")}
									aria-expanded={fileActionsMenuOpen}
									onClick={() => setFileActionsMenuOpen((open) => !open)}
								>
									<Icon name="more" size={15} />
								</Button>
								{fileActionsMenuOpen ? (
									<Menu className="absolute top-[calc(100%+5px)] right-0 left-auto z-[70] min-w-[168px]">
										<MenuItem
											disabled={!activeFileTab}
											label={t("fileActionCopyPath")}
											onSelect={() => {
												if (activeFileTab) {
													void navigator.clipboard.writeText(activeFileTab.path).then(
														() => pushNotice("success", t("pathCopied")),
														() => pushNotice("error", t("pathCopyFailed")),
													);
												}
												setFileActionsMenuOpen(false);
											}}
										/>
										<MenuItem
											disabled={!activeFileTab}
											label={t("fileActionCopyContent")}
											onSelect={() => {
												if (activeFileTab) {
													void navigator.clipboard.writeText(activeFileTab.preview.content).then(
														() => pushNotice("success", t("contentCopied")),
														() => pushNotice("error", t("contentCopyFailed")),
													);
												}
												setFileActionsMenuOpen(false);
											}}
										/>
										<MenuItem
											disabled={!activeFileTab}
											label={t("fileActionWrap")}
											onSelect={() => {
												window.dispatchEvent(new Event("pi:file-toggle-wrap"));
												setFileActionsMenuOpen(false);
											}}
										/>
									</Menu>
								) : null}
							</div>
							<Button
								size="icon"
								className={fileTreeOpen ? "is-active" : ""}
								type="button"
								aria-label={fileTreeOpen ? t("hideFileTree") : t("showFileTree")}
								onClick={() => setFileTreeOpen((open) => !open)}
							>
								<Icon name="files" size={15} />
							</Button>
							<Button
								size="icon"
								type="button"
								aria-label={t("closeRightPanel")}
								onClick={() => setInspectorOpen(false)}
							>
								<Icon name="close" size={16} />
							</Button>
						</div>
					</header>
					<div className="flex min-h-0 min-w-0 flex-1 [&>.inspector]:min-w-0 [&>.inspector]:flex-1">
						<Inspector
							key={`${snapshot.workspacePath ?? ""}:${activeTabPath ?? ""}`}
							workspacePath={snapshot.workspacePath}
							reloadSignal={explorerReloadSignal}
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
									() => pushNotice("success", t("pathCopied")),
									() => pushNotice("error", t("pathCopyFailed")),
								);
							}}
							onCopyContent={(content) => {
								void navigator.clipboard.writeText(content).then(
									() => pushNotice("success", t("contentCopied")),
									() => pushNotice("error", t("contentCopyFailed")),
								);
							}}
							onQuoteLines={handleQuoteLines}
						/>
						{fileTreeOpen ? (
							<>
								<hr
									className="m-0 h-full w-[5px] min-w-[5px] cursor-col-resize border-0 border-l border-[var(--border-subtle)] bg-transparent hover:border-l-[var(--accent)] focus-visible:border-l-[var(--accent)] focus-visible:outline-none max-[959px]:min-[641px]:hidden"
									aria-label={t("resizeFileTreeAria")}
									aria-orientation="vertical"
									aria-valuemin={220}
									aria-valuemax={520}
									aria-valuenow={fileTreeWidth}
									tabIndex={0}
									onPointerDown={(event) => beginResize("fileTree", event.clientX)}
									onDoubleClick={() => resetResize("fileTree")}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											resetResize("fileTree");
											return;
										}
										if (event.key === "ArrowLeft" || event.key === "ArrowRight")
											resizeByKeyboard("fileTree", event.key === "ArrowLeft" ? 16 : -16);
									}}
								/>
								<div className="min-h-0 w-[var(--file-tree-width,280px)] min-w-[220px] max-w-[520px] flex-[0_0_var(--file-tree-width,280px)] overflow-hidden bg-[var(--surface-recessed)] [&>.flex]:h-full">
									<Explorer
										error={fileExplorerError}
										isTrusted={snapshot.projectTrusted}
										reloadSignal={explorerReloadSignal}
										directoryReload={explorerDirectoryReload}
										selectedPath={activeTabPath}
										workspacePath={snapshot.workspacePath}
										onChooseWorkspace={() => void handleChooseWorkspace()}
										onDownload={(path) => void handleDownloadFile(path)}
										onMention={(path) => {
											setDraft((current) => `${current}${current ? " " : ""}@${path} `);
											promptRef.current?.focus();
										}}
										onOpenFile={(entry) => void handleOpenFile(entry)}
										onRefresh={() => {
											void refreshWorkspaceFiles();
											setExplorerReloadSignal((value) => value + 1);
										}}
										onTrustProject={() => void handleProjectTrust()}
										onUpload={handleImportWorkspaceFiles}
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
					onTrustProject={() => void handleProjectTrust()}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "plugins" ? (
				<PluginsConfigModal
					plugins={snapshot.plugins}
					workspacePath={snapshot.workspacePath}
					projectTrusted={snapshot.projectTrusted}
					onTrustProject={() => void handleProjectTrust()}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{searchOpen ? (
				<SearchDialog
					sessions={snapshot.sessions}
					onOpenSession={(target) => void handleOpenSession(target.path)}
					onClose={() => setSearchOpen(false)}
				/>
			) : null}
			{configModal === "settings" ? (
				<AppSettingsModal
					accent={accent}
					theme={theme}
					notifyOnComplete={notifyOnComplete}
					onChangeTheme={(nextTheme) => {
						setThemeFollowsSystem(false);
						setTheme(nextTheme);
					}}
					onChangeAccent={setAccent}
					onToggleNotify={() => setNotifyOnComplete((current) => !current)}
					onClose={() => setConfigModal(undefined)}
				/>
			) : null}
			{configModal === "usage" ? <TokenActivityModal onClose={() => setConfigModal(undefined)} /> : null}
			{editingProjectRoot ? (
				<ProjectEditorDialog
					projectRoot={editingProjectRoot}
					initialName={projectProfiles[editingProjectRoot]?.name ?? projectFolderLabel(editingProjectRoot)}
					initialFolders={[
						editingProjectRoot,
						...(projectProfiles[editingProjectRoot]?.folders ?? []).filter(
							(folder) => folder !== editingProjectRoot,
						),
					]}
					onRequestFolder={handleRequestProjectFolder}
					onRemoveProject={() => handleRemoveLocalProject(editingProjectRoot)}
					onClose={() => setEditingProjectRoot(undefined)}
					onSave={(draft) => handleSaveProject(editingProjectRoot, draft)}
				/>
			) : null}
			{permissionRiskOpen ? (
				<PermissionRiskDialog onCancel={() => setPermissionRiskOpen(false)} onConfirm={confirmPermissionRisk} />
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
			{deleteSessionPath ? (
				<Modal
					title={t("deleteSessionTitle")}
					className="max-h-none w-[min(420px,100%)]"
					footerClassName="is-end"
					onClose={() => setDeleteSessionPath(undefined)}
					footer={
						<>
							<Button variant="outline" type="button" onClick={() => setDeleteSessionPath(undefined)}>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								type="button"
								onClick={() => void handleDeleteSession(deleteSessionPath, true)}
							>
								{t("deleteSession")}
							</Button>
						</>
					}
				>
					<p className="m-0 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)]">
						{t("deleteSessionHint")}
					</p>
				</Modal>
			) : null}
			{pendingFileConflicts ? (
				<Modal
					title={t("conflictTitle")}
					className="max-h-none w-[min(420px,100%)]"
					footerClassName="is-end"
					onClose={() => void handleFileConflictDecision(false)}
					footer={
						<>
							<Button variant="outline" type="button" onClick={() => void handleFileConflictDecision(false)}>
								{t("skipAll")}
							</Button>
							<Button variant="primary" type="button" onClick={() => void handleFileConflictDecision(true)}>
								{t("replaceAll")}
							</Button>
						</>
					}
				>
					<p className="mb-2 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)]">
						{pendingFileConflicts.names.slice(0, 4).join("、")}
						{pendingFileConflicts.names.length > 4
							? t("conflictNamesSuffix", { count: pendingFileConflicts.names.length })
							: ""}
					</p>
					<p className="m-0 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)]">
						{t("conflictHint")}
					</p>
				</Modal>
			) : null}
		</main>
	);
}
