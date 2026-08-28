import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultPackageManager,
	DefaultResourceLoader,
	ModelRuntime,
	type PackageSource,
	resolveModelScopeWithDiagnostics,
	SessionManager,
	SettingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { nativeImage, shell } from "electron";
import type {
	DesktopApiKeyProvider,
	DesktopAuthenticationPrompt,
	DesktopBranchPoint,
	DesktopExtensionEditorRequest,
	DesktopExtensionStatus,
	DesktopExtensionUiListener,
	DesktopExtensionWidget,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopModel,
	DesktopModelScope,
	DesktopModelScopeStatus,
	DesktopModelTestResult,
	DesktopPlugin,
	DesktopPluginPackage,
	DesktopPluginPackageFilterInput,
	DesktopProviderConfig,
	DesktopProviderModelConfig,
	DesktopRemoveWorktreeResult,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopSessionStats,
	DesktopSessionTreeNode,
	DesktopSkillInfo,
	DesktopSkillInstallInfo,
	DesktopSkillSearchResult,
	DesktopSkillUpdateResult,
	DesktopSnapshot,
	DesktopTranscriptBlock,
	DesktopTranscriptMessage,
	DesktopWorkspaceChange,
	DesktopWorkspaceDirectoryListing,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { expandSessionReferences } from "../shared/session-reference.ts";
import { AuthenticationPromptQueue } from "./authentication-prompt-queue.ts";
import { ExtensionCustomUiController, ExtensionDialogQueue } from "./extension-ui-controller.ts";
import {
	addGitWorktree as gitAddWorktree,
	fetchGitBranches as gitFetchBranches,
	getGitDiff as gitGetDiff,
	listGitBranches as gitListBranches,
	listGitChanges as gitListChanges,
	listGitWorktrees as gitListWorktrees,
	removeGitWorktree as gitRemoveWorktree,
	switchGitBranch as gitSwitchBranch,
	resolveGitProject,
} from "./git-integration.ts";
import {
	discoverModels as discoverModelsFromUrl,
	lookupModelCatalog,
	mergeModelsConfig,
	modelsJsonPathFor,
	readModelsConfig,
	writeModelsConfig,
} from "./models-config-store.ts";
import { SecurityAuditLog } from "./security-audit-log.ts";
import { listIndexedSessions } from "./session-index.ts";
import {
	checkSkillUpdate,
	installSkill,
	listSkillsDetailed,
	searchSkills,
	toggleSkillFile,
	updateSkillViaNpx,
} from "./skills-service.ts";
import { ToolApprovalQueue } from "./tool-approval-queue.ts";
import { TrustedWorkspaceBrowser } from "./trusted-workspace-browser.ts";
import { getWorkspaceKey, WorkspaceTrustStore } from "./workspace-trust-store.ts";
import { WorkspaceWatcher } from "./workspace-watcher.ts";

type SnapshotListener = (snapshot: DesktopSnapshot) => void;

interface ExtensionDialogOptions {
	signal?: AbortSignal;
	timeout?: number;
}

interface ManagedSession {
	id: string;
	lifecycleId: string;
	session: AgentSession;
	settingsManager: SettingsManager;
	cwd: string;
	workspacePath?: string;
	sessionDirectory: string;
	projectTrusted: boolean;
	unsubscribe: () => void;
	error?: string;
	modelScope?: DesktopModelScopeStatus;
	extensionStatuses: DesktopExtensionStatus[];
	extensionWidgets: DesktopExtensionWidget[];
	extensionCustomUi: ExtensionCustomUiController;
	extensionEditorRequest?: DesktopExtensionEditorRequest;
	extensionNotice?: string;
	autoRetryState?: { attempt: number; maxAttempts: number; errorMessage: string };
	lastCompaction?: { reason: string; tokensBefore: number; tokensAfter?: number };
	runningToolNames: Set<string>;
	lastUsedAt: number;
}

type PiSessionTreeNode = ReturnType<SessionManager["getTree"]>[number];

function summarizeSessionEntry(entry: PiSessionTreeNode["entry"]): {
	role?: string;
	text?: string;
} {
	if (entry.type === "message") {
		const message = entry.message as unknown as { role?: unknown; content?: unknown };
		const role = typeof message.role === "string" ? message.role : undefined;
		const content = message.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter(
								(item): item is Record<string, unknown> =>
									typeof item === "object" && item !== null && !Array.isArray(item),
							)
							.filter((item) => item.type === "text" && typeof item.text === "string")
							.map((item) => item.text as string)
							.join(" ")
					: "";
		return {
			...(role ? { role } : {}),
			...(text ? { text: text.slice(0, 200) } : {}),
		};
	}
	const record = entry as unknown as Record<string, unknown>;
	const text =
		typeof record.summary === "string"
			? record.summary
			: typeof record.label === "string"
				? record.label
				: typeof record.name === "string"
					? record.name
					: typeof record.modelId === "string"
						? `${typeof record.provider === "string" ? record.provider : ""}/${record.modelId}`
						: typeof record.thinkingLevel === "string"
							? record.thinkingLevel
							: "";
	return text ? { text: text.slice(0, 200) } : {};
}

function toDesktopSessionTreeNode(node: PiSessionTreeNode): DesktopSessionTreeNode {
	const details = summarizeSessionEntry(node.entry);
	return {
		entry: {
			id: node.entry.id,
			type: node.entry.type,
			...(details.role ? { role: details.role } : {}),
			...(details.text ? { text: details.text } : {}),
		},
		children: node.children.map(toDesktopSessionTreeNode),
	};
}

class PlainTextTheme extends Theme {
	constructor() {
		super(
			{ thinkingXhigh: "", text: "" } as ConstructorParameters<typeof Theme>[0],
			{ selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
			"truecolor",
		);
	}

	override fg(...[, text]: Parameters<Theme["fg"]>): string {
		return text;
	}
	override bg(...[, text]: Parameters<Theme["bg"]>): string {
		return text;
	}
	override bold(text: string): string {
		return text;
	}
	override italic(text: string): string {
		return text;
	}
	override underline(text: string): string {
		return text;
	}
	override inverse(text: string): string {
		return text;
	}
	override strikethrough(text: string): string {
		return text;
	}
	override getFgAnsi(): string {
		return "";
	}
	override getBgAnsi(): string {
		return "";
	}
	override getThinkingBorderColor(): (text: string) => string {
		return (text) => text;
	}
	override getBashModeBorderColor(): (text: string) => string {
		return (text) => text;
	}
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new KeybindingsManager(TUI_KEYBINDINGS);

const DESKTOP_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export interface DesktopPromptImage {
	data: string;
	mimeType: string;
}

function toMessageRole(value: unknown): DesktopTranscriptMessage["role"] {
	if (value === "assistant" || value === "custom" || value === "user") return value;
	if (value === "toolResult" || value === "bashExecution") return "tool";
	return "system";
}

function decodeImageBlock(block: Record<string, unknown>): { data: string; mimeType: string } | undefined {
	let data: string | undefined;
	let mimeType: string | undefined;
	const source = block.source;
	if (typeof source === "object" && source !== null && !Array.isArray(source)) {
		const sourceRecord = source as Record<string, unknown>;
		if (
			sourceRecord.type === "base64" &&
			typeof sourceRecord.data === "string" &&
			typeof sourceRecord.media_type === "string"
		) {
			data = sourceRecord.data;
			mimeType = sourceRecord.media_type;
		}
	}
	if (!data && typeof block.data === "string") {
		data = block.data;
		mimeType = typeof block.mimeType === "string" ? block.mimeType : undefined;
	}
	if (!data || !mimeType?.startsWith("image/") || data.length > 16_000_000) return undefined;
	return { data, mimeType };
}

function imageThumbnailDataUrl(block: Record<string, unknown>): string | undefined {
	const decoded = decodeImageBlock(block);
	if (!decoded) return undefined;
	try {
		const image = nativeImage.createFromBuffer(Buffer.from(decoded.data, "base64"));
		if (image.isEmpty()) return undefined;
		return image.resize({ width: 240, height: 240, quality: "good" }).toDataURL();
	} catch {
		return undefined;
	}
}

function contentToBlocks(value: unknown): DesktopTranscriptBlock[] {
	if (typeof value === "string") return [{ type: "text", text: value }];
	if (!Array.isArray(value)) return [];

	const blocks: DesktopTranscriptBlock[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const block = item as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
			continue;
		}
		if (block.type === "thinking" && typeof block.thinking === "string") {
			blocks.push({ type: "thinking", text: block.thinking });
			continue;
		}
		if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
			blocks.push({
				type: "toolCall",
				id: block.id,
				name: block.name,
				input: JSON.stringify(block.arguments ?? {}, null, 2),
			});
			continue;
		}
		if (block.type === "image") {
			const thumbnailDataUrl = imageThumbnailDataUrl(block);
			blocks.push({ type: "image", label: "图片附件", ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}) });
		}
	}
	return blocks;
}

function blocksToText(blocks: DesktopTranscriptBlock[]): string {
	return blocks
		.map((block) =>
			block.type === "text" || block.type === "thinking"
				? block.text
				: block.type === "toolCall"
					? `工具调用：${block.name}`
					: "",
		)
		.filter(Boolean)
		.join("\n");
}

function toTranscriptMessage(message: unknown, index: number): DesktopTranscriptMessage {
	if (typeof message !== "object" || message === null || Array.isArray(message)) {
		return { id: String(index), role: "system", text: "不支持的会话消息" };
	}

	const value = message as Record<string, unknown>;
	const timestamp = typeof value.timestamp === "number" ? value.timestamp : undefined;
	const role = toMessageRole(value.role);
	const blocks = contentToBlocks(value.content);
	const text =
		value.role === "bashExecution" && typeof value.output === "string" ? value.output : blocksToText(blocks);
	const usage = (() => {
		if (role !== "assistant" || typeof value.usage !== "object" || value.usage === null) return undefined;
		const usageValue = value.usage as Record<string, unknown>;
		const cost =
			typeof usageValue.cost === "object" && usageValue.cost !== null
				? (usageValue.cost as Record<string, unknown>)
				: undefined;
		const numberOr = (input: unknown): number => (typeof input === "number" && Number.isFinite(input) ? input : 0);
		return {
			input: numberOr(usageValue.input),
			output: numberOr(usageValue.output),
			cacheRead: numberOr(usageValue.cacheRead),
			cacheWrite: numberOr(usageValue.cacheWrite),
			cost: numberOr(cost?.total),
		};
	})();
	return {
		id: `${index}:${timestamp ?? ""}`,
		role,
		text,
		...(blocks.length === 0 ? {} : { blocks }),
		...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
		...(typeof value.toolCallId === "string" ? { toolCallId: value.toolCallId } : {}),
		...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
		...(typeof value.command === "string" ? { command: value.command } : {}),
		...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
		...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
		...(typeof value.stopReason === "string" ? { stopReason: value.stopReason } : {}),
		...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
		...(typeof value.customType === "string" ? { customType: value.customType } : {}),
		...(typeof value.display === "string" ? { display: value.display } : {}),
		...(typeof value.details === "string" ? { details: value.details } : {}),
		...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
		...(value.truncated === true && typeof value.fullOutputPath === "string" ? { fullOutputAvailable: true } : {}),
		...(timestamp === undefined ? {} : { timestamp }),
		...(usage ? { usage } : {}),
	};
}

function toPhase(session: AgentSession, error: string | undefined): DesktopSessionPhase {
	if (error !== undefined) return "error";
	return session.isStreaming ? "running" : "idle";
}

export class DesktopAgentHost {
	private readonly agentDir: string;
	private readonly approvalQueue: ToolApprovalQueue;
	private readonly authenticationPromptQueue: AuthenticationPromptQueue;
	private readonly trustStore: WorkspaceTrustStore;
	private readonly auditLog: SecurityAuditLog;
	private workspaceChangeQueue: Promise<void> = Promise.resolve();
	private readonly managedSessions = new Map<string, ManagedSession>();
	private activeSessionId: string | undefined;
	private session: AgentSession | undefined;
	private modelRuntime: ModelRuntime | undefined;
	private modelRuntimeInitialization: Promise<ModelRuntime> | undefined;
	private settingsManager: SettingsManager | undefined;
	private workspacePath: string | undefined;
	private sessionDirectory: string | undefined;
	private projectTrusted = false;
	private sessions: DesktopSessionInfo[] = [];
	private workspaceSearchCache:
		| { workspacePath: string; query: string; expiresAt: number; entries: DesktopWorkspaceEntry[] }
		| undefined;
	private providerSetupInProgress = false;
	private authenticationController: AbortController | undefined;
	private authenticationNotice: string | undefined;
	private authenticationUrl: string | undefined;
	private authenticationUserCode: string | undefined;
	private authenticationExpiresAt: number | undefined;
	private error: string | undefined;
	private readonly listeners = new Set<SnapshotListener>();
	private readonly workspaceWatcher = new WorkspaceWatcher((changes) => {
		for (const listener of this.workspaceChangeListeners) listener(changes);
	});
	private readonly workspaceChangeListeners = new Set<(changes: DesktopWorkspaceChange[]) => void>();
	private readonly extensionUiListeners = new Set<DesktopExtensionUiListener>();
	private extensionStatuses: DesktopExtensionStatus[] = [];
	private extensionWidgets: DesktopExtensionWidget[] = [];
	private extensionEditorRequest: DesktopExtensionEditorRequest | undefined;
	private extensionEditorSequence = 0;
	private extensionNotice: string | undefined;
	private autoRetryState: { attempt: number; maxAttempts: number; errorMessage: string } | undefined;
	private lastCompaction: { reason: string; tokensBefore: number; tokensAfter?: number } | undefined;
	private runningToolNames = new Set<string>();
	private readonly extensionDialogQueue: ExtensionDialogQueue = new ExtensionDialogQueue((event) => {
		if (event.sessionId !== this.activeSessionId) return;
		for (const listener of this.extensionUiListeners) listener(event);
	});

	constructor(agentDir: string) {
		this.agentDir = agentDir;
		this.approvalQueue = new ToolApprovalQueue({ onChange: () => this.publish() });
		this.authenticationPromptQueue = new AuthenticationPromptQueue({ onChange: () => this.publish() });
		this.trustStore = new WorkspaceTrustStore(join(agentDir, "trusted-workspaces.json"));
		this.auditLog = new SecurityAuditLog(join(agentDir, "security-audit.jsonl"));
	}

	async initialize(): Promise<DesktopSnapshot> {
		try {
			await mkdir(this.agentDir, { recursive: true });
			if (!this.session) {
				await this.createSession({
					cwd: this.agentDir,
					projectTrusted: false,
					sessionDirectory: join(this.agentDir, "sessions", "default"),
				});
			}
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	getSnapshot(): DesktopSnapshot {
		const snapshot: DesktopSnapshot = {
			projectTrusted: this.projectTrusted,
			userHomeName: basename(homedir()),
			pendingToolApprovals: this.approvalQueue.getPendingApprovals(),
			pendingAuthenticationPrompts: this.authenticationPromptQueue.getPendingPrompts(),
			...(this.extensionStatuses.length ? { extensionStatuses: this.extensionStatuses } : {}),
			...(this.extensionWidgets.length ? { extensionWidgets: this.extensionWidgets } : {}),
			...(this.extensionEditorRequest ? { extensionEditorRequest: this.extensionEditorRequest } : {}),
			apiKeyProviders: this.getApiKeyProviders(),
			availableModels: this.getAvailableModels(),
			skills: this.getSkills(),
			plugins: this.getPlugins(),
			providerSetupInProgress: this.providerSetupInProgress,
			sessions: this.sessions,
		};
		if (this.authenticationNotice) snapshot.authenticationNotice = this.authenticationNotice;
		if (this.authenticationUrl) snapshot.authenticationUrl = this.authenticationUrl;
		if (this.authenticationUserCode) snapshot.authenticationUserCode = this.authenticationUserCode;
		if (this.authenticationExpiresAt) snapshot.authenticationExpiresAt = this.authenticationExpiresAt;
		if (this.workspacePath) snapshot.workspacePath = this.workspacePath;
		const activeManaged = this.activeSessionId ? this.managedSessions.get(this.activeSessionId) : undefined;
		if (activeManaged?.modelScope) snapshot.modelScope = activeManaged.modelScope;
		if (!this.session) {
			snapshot.notice = this.error ?? this.authenticationNotice ?? "正在准备本地智能体会话。";
			return snapshot;
		}

		const model = this.session.model;
		snapshot.notice =
			this.extensionNotice ??
			this.error ??
			this.authenticationNotice ??
			(this.projectTrusted
				? "项目资源已信任。每次工具调用仍需要单独确认。"
				: "未选择项目时，智能体可以对话，但不会读取文件或调用项目工具。");
		this.extensionNotice = undefined;
		snapshot.session = {
			id: this.session.sessionId,
			...(this.session.sessionName === undefined ? {} : { name: this.session.sessionName }),
			phase: toPhase(this.session, this.error),
			pendingMessages: [
				...this.session.getSteeringMessages().map((text) => ({ behavior: "steer" as const, text })),
				...this.session.getFollowUpMessages().map((text) => ({ behavior: "followUp" as const, text })),
			],
			...(model === undefined ? {} : { model: { provider: model.provider, id: model.id } }),
			thinkingLevel: this.session.thinkingLevel,
			availableThinkingLevels: this.session.getAvailableThinkingLevels(),
			isCompacting: this.session.isCompacting,
			systemPrompt: this.session.systemPrompt,
			...(this.autoRetryState ? { autoRetry: this.autoRetryState } : {}),
			...(this.lastCompaction ? { lastCompaction: this.lastCompaction } : {}),
			...(this.runningToolNames.size ? { runningTools: [...this.runningToolNames].slice(0, 4) } : {}),
			messages: (() => {
				const forkPoints = this.session?.getUserMessagesForForking() ?? [];
				let userIndex = 0;
				return (
					this.session?.messages.map((message, index) => {
						const transcript = toTranscriptMessage(message, index);
						if (transcript.role !== "user") return transcript;
						const forkEntryId = forkPoints[userIndex]?.entryId;
						userIndex += 1;
						return forkEntryId ? { ...transcript, forkEntryId } : transcript;
					}) ?? []
				);
			})(),
		};
		snapshot.sessionStats = this.toDesktopSessionStats();
		snapshot.branchPoints = this.toDesktopBranchPoints();
		snapshot.branchTree = this.session.sessionManager.getTree().map(toDesktopSessionTreeNode);
		snapshot.branchActiveLeafId = this.session.sessionManager.getLeafId();
		return snapshot;
	}

	private toDesktopBranchPoints(): DesktopBranchPoint[] {
		if (!this.session) return [];
		return this.session.getUserMessagesForForking().map((point) => ({
			entryId: point.entryId,
			text: point.text,
		}));
	}

	private toDesktopSessionStats(): DesktopSessionStats {
		const stats = this.session?.getSessionStats();
		if (!stats) {
			return {
				sessionId: this.session?.sessionId ?? "",
				userMessages: 0,
				assistantMessages: 0,
				toolCalls: 0,
				toolResults: 0,
				totalMessages: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				cost: 0,
			};
		}
		return {
			sessionId: stats.sessionId,
			userMessages: stats.userMessages,
			assistantMessages: stats.assistantMessages,
			toolCalls: stats.toolCalls,
			toolResults: stats.toolResults,
			totalMessages: stats.totalMessages,
			tokens: {
				input: stats.tokens.input,
				output: stats.tokens.output,
				cacheRead: stats.tokens.cacheRead,
				cacheWrite: stats.tokens.cacheWrite,
				total: stats.tokens.total,
			},
			cost: stats.cost,
			...(stats.contextUsage === undefined
				? {}
				: {
						contextUsage: {
							tokens: stats.contextUsage.tokens,
							contextWindow: stats.contextUsage.contextWindow,
							percent: stats.contextUsage.percent,
						},
					}),
		};
	}

	subscribe(listener: SnapshotListener): () => void {
		this.listeners.add(listener);
		listener(this.getSnapshot());
		return () => this.listeners.delete(listener);
	}

	respondToExtensionDialog(id: string, value: string): boolean {
		return this.extensionDialogQueue.resolve(id, value);
	}

	sendExtensionCustomInput(id: string, data: string): boolean {
		if (!this.activeSessionId) return false;
		return this.managedSessions.get(this.activeSessionId)?.extensionCustomUi.input(id, data) ?? false;
	}

	onExtensionUi(listener: DesktopExtensionUiListener): () => void {
		this.extensionUiListeners.add(listener);
		return () => this.extensionUiListeners.delete(listener);
	}

	onWorkspaceChanged(listener: (changes: DesktopWorkspaceChange[]) => void): () => void {
		this.workspaceChangeListeners.add(listener);
		return () => this.workspaceChangeListeners.delete(listener);
	}

	async openWorkspace(cwd: string): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再打开其他项目。");
		}
		return this.enqueueWorkspaceChange(() => this.openWorkspaceInternal(cwd));
	}

	private async openWorkspaceInternal(cwd: string): Promise<DesktopSnapshot> {
		try {
			const projectTrusted = await this.trustStore.isTrusted(cwd);
			const existing = [...this.managedSessions.values()]
				.filter((managed) => managed.workspacePath === cwd && managed.projectTrusted === projectTrusted)
				.sort((left, right) => right.lastUsedAt - left.lastUsedAt)[0];
			if (existing) {
				this.activateManagedSession(existing);
				await this.refreshSessions();
				return this.publish();
			}
			this.deactivateActiveSession();
			const workspaceKey = getWorkspaceKey(cwd);
			await this.createSession({
				cwd,
				projectTrusted,
				sessionDirectory: join(this.agentDir, "sessions", workspaceKey),
				workspacePath: cwd,
				resumeRecent: true,
			});
		} catch (error) {
			this.projectTrusted = false;
			this.error = error instanceof Error ? error.message : String(error);
		}

		return this.publish();
	}

	private async createSession(options: {
		cwd: string;
		projectTrusted: boolean;
		sessionDirectory: string;
		workspacePath?: string;
		sessionFile?: string;
		resumeRecent?: boolean;
	}): Promise<void> {
		const modelRuntimePromise = this.getModelRuntime();
		const lifecycleId = randomUUID();
		const sessionManager = options.sessionFile
			? SessionManager.open(options.sessionFile, options.sessionDirectory)
			: options.resumeRecent
				? SessionManager.continueRecent(options.cwd, options.sessionDirectory)
				: SessionManager.create(options.cwd, options.sessionDirectory);
		const settingsManager = SettingsManager.create(options.cwd, this.agentDir, {
			projectTrusted: options.projectTrusted,
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: options.cwd,
			agentDir: this.agentDir,
			settingsManager,
			noContextFiles: !options.projectTrusted,
			noExtensions: !options.projectTrusted,
			noPromptTemplates: !options.projectTrusted,
			noSkills: !options.projectTrusted,
			noThemes: !options.projectTrusted,
			extensionFactories: [
				{
					name: "desktop-tool-approval",
					hidden: true,
					factory: (pi) => {
						pi.on("tool_call", async (event) => {
							const approved = await this.approvalQueue.request(
								{
									toolCallId: event.toolCallId,
									toolName: event.toolName,
									input: event.input,
								},
								lifecycleId,
							);
							return approved
								? undefined
								: { block: true, reason: "Desktop user denied this tool call.", terminate: true };
						});
					},
				},
			],
		});
		await resourceLoader.reload();
		const modelRuntime = await modelRuntimePromise;
		const modelScope = await this.resolveModelScope(settingsManager, modelRuntime);
		const created = await createAgentSession({
			cwd: options.cwd,
			agentDir: this.agentDir,
			modelRuntime,
			...(modelScope.scopedModels.length ? { scopedModels: modelScope.scopedModels } : {}),
			...(options.projectTrusted ? { tools: [...DESKTOP_TOOL_NAMES] } : { noTools: "all" }),
			resourceLoader,
			settingsManager,
			sessionManager,
		});

		const statuses = new Map<string, string>();
		const managed: ManagedSession = {
			id: created.session.sessionId,
			lifecycleId,
			session: created.session,
			settingsManager,
			cwd: options.cwd,
			...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
			sessionDirectory: options.sessionDirectory,
			projectTrusted: options.projectTrusted,
			unsubscribe: () => undefined,
			...(created.modelFallbackMessage ? { error: "没有可用模型。请在设置中配置模型服务商。" } : {}),
			modelScope:
				modelScope.patterns.length > 0
					? {
							patterns: modelScope.patterns,
							warnings: modelScope.warnings,
							matched: modelScope.scopedModels.length,
							fixedLevels: modelScope.fixedLevels,
						}
					: undefined,
			extensionStatuses: [],
			extensionWidgets: [],
			extensionCustomUi: new ExtensionCustomUiController(
				created.session.sessionId,
				(event) => {
					if (event.sessionId !== this.activeSessionId) return;
					for (const listener of this.extensionUiListeners) listener(event);
				},
				PLAIN_TEXT_THEME,
				CUSTOM_UI_KEYBINDINGS,
			),
			runningToolNames: new Set<string>(),
			lastUsedAt: Date.now(),
		};
		const partialUiContext = {
			select: async (title: string, dialogOptions: string[], opts?: ExtensionDialogOptions) => {
				const value = await this.extensionDialogQueue.request(
					managed.id,
					{
						kind: "select",
						title,
						options: dialogOptions ?? [],
					},
					opts,
				);
				return value || undefined;
			},
			confirm: async (title: string, message: string, opts?: ExtensionDialogOptions) => {
				const value = await this.extensionDialogQueue.request(
					managed.id,
					{ kind: "confirm", title, message },
					opts,
				);
				return value === "confirm";
			},
			input: async (title: string, placeholder?: string, opts?: ExtensionDialogOptions) => {
				const value = await this.extensionDialogQueue.request(
					managed.id,
					{
						kind: "input",
						title,
						...(placeholder ? { placeholder } : {}),
					},
					opts,
				);
				return value || undefined;
			},
			editor: async (title: string, prefill?: string, opts?: ExtensionDialogOptions) => {
				const value = await this.extensionDialogQueue.request(
					managed.id,
					{
						kind: "editor",
						title,
						...(prefill ? { prefill } : {}),
					},
					opts,
				);
				return value || undefined;
			},
			notify: (message: string, type?: "info" | "warning" | "error") => {
				managed.extensionNotice = `${type === "error" ? "错误" : type === "warning" ? "警告" : "提示"}：${message}`;
				if (this.activeSessionId === managed.id) this.extensionNotice = managed.extensionNotice;
				this.publish();
			},
			setStatus: (key: string, text: string | undefined) => {
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
				managed.extensionStatuses = [...statuses.entries()].map(([statusKey, statusText]) => ({
					key: statusKey,
					text: statusText,
				}));
				if (this.activeSessionId === managed.id) this.extensionStatuses = managed.extensionStatuses;
				this.publish();
			},
			setWidget: (
				key: string,
				content: string[] | unknown | undefined,
				options?: { placement?: "aboveEditor" | "belowEditor" },
			) => {
				const widgets = new Map(managed.extensionWidgets.map((widget) => [widget.key, widget]));
				if (Array.isArray(content) && content.every((line) => typeof line === "string")) {
					widgets.set(key, {
						key,
						lines: content.slice(0, 100),
						placement: options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor",
					});
				} else if (content === undefined) {
					widgets.delete(key);
				}
				managed.extensionWidgets = [...widgets.values()];
				if (this.activeSessionId === managed.id) this.extensionWidgets = managed.extensionWidgets;
				this.publish();
			},
			setTitle: (title: string) => {
				managed.extensionNotice = title;
				if (this.activeSessionId === managed.id) this.extensionNotice = title;
				this.publish();
			},
			custom: <T = unknown>(factory: unknown, options?: unknown) =>
				managed.extensionCustomUi.request<T>(factory, options),
			pasteToEditor: (text: string) => {
				managed.extensionEditorRequest = { id: ++this.extensionEditorSequence, text, mode: "insert" };
				if (this.activeSessionId === managed.id) this.extensionEditorRequest = managed.extensionEditorRequest;
				this.publish();
			},
			setEditorText: (text: string) => {
				managed.extensionEditorRequest = { id: ++this.extensionEditorSequence, text, mode: "replace" };
				if (this.activeSessionId === managed.id) this.extensionEditorRequest = managed.extensionEditorRequest;
				this.publish();
			},
			getEditorText: () => "",
			addAutocompleteProvider: () => undefined,
			setEditorComponent: () => undefined,
			getEditorComponent: () => undefined,
			get theme() {
				return PLAIN_TEXT_THEME;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Electron 扩展界面暂不支持切换主题。" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => undefined,
		};
		try {
			created.session.extensionRunner.setUIContext(
				partialUiContext as unknown as Parameters<typeof created.session.extensionRunner.setUIContext>[0],
				"rpc",
			);
		} catch {
			// UI 桥不可用时扩展交互静默降级。
		}

		if (
			!options.sessionFile &&
			created.session.messages.length === 0 &&
			!created.modelFallbackMessage &&
			created.session.model
		) {
			const currentModel = created.session.model;
			const scoped = modelScope.scopedModels.find(
				(entry) => entry.model.provider === currentModel.provider && entry.model.id === currentModel.id,
			);
			if (scoped?.thinkingLevel) created.session.setThinkingLevel(scoped.thinkingLevel);
		}

		managed.unsubscribe = created.session.subscribe((event: unknown) => {
			const typed = event as { type?: string; [key: string]: unknown };
			if (typed.type === "auto_retry_start") {
				managed.autoRetryState = {
					attempt: typeof typed.attempt === "number" ? typed.attempt : 0,
					maxAttempts: typeof typed.maxAttempts === "number" ? typed.maxAttempts : 0,
					errorMessage: typeof typed.errorMessage === "string" ? typed.errorMessage : "未知错误",
				};
			} else if (typed.type === "auto_retry_end") {
				managed.autoRetryState = undefined;
			} else if (typed.type === "tool_execution_start" && typeof typed.toolName === "string") {
				managed.runningToolNames.add(typed.toolName);
			} else if (typed.type === "tool_execution_end" && typeof typed.toolName === "string") {
				managed.runningToolNames.delete(typed.toolName);
			} else if (typed.type === "compaction_end") {
				const result = typed.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown } | undefined;
				managed.lastCompaction = {
					reason: typeof typed.reason === "string" ? typed.reason : "manual",
					tokensBefore: typeof result?.tokensBefore === "number" ? result.tokensBefore : 0,
					...(typeof result?.estimatedTokensAfter === "number"
						? { tokensAfter: result.estimatedTokensAfter }
						: {}),
				};
			}
			if (this.activeSessionId === managed.id) this.applyManagedSessionState(managed);
			const managedPath = managed.session.sessionManager.getSessionFile();
			if (managedPath) {
				this.sessions = this.sessions.map((info) =>
					resolve(info.path) === resolve(managedPath)
						? { ...info, phase: toPhase(managed.session, managed.error) }
						: info,
				);
			}
			this.publish();
		});
		this.managedSessions.set(managed.id, managed);
		this.activateManagedSession(managed);
		await this.refreshSessions();
	}

	async prompt(
		text: string,
		images: DesktopPromptImage[] = [],
		streamingBehavior?: "steer" | "followUp",
		sessionReferenceLabels: readonly string[] = [],
	): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再发送消息。");
		}
		if (!this.session) {
			throw new Error("请先选择项目，再发送消息。");
		}
		const managed = this.activeSessionId ? this.managedSessions.get(this.activeSessionId) : undefined;
		if (!managed) throw new Error("当前智能体会话未注册。");
		const session = managed.session;

		if (session.sessionName === undefined) {
			const trimmed = text.trim().replace(/\s+/gu, " ");
			if (trimmed) {
				const name = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
				session.sessionManager.appendSessionInfo(name);
			}
		}

		if (session.isStreaming && streamingBehavior === undefined) {
			throw new Error("智能体运行中，请选择立即引导或排队跟进。");
		}
		if (session.isStreaming && images.length > 0) {
			throw new Error("智能体运行中不能在引导或排队消息中附加图片。");
		}

		managed.error = undefined;
		if (this.activeSessionId === managed.id) this.error = undefined;
		try {
			await session.prompt(this.resolveSessionReferences(text, sessionReferenceLabels), {
				images: images.map((image) => ({ ...image, type: "image" as const })),
				source: "interactive",
				...(streamingBehavior === undefined ? {} : { streamingBehavior }),
			});
		} catch (error) {
			managed.error = error instanceof Error ? error.message : String(error);
			if (this.activeSessionId === managed.id) this.error = managed.error;
		}
		await this.refreshSessions();
		return this.publish();
	}

	private resolveSessionReferences(text: string, confirmedLabels: readonly string[]): string {
		return expandSessionReferences(text, {
			candidates: this.sessions.map((info) => ({
				label: info.name ?? info.firstMessage.slice(0, 40),
				path: info.path,
			})),
			load: (sessionPath) => {
				const indexed = this.sessions.find((info) => resolve(info.path) === resolve(sessionPath));
				if (!indexed) return "";
				const sessionsRoot = resolve(join(this.agentDir, "sessions"));
				const resolvedPath = resolve(indexed.path);
				if (!resolvedPath.startsWith(sessionsRoot + sep) || !resolvedPath.endsWith(".jsonl")) return "";
				try {
					const manager = SessionManager.open(resolvedPath, dirname(resolvedPath));
					return manager
						.buildSessionContext()
						.messages.map((message, index) => {
							const transcript = toTranscriptMessage(message, index);
							return `[${transcript.role.toUpperCase()}]\n${transcript.text}`;
						})
						.join("\n\n")
						.replaceAll("</session_reference>", "&lt;/session_reference&gt;");
				} catch {
					return "";
				}
			},
			confirmedLabels,
		});
	}

	async abort(): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (!this.session.isStreaming && !this.session.isCompacting) return this.getSnapshot();
		const managed = this.activeSessionId ? this.managedSessions.get(this.activeSessionId) : undefined;
		if (managed) this.approvalQueue.cancelGroup(managed.lifecycleId);
		await this.session.abort();
		return this.publish();
	}

	async openSession(sessionPath: string): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再切换会话。");
		}
		return this.enqueueWorkspaceChange(() => this.switchSession({ sessionFile: sessionPath }));
	}

	async newSession(): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再新建会话。");
		}
		return this.enqueueWorkspaceChange(() => this.switchSession({}));
	}

	async navigateTree(entryId: string): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再切换分支。");
		}
		if (!this.session) {
			throw new Error("本地智能体会话尚未就绪。");
		}
		if (this.session.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再切换分支。");
		}
		this.error = undefined;
		try {
			await this.session.navigateTree(entryId);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async forkSession(): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再 Fork 会话。");
		}
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再 Fork 会话。");
		}
		return this.enqueueWorkspaceChange(() => this.forkSessionInternal());
	}

	private async forkSessionInternal(): Promise<DesktopSnapshot> {
		const workspacePath = this.workspacePath;
		const projectTrusted = this.projectTrusted;
		const sessionDirectory = this.sessionDirectory;
		const sourceFile = this.session?.sessionManager.getSessionFile();
		if (!workspacePath || !sessionDirectory || !sourceFile) {
			throw new Error("请先选择项目并打开会话，再 Fork。");
		}

		const forked = SessionManager.forkFrom(sourceFile, workspacePath, sessionDirectory);
		this.deactivateActiveSession();
		try {
			await this.createSession({
				cwd: workspacePath,
				projectTrusted,
				sessionDirectory,
				workspacePath,
				sessionFile: forked.getSessionFile(),
			});
		} catch (error) {
			this.projectTrusted = projectTrusted;
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	private async switchSession(options: { sessionFile?: string }): Promise<DesktopSnapshot> {
		let workspacePath = this.workspacePath;
		let projectTrusted = this.projectTrusted;
		let sessionDirectory = this.sessionDirectory;

		let sessionFile: string | undefined;
		if (options.sessionFile) {
			const resolvedFile = resolve(options.sessionFile);
			const existing = this.findManagedSessionByPath(resolvedFile);
			if (existing) {
				this.activateManagedSession(existing);
				await this.refreshSessions();
				return this.publish();
			}
			const indexed = this.sessions.find((item) => resolve(item.path) === resolvedFile);
			if (!indexed) throw new Error("只能打开已索引的项目会话。");
			workspacePath = indexed.cwd;
			sessionDirectory = dirname(resolvedFile);
			const expectedDirectory = resolve(join(this.agentDir, "sessions", getWorkspaceKey(workspacePath)));
			if (
				resolve(sessionDirectory) !== expectedDirectory ||
				!resolvedFile.startsWith(expectedDirectory + sep) ||
				!resolvedFile.endsWith(".jsonl")
			) {
				throw new Error("无效的会话文件。");
			}
			projectTrusted = await this.trustStore.isTrusted(workspacePath);
			sessionFile = resolvedFile;
		}
		if (!workspacePath || !sessionDirectory) {
			throw new Error("请先选择项目，再管理会话。");
		}

		this.deactivateActiveSession();
		try {
			await this.createSession({
				cwd: workspacePath,
				projectTrusted,
				sessionDirectory,
				workspacePath,
				...(sessionFile ? { sessionFile } : {}),
			});
		} catch (error) {
			this.projectTrusted = projectTrusted;
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async setModel(providerId: string, modelId: string): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (this.session.isStreaming) throw new Error("请等待当前智能体任务完成后，再切换模型。");

		const modelRuntime = await this.getModelRuntime();
		const selectableModels = this.session.scopedModels.length
			? this.session.scopedModels.map((scoped) => scoped.model)
			: modelRuntime.getAvailableSnapshot();
		const model = selectableModels.find((candidate) => {
			return candidate.provider === providerId && candidate.id === modelId;
		});
		if (!model) throw new Error("该模型不可用。请先检查服务商认证信息。");

		this.error = undefined;
		try {
			await this.session.setModel(model, { persist: true });
			const scoped = this.session.scopedModels.find(
				(entry) => entry.model.provider === providerId && entry.model.id === modelId,
			);
			if (scoped?.thinkingLevel) this.session.setThinkingLevel(scoped.thinkingLevel, { persist: true });
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async setThinkingLevel(
		level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (this.session.isStreaming) throw new Error("请等待当前智能体任务完成后，再调整思考级别。");
		if (level !== "auto") this.session.setThinkingLevel(level as Exclude<typeof level, "auto">, { persist: true });
		return this.publish();
	}

	async compact(customInstructions?: string): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (this.session.isStreaming) throw new Error("请等待当前智能体任务完成后，再压缩上下文。");
		this.error = undefined;
		try {
			await this.session.compact(customInstructions?.trim() || undefined);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async autoNameSession(): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (this.session.isStreaming) throw new Error("请等待当前智能体任务完成后再生成标题。");
		const model = this.session.model;
		if (!model) throw new Error("请先配置并选择模型，再生成标题。");
		const messages = this.session.messages;
		const firstUser = [...messages]
			.map((message, index) => toTranscriptMessage(message, index))
			.find((message) => message.role === "user" && message.text.trim());
		if (!firstUser) throw new Error("会话还没有消息，先发送一条消息再生成标题。");
		const excerpt = firstUser.text.trim().slice(0, 500);
		const modelRuntime = await this.getModelRuntime();
		this.error = undefined;
		try {
			const reply = await modelRuntime.completeSimple(model, {
				systemPrompt:
					"You generate concise chat session titles. Reply with the title only: no quotes, no punctuation at the end, at most 4 words, same language as the input.",
				messages: [
					{
						role: "user",
						timestamp: Date.now(),
						content: `Generate a session title (max 4 words, same language) for a conversation starting with:\n\n${excerpt}`,
					},
				],
			});
			const text = reply.content
				.filter((block): block is { type: "text"; text: string } => block.type === "text")
				.map((block) => block.text)
				.join(" ")
				.replace(/^["'“”\s]+|["'“”\s.。]+$/gu, "")
				.slice(0, 60)
				.trim();
			if (!text) throw new Error("模型没有返回有效标题。");
			this.session.setSessionName(text);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async renameSession(sessionPath: string, name: string): Promise<DesktopSnapshot> {
		const realPath = resolve(sessionPath);
		const indexed = this.sessions.find((info) => resolve(info.path) === realPath);
		if (!indexed) throw new Error("只能重命名已索引的项目会话。");
		const directory = resolve(join(this.agentDir, "sessions", getWorkspaceKey(indexed.cwd)));
		if (!realPath.startsWith(directory + sep) || !realPath.endsWith(".jsonl")) {
			throw new Error("无效的会话文件。");
		}
		const trimmed = name.trim().slice(0, 120);
		if (!trimmed) throw new Error("会话名称不能为空。");
		const managed = this.findManagedSessionByPath(realPath);
		if (managed) managed.session.setSessionName(trimmed);
		else SessionManager.open(realPath, directory).appendSessionInfo(trimmed);
		await this.refreshSessions();
		return this.publish();
	}

	async deleteSession(sessionPath: string): Promise<DesktopSnapshot> {
		const realPath = resolve(sessionPath);
		const indexed = this.sessions.find((info) => resolve(info.path) === realPath);
		if (!indexed) throw new Error("只能删除已索引的项目会话。");
		const directory = resolve(join(this.agentDir, "sessions", getWorkspaceKey(indexed.cwd)));
		if (!realPath.startsWith(directory + sep) || !realPath.endsWith(".jsonl")) throw new Error("无效的会话文件。");
		const managed = this.findManagedSessionByPath(realPath);
		if (managed?.session.isStreaming) throw new Error("请等待该智能体任务完成后再删除会话。");
		const wasActive = managed !== undefined && managed.id === this.activeSessionId;
		const projectTrusted = managed?.projectTrusted ?? (await this.trustStore.isTrusted(indexed.cwd));
		if (managed) this.disposeManagedSession(managed);
		await unlink(realPath);
		this.auditLog.write("workspace.trust", "denied", { deletedSession: basename(realPath) });
		await this.refreshSessions();
		if (wasActive) {
			await this.createSession({
				cwd: indexed.cwd,
				projectTrusted,
				sessionDirectory: directory,
				workspacePath: indexed.cwd,
			});
		}
		return this.publish();
	}

	async executeBashCommand(command: string, excludeFromContext: boolean): Promise<string> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		const result = await this.session.executeBash(command, undefined, { excludeFromContext });
		if (result.exitCode !== 0 && !result.output) {
			throw new Error(`命令退出码 ${result.exitCode ?? "未知"}`);
		}
		return result.output;
	}

	async copyLastAnswer(): Promise<string> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		const last = [...this.session.messages].reverse().find((message) => message.role === "assistant");
		if (!last) throw new Error("还没有可复制的回答。");
		const transcript = toTranscriptMessage(last, 0);
		const { clipboard } = await import("electron");
		clipboard.writeText(transcript.text);
		return transcript.text;
	}

	async setProjectTrust(trusted: boolean): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再更改项目权限。");
		}
		return this.enqueueWorkspaceChange(async () => {
			if (!this.workspacePath) {
				throw new Error("请先选择项目，再更改项目权限。");
			}
			if (
				[...this.managedSessions.values()].some(
					(managed) => managed.workspacePath === this.workspacePath && managed.session.isStreaming,
				)
			) {
				throw new Error("请等待当前智能体任务完成后，再更改项目权限。");
			}

			const workspacePath = this.workspacePath;
			try {
				await this.trustStore.setTrusted(workspacePath, trusted);
				this.auditLog.write("workspace.trust", trusted ? "allowed" : "denied", {
					workspaceKey: getWorkspaceKey(workspacePath),
				});
				this.disposeWorkspaceSessions(workspacePath);
				return await this.openWorkspaceInternal(workspacePath);
			} catch (error) {
				this.error = error instanceof Error ? error.message : String(error);
				return this.publish();
			}
		});
	}

	decideToolApproval(id: string, approved: boolean): DesktopSnapshot {
		const approval = this.approvalQueue.getPendingApprovals().find((item) => item.id === id);
		if (!this.approvalQueue.resolve(id, approved)) {
			throw new Error("This tool approval request is no longer pending.");
		}
		this.auditLog.write("tool.approval", approved ? "allowed" : "denied", {
			...(approval ? { toolName: approval.toolName } : {}),
		});
		return this.getSnapshot();
	}

	async startProviderSetup(providerId: string, authType: "api_key" | "oauth"): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再更改模型认证信息。");
		}
		if (this.providerSetupInProgress) {
			throw new Error("已有模型服务商配置正在进行中。");
		}

		const modelRuntime = await this.getModelRuntime();
		const provider = modelRuntime.getProviders().find((candidate) => candidate.id === providerId);
		const auth = authType === "oauth" ? provider?.auth.oauth : provider?.auth.apiKey;
		if (!auth?.login) {
			throw new Error(authType === "oauth" ? "该模型服务商不支持 OAuth 登录。" : "该模型服务商不支持配置 API Key。");
		}
		const workspacePath = this.workspacePath;
		const controller = new AbortController();
		this.providerSetupInProgress = true;
		this.authenticationController = controller;
		this.authenticationNotice = undefined;
		this.authenticationUrl = undefined;
		this.authenticationUserCode = undefined;
		this.authenticationExpiresAt = undefined;
		this.error = undefined;
		this.publish();

		try {
			await modelRuntime.login(providerId, authType, {
				signal: controller.signal,
				prompt: async (prompt) => {
					return this.authenticationPromptQueue.request(this.toDesktopAuthenticationPrompt(prompt), prompt.signal);
				},
				notify: (event) => {
					if (event.type === "auth_url") {
						this.authenticationUrl = event.url;
						this.authenticationUserCode = undefined;
						this.authenticationExpiresAt = undefined;
						void shell.openExternal(event.url).catch((error: unknown) => {
							this.error = error instanceof Error ? error.message : "无法打开 OAuth 登录页面。";
							this.publish();
						});
					}
					if (event.type === "device_code") {
						this.authenticationUrl = event.verificationUri;
						this.authenticationUserCode = event.userCode;
						const expiresInSeconds =
							"expiresInSeconds" in event &&
							typeof event.expiresInSeconds === "number" &&
							Number.isFinite(event.expiresInSeconds) &&
							event.expiresInSeconds > 0
								? event.expiresInSeconds
								: undefined;
						this.authenticationExpiresAt =
							expiresInSeconds === undefined ? undefined : Date.now() + expiresInSeconds * 1000;
					} else if (event.type !== "auth_url") {
						this.authenticationUrl = undefined;
						this.authenticationUserCode = undefined;
						this.authenticationExpiresAt = undefined;
					}
					this.authenticationNotice =
						event.type === "auth_url"
							? (event.instructions ?? "请在浏览器窗口中完成模型服务商登录。")
							: event.type === "device_code"
								? `请在打开的验证页面输入验证码：${event.userCode}`
								: event.message;
					this.publish();
				},
			});
			await modelRuntime.refresh({ allowNetwork: true, signal: controller.signal });
			this.auditLog.write("credential.configure", "succeeded", { providerId, authType });
			if (!workspacePath) return this.publish();
			return await this.enqueueWorkspaceChange(() => this.openWorkspaceInternal(workspacePath));
		} catch (error) {
			if (controller.signal.aborted) {
				this.error = undefined;
				return this.publish();
			}
			this.auditLog.write("credential.configure", "failed", { providerId, authType });
			this.error = error instanceof Error ? error.message : "模型服务商配置失败，请检查填写内容后重试。";
			return this.publish();
		} finally {
			this.authenticationPromptQueue.cancelAll();
			if (this.authenticationController === controller) {
				this.authenticationController = undefined;
			}
			this.authenticationNotice = undefined;
			this.authenticationUrl = undefined;
			this.authenticationUserCode = undefined;
			this.authenticationExpiresAt = undefined;
			this.providerSetupInProgress = false;
			this.publish();
		}
	}

	cancelProviderSetup(): DesktopSnapshot {
		this.authenticationController?.abort();
		this.authenticationPromptQueue.cancelAll();
		return this.publish();
	}

	async logoutProvider(providerId: string): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再断开模型服务商。");
		const modelRuntime = await this.getModelRuntime();
		await modelRuntime.logout(providerId);
		await modelRuntime.refresh({ allowNetwork: false });
		this.auditLog.write("credential.logout", "succeeded", { providerId });
		return this.publish();
	}

	respondToAuthenticationPrompt(id: string, response: string): DesktopSnapshot {
		if (!this.authenticationPromptQueue.resolve(id, response)) {
			throw new Error("该认证请求已失效。");
		}
		return this.getSnapshot();
	}

	async listWorkspaceFiles(): Promise<DesktopWorkspaceEntry[]> {
		return this.getTrustedWorkspaceBrowser().list();
	}

	async listWorkspaceDirectory(path?: string): Promise<DesktopWorkspaceDirectoryListing> {
		return this.getTrustedWorkspaceBrowser().listDirectory(path ?? "");
	}

	async searchWorkspaceFiles(query: string): Promise<DesktopWorkspaceEntry[]> {
		const workspacePath = this.workspacePath;
		if (!workspacePath) throw new Error("请先选择项目，再搜索文件。");
		const normalizedQuery = query.trim().slice(0, 200).toLocaleLowerCase();
		const cached = this.workspaceSearchCache;
		if (
			cached &&
			cached.workspacePath === workspacePath &&
			cached.query === normalizedQuery &&
			cached.expiresAt > Date.now()
		) {
			return cached.entries;
		}
		const entries = await this.getTrustedWorkspaceBrowser().search(normalizedQuery);
		this.workspaceSearchCache = { workspacePath, query: normalizedQuery, expiresAt: Date.now() + 10_000, entries };
		return entries;
	}

	async readWorkspaceFile(path: string): Promise<DesktopWorkspaceFilePreview> {
		return this.getTrustedWorkspaceBrowser().read(path);
	}

	/** Extract original image bytes from a historical user message for editor restoration. */
	getMessageImages(messageId: string): DesktopPromptImage[] {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		const indexText = messageId.split(":", 1)[0] ?? "";
		if (!/^\d+$/u.test(indexText)) throw new Error("无效的消息标识。");
		const message = this.session.messages[Number(indexText)] as unknown as Record<string, unknown> | undefined;
		if (!message || message.role !== "user") throw new Error("只能从历史用户消息恢复图片。");
		const images: DesktopPromptImage[] = [];
		const content = message.content;
		if (Array.isArray(content)) {
			for (const item of content) {
				if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
				const block = item as Record<string, unknown>;
				if (block.type !== "image") continue;
				const decoded = decodeImageBlock(block);
				if (decoded) images.push({ data: decoded.data, mimeType: decoded.mimeType });
				if (images.length >= 10) break;
			}
		}
		if (images.length === 0) throw new Error("该消息没有可恢复的图片附件。");
		return images;
	}

	async openWorkspaceFile(path: string): Promise<void> {
		await this.getTrustedWorkspaceBrowser().open(path);
	}

	async revealWorkspaceFile(path: string): Promise<void> {
		await this.getTrustedWorkspaceBrowser().reveal(path);
	}

	async openExternalUrl(url: string): Promise<void> {
		if (!/^(https?:|mailto:)/u.test(url)) {
			throw new Error("只能打开 http、https 或 mailto 链接。");
		}
		await shell.openExternal(url);
	}

	async getModelsConfig(): Promise<DesktopProviderConfig[]> {
		const config = await readModelsConfig(modelsJsonPathFor(this.agentDir));
		return Object.entries(config.providers).map(([id, provider]) => ({
			id,
			sourceId: id,
			...(provider.name === undefined ? {} : { name: provider.name }),
			...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
			...(provider.api === undefined ? {} : { api: provider.api }),
			...(provider.models === undefined
				? {}
				: {
						models: provider.models.map((model) => ({
							id: model.id,
							sourceId: model.id,
							...(model.name === undefined ? {} : { name: model.name }),
							...(model.api === undefined ? {} : { api: model.api }),
							...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
							...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
							...(model.compat === undefined ? {} : { compat: model.compat }),
							...(model.input === undefined ? {} : { input: model.input }),
							...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
							...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
							...(model.cost === undefined ? {} : { cost: model.cost }),
						})),
					}),
		}));
	}

	async getModelScope(): Promise<DesktopModelScope> {
		const settingsManager = this.settingsManager ?? SettingsManager.create(this.agentDir, this.agentDir);
		const scope = await this.resolveModelScope(settingsManager, await this.getModelRuntime());
		return { patterns: settingsManager.getEnabledModels() ?? [], warnings: scope.warnings };
	}

	async saveModelScope(patterns: string[]): Promise<DesktopModelScope> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再保存可用模型范围。");
		}
		const settingsManager = this.settingsManager ?? SettingsManager.create(this.agentDir, this.agentDir);
		settingsManager.setEnabledModels(patterns.length ? patterns : undefined);
		await settingsManager.flush();
		const modelRuntime = await this.getModelRuntime();
		for (const managed of this.managedSessions.values()) {
			if (managed.settingsManager !== settingsManager) await managed.settingsManager.reload();
			const scope = await this.resolveModelScope(managed.settingsManager, modelRuntime);
			managed.session.setScopedModels(scope.scopedModels);
			managed.modelScope =
				scope.patterns.length > 0
					? {
							patterns: scope.patterns,
							warnings: scope.warnings,
							matched: scope.scopedModels.length,
							fixedLevels: scope.fixedLevels,
						}
					: undefined;
			const currentModel = managed.session.model;
			if (
				scope.scopedModels.length > 0 &&
				currentModel &&
				!scope.scopedModels.some(
					(scoped) => scoped.model.provider === currentModel.provider && scoped.model.id === currentModel.id,
				)
			) {
				const fallbackScoped = scope.scopedModels[0];
				await managed.session.setModel(fallbackScoped.model, { persist: true });
				if (fallbackScoped.thinkingLevel) {
					managed.session.setThinkingLevel(fallbackScoped.thinkingLevel, { persist: true });
				}
			}
		}
		this.auditLog.write("models.scope", "succeeded", { patternCount: patterns.length });
		this.publish();
		return this.getModelScope();
	}

	async saveModelsConfig(providers: DesktopProviderConfig[]): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再保存模型配置。");
		}

		const currentConfig = await readModelsConfig(modelsJsonPathFor(this.agentDir));
		const config = mergeModelsConfig(currentConfig, providers);
		await writeModelsConfig(modelsJsonPathFor(this.agentDir), config);

		return this.enqueueWorkspaceChange(() => this.rebuildAfterModelsConfigChange());
	}

	async discoverModels(providerId: string, baseUrl: string, apiKey?: string): Promise<Array<{ id: string }>> {
		const storedConfig = await readModelsConfig(modelsJsonPathFor(this.agentDir));
		return discoverModelsFromUrl(baseUrl, apiKey ?? storedConfig.providers[providerId]?.apiKey);
	}

	async lookupModelCatalog(providerId: string, modelId: string): Promise<DesktopProviderModelConfig | undefined> {
		return lookupModelCatalog(providerId, modelId);
	}

	async testModel(
		provider: DesktopProviderConfig,
		model: DesktopProviderModelConfig,
	): Promise<DesktopModelTestResult> {
		const tempDir = await mkdtemp(join(tmpdir(), "pi-desktop-model-test-"));
		const startedAt = Date.now();
		try {
			const modelsPath = join(tempDir, "models.json");
			const storedConfig = await readModelsConfig(modelsJsonPathFor(this.agentDir));
			const testConfig = mergeModelsConfig(storedConfig, [{ ...provider, models: [model] }]);
			await writeFile(modelsPath, JSON.stringify(testConfig));
			const runtime = await ModelRuntime.create({
				authPath: join(this.agentDir, "auth.json"),
				modelsPath,
				allowModelNetwork: true,
			});
			const loadedModel = runtime.getModel(provider.id, model.id);
			if (!loadedModel) return { ok: false, error: `找不到模型 ${provider.id}/${model.id}` };
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20_000);
			try {
				const message = await runtime.completeSimple(
					loadedModel,
					{ messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }] },
					{ maxTokens: 16, maxRetries: 0, signal: controller.signal },
				);
				if (message.stopReason === "error" || message.stopReason === "aborted")
					return { ok: false, latencyMs: Date.now() - startedAt, error: message.errorMessage ?? "模型测试失败" };
				const responseText = message.content
					.filter((block) => block.type === "text")
					.map((block) => block.text ?? "")
					.join("")
					.slice(0, 300);
				return { ok: true, latencyMs: Date.now() - startedAt, responseText };
			} finally {
				clearTimeout(timeout);
			}
		} catch (error) {
			return {
				ok: false,
				latencyMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}

	async openPath(path: string): Promise<void> {
		const error = await shell.openPath(path);
		if (error) throw new Error(error);
	}

	async toggleSkill(filePath: string, disable: boolean): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再修改技能。");
		}
		await toggleSkillFile(filePath, disable, {
			...(this.workspacePath && this.projectTrusted
				? { cwd: this.workspacePath, projectTrusted: true }
				: { projectTrusted: false }),
		});
		this.auditLog.write("skill.toggle", "succeeded", { disabled: disable });
		if (this.session) {
			await this.session.resourceLoader.reload();
		}
		return this.publish();
	}

	async listSkillsDetailed(): Promise<DesktopSkillInfo[]> {
		return listSkillsDetailed({
			...(this.workspacePath ? { cwd: this.workspacePath } : {}),
			projectTrusted: this.projectTrusted,
		});
	}

	async searchSkills(query: string): Promise<DesktopSkillSearchResult[]> {
		return searchSkills(query.trim());
	}

	async installSkill(pkg: string, scope: "global" | "project"): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再安装技能。");
		}
		if (scope === "project" && !this.projectTrusted) {
			throw new Error("请先信任当前项目，再安装项目技能。");
		}
		this.auditLog.write("skill.install", "succeeded", { source: pkg, scope });
		try {
			await installSkill(pkg, scope, scope === "project" ? this.requireWorkspacePath() : undefined);
			this.auditLog.write("skill.install", "succeeded", { source: pkg, scope });
			if (this.session) await this.session.resourceLoader.reload();
			return this.publish();
		} catch (error) {
			this.auditLog.write("skill.install", "failed", { source: pkg, scope });
			throw error;
		}
	}

	async checkSkillUpdates(target?: { pkg: string; scope: "global" | "project" }): Promise<DesktopSkillUpdateResult[]> {
		const skills = await this.listSkillsDetailed();
		const installs = skills
			.map((skill) => skill.install)
			.filter((install): install is DesktopSkillInstallInfo => install !== undefined)
			.filter((install) => !target || (install.package === target.pkg && install.scope === target.scope));
		if (target && installs.length === 0) throw new Error("找不到已安装的技能。");
		return Promise.all(installs.map((install) => checkSkillUpdate(install)));
	}

	async updateSkill(pkg: string, scope: "global" | "project"): Promise<string> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再更新技能。");
		if (scope === "project" && !this.projectTrusted) {
			throw new Error("请先信任当前项目，再更新项目技能。");
		}
		const skills = await this.listSkillsDetailed();
		const install = skills
			.map((skill) => skill.install)
			.filter((entry): entry is DesktopSkillInstallInfo => entry !== undefined)
			.find((entry) => entry.package === pkg && entry.scope === scope);
		if (!install) throw new Error("找不到已安装的技能。");
		const output = await updateSkillViaNpx(install);
		if (this.session) await this.session.resourceLoader.reload();
		return output;
	}

	async installPlugin(source: string, local: boolean): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再安装插件。");
		}
		if (local && !this.projectTrusted) throw new Error("请先信任当前项目，再安装项目插件。");
		const settingsManager = this.requireSettingsManager();
		const packageManager = new DefaultPackageManager({
			cwd: this.workspacePath ?? this.agentDir,
			agentDir: this.agentDir,
			settingsManager,
		});
		try {
			await packageManager.installAndPersist(source, { local });
			this.auditLog.write("plugin.install", "succeeded", { source, scope: local ? "project" : "user" });
			return this.reloadSessionResources();
		} catch (error) {
			this.auditLog.write("plugin.install", "failed", { source, scope: local ? "project" : "user" });
			throw error;
		}
	}

	async removePlugin(source: string, local: boolean): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) {
			throw new Error("请等待当前智能体任务完成后，再移除插件。");
		}
		if (local && !this.projectTrusted) throw new Error("请先信任当前项目，再移除项目插件。");
		const settingsManager = this.requireSettingsManager();
		const packageManager = new DefaultPackageManager({
			cwd: this.workspacePath ?? this.agentDir,
			agentDir: this.agentDir,
			settingsManager,
		});
		try {
			await packageManager.removeAndPersist(source, { local });
			this.auditLog.write("plugin.remove", "succeeded", { source, scope: local ? "project" : "user" });
			return this.reloadSessionResources();
		} catch (error) {
			this.auditLog.write("plugin.remove", "failed", { source, scope: local ? "project" : "user" });
			throw error;
		}
	}

	async togglePlugin(source: string, local: boolean, enabled: boolean): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再修改插件。");
		if (local && !this.projectTrusted) throw new Error("请先信任当前项目，再修改项目插件。");
		const settingsManager = this.requireSettingsManager();
		const current = local ? (settingsManager.getProjectSettings().packages ?? []) : settingsManager.getPackages();
		const next = current.map((entry): PackageSource => {
			const entrySource = typeof entry === "string" ? entry : entry.source;
			if (entrySource !== source) return entry;
			return enabled ? source : { source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] };
		});
		if (local) settingsManager.setProjectPackages(next);
		else settingsManager.setPackages(next);
		this.auditLog.write("plugin.toggle", "succeeded", { source, scope: local ? "project" : "user", enabled });
		return this.reloadSessionResources();
	}

	async savePluginPackageFilters(input: DesktopPluginPackageFilterInput): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再修改插件。");
		if (input.local && !this.projectTrusted) throw new Error("请先信任当前项目，再修改项目插件。");
		const settingsManager = this.requireSettingsManager();
		const current = input.local
			? (settingsManager.getProjectSettings().packages ?? [])
			: settingsManager.getPackages();
		let matched = false;
		const next = current.map((entry): PackageSource => {
			const entrySource = typeof entry === "string" ? entry : entry.source;
			if (entrySource !== input.source) return entry;
			matched = true;
			// Spread object entries to preserve configuration fields the editor does not expose.
			const base = typeof entry === "string" ? { source: entry } : { ...entry };
			return {
				...base,
				source: input.source,
				autoload: input.autoload,
				extensions: [...input.filters.extensions],
				skills: [...input.filters.skills],
				prompts: [...input.filters.prompts],
				themes: [...input.filters.themes],
			};
		});
		if (!matched) throw new Error("找不到对应的插件配置，请刷新后重试。");
		if (input.local) settingsManager.setProjectPackages(next);
		else settingsManager.setPackages(next);
		this.auditLog.write("plugin.filters", "succeeded", {
			source: input.source,
			scope: input.local ? "project" : "user",
			autoload: input.autoload,
		});
		return this.publish();
	}

	async getPluginPackages(): Promise<DesktopPluginPackage[]> {
		const settingsManager = this.requireSettingsManager();
		const packageManager = new DefaultPackageManager({
			cwd: this.workspacePath ?? this.agentDir,
			agentDir: this.agentDir,
			settingsManager,
		});
		const configured = packageManager.listConfiguredPackages();
		const resourceLoader = this.session?.resourceLoader;
		const extensions = resourceLoader?.getExtensions();
		const skills = resourceLoader?.getSkills();
		const prompts = resourceLoader?.getPrompts();
		const themes = resourceLoader?.getThemes();
		const settingsFor = (scope: "user" | "project"): PackageSource[] =>
			scope === "user" ? settingsManager.getPackages() : (settingsManager.getProjectSettings().packages ?? []);
		const settingsEntryFor = (source: string, scope: "user" | "project"): PackageSource | undefined =>
			settingsFor(scope).find(
				(candidate) => (typeof candidate === "string" ? candidate : candidate.source) === source,
			);
		const isDisabled = (source: string, scope: "user" | "project"): boolean => {
			const entry = settingsFor(scope).find(
				(candidate) => (typeof candidate === "string" ? candidate : candidate.source) === source,
			);
			return (
				typeof entry === "object" &&
				entry.autoload === false &&
				[entry.extensions, entry.skills, entry.prompts, entry.themes].every((patterns) => patterns?.length === 0)
			);
		};
		const belongsTo = (
			source: string | undefined,
			path: string | undefined,
			packageSource: string,
			installedPath: string | undefined,
		): boolean => {
			if (source === packageSource) return true;
			if (!path || !installedPath) return false;
			const candidate = resolve(path);
			const root = resolve(installedPath);
			return candidate === root || candidate.startsWith(`${root}${sep}`);
		};
		const configuredVersionOf = (source: string): string | undefined => {
			const npmSource = source.startsWith("npm:") ? source.slice(4) : source;
			const version = npmSource.match(/@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/u)?.[1];
			return version;
		};

		return Promise.all(
			configured.map(async (pkg): Promise<DesktopPluginPackage> => {
				const installedPath = pkg.installedPath ?? packageManager.getInstalledPath(pkg.source, pkg.scope);
				const extensionPaths =
					extensions?.extensions
						.filter((extension) =>
							belongsTo(extension.sourceInfo.source, extension.path, pkg.source, installedPath),
						)
						.map((extension) => extension.path) ?? [];
				const skillPaths =
					skills?.skills
						.filter((skill) => belongsTo(skill.sourceInfo.source, skill.filePath, pkg.source, installedPath))
						.map((skill) => skill.filePath) ?? [];
				const promptPaths =
					prompts?.prompts
						.filter((prompt) => belongsTo(prompt.sourceInfo.source, prompt.filePath, pkg.source, installedPath))
						.map((prompt) => prompt.filePath) ?? [];
				const themePaths =
					themes?.themes
						.filter((theme) => belongsTo(theme.sourceInfo?.source, theme.sourcePath, pkg.source, installedPath))
						.map((theme) => theme.sourcePath)
						.filter((path): path is string => path !== undefined) ?? [];
				const diagnostics: DesktopPluginPackage["diagnostics"] = [];
				for (const error of extensions?.errors ?? []) {
					if (belongsTo(undefined, error.path, pkg.source, installedPath)) {
						diagnostics.push({ type: "error", message: error.error, path: error.path });
					}
				}
				for (const diagnostic of [
					...(skills?.diagnostics ?? []),
					...(prompts?.diagnostics ?? []),
					...(themes?.diagnostics ?? []),
				]) {
					if (belongsTo(undefined, diagnostic.path, pkg.source, installedPath)) {
						diagnostics.push({
							type: diagnostic.type === "error" ? "error" : "warning",
							message: diagnostic.message,
							...(diagnostic.path ? { path: diagnostic.path } : {}),
						});
					}
				}
				let packageName: string | undefined;
				let version: string | undefined;
				if (installedPath) {
					try {
						const stats = await lstat(installedPath);
						const packageRoot = stats.isDirectory() ? installedPath : dirname(installedPath);
						const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Record<
							string,
							unknown
						>;
						if (typeof packageJson.name === "string") packageName = packageJson.name;
						if (typeof packageJson.version === "string") version = packageJson.version;
					} catch {
						// A local single-file extension has no package metadata.
					}
				}
				const enabled = !isDisabled(pkg.source, pkg.scope);
				const resourceCount = extensionPaths.length + skillPaths.length + promptPaths.length + themePaths.length;
				const settingsEntry = settingsEntryFor(pkg.source, pkg.scope);
				const objectEntry = typeof settingsEntry === "object" ? settingsEntry : undefined;
				return {
					source: pkg.source,
					scope: pkg.scope,
					enabled,
					status: !installedPath
						? "missing"
						: !enabled
							? "disabled"
							: diagnostics.some((entry) => entry.type === "error")
								? "error"
								: resourceCount > 0
									? "loaded"
									: "installed",
					...(installedPath ? { installedPath } : {}),
					...(packageName ? { packageName } : {}),
					...(version ? { version } : {}),
					...(configuredVersionOf(pkg.source) ? { configuredVersion: configuredVersionOf(pkg.source) } : {}),
					...(pkg.filtered ? { filtered: true } : {}),
					...(objectEntry
						? {
								autoload: objectEntry.autoload !== false,
								filters: {
									extensions: [...(objectEntry.extensions ?? [])],
									skills: [...(objectEntry.skills ?? [])],
									prompts: [...(objectEntry.prompts ?? [])],
									themes: [...(objectEntry.themes ?? [])],
								},
							}
						: {}),
					resources: {
						extensions: extensionPaths,
						skills: skillPaths,
						prompts: promptPaths,
						themes: themePaths,
					},
					diagnostics,
				};
			}),
		);
	}

	async reloadSession(): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再重载插件资源。");
		return this.enqueueWorkspaceChange(() => this.reloadSessionResources());
	}

	private async reloadSessionResources(): Promise<DesktopSnapshot> {
		if (this.session) {
			await this.session.resourceLoader.reload();
		}
		return this.publish();
	}

	private requireSettingsManager(): SettingsManager {
		if (!this.settingsManager) {
			throw new Error("本地智能体尚未就绪。");
		}
		return this.settingsManager;
	}

	private async rebuildAfterModelsConfigChange(): Promise<DesktopSnapshot> {
		const workspacePath = this.workspacePath;
		const projectTrusted = this.projectTrusted;
		const sessionDirectory = this.sessionDirectory;
		const sessionFile = this.session?.sessionManager.getSessionFile();

		this.modelRuntime = undefined;
		this.disposeAllSessions();

		const cwd = workspacePath ?? this.agentDir;
		const directory = sessionDirectory ?? join(this.agentDir, "sessions", "default");
		try {
			await this.createSession({
				cwd,
				projectTrusted,
				sessionDirectory: directory,
				...(workspacePath ? { workspacePath } : {}),
				...(sessionFile ? { sessionFile } : {}),
			});
		} catch (error) {
			this.projectTrusted = projectTrusted;
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async listGitChanges(): Promise<DesktopGitChange[]> {
		const workspacePath = this.requireWorkspacePath();
		return gitListChanges(workspacePath);
	}

	async getGitDiff(path: string): Promise<string> {
		const workspacePath = this.requireWorkspacePath();
		const change = (await gitListChanges(workspacePath)).find((item) => item.path === path);
		if (!change) throw new Error("只能读取当前工作区内已变更文件的差异。");
		return gitGetDiff(workspacePath, path, change.status === "untracked");
	}

	async listGitWorktrees(): Promise<DesktopGitWorktree[]> {
		const workspacePath = this.requireWorkspacePath();
		return gitListWorktrees(workspacePath);
	}

	async listGitBranches(): Promise<{ local: string[]; remote: string[] }> {
		const workspacePath = this.requireWorkspacePath();
		return gitListBranches(workspacePath);
	}

	async fetchGitBranches(): Promise<void> {
		if (!this.projectTrusted) throw new Error("请先信任当前项目，再刷新远程分支。");
		const workspacePath = this.requireWorkspacePath();
		await gitFetchBranches(workspacePath);
	}

	async switchGitBranch(branch: string): Promise<DesktopSnapshot> {
		if (this.hasStreamingSession()) throw new Error("请等待当前智能体任务完成后，再切换 Git 分支。");
		if (!this.projectTrusted) throw new Error("请先信任当前项目，再切换 Git 分支。");
		const workspacePath = this.requireWorkspacePath();
		await gitSwitchBranch(workspacePath, branch);
		await this.session?.resourceLoader.reload();
		this.workspaceSearchCache = undefined;
		for (const listener of this.workspaceChangeListeners) listener([]);
		return this.publish();
	}

	async addGitWorktree(branch: string): Promise<DesktopGitWorktree> {
		if (!this.projectTrusted) throw new Error("请先信任当前项目，再创建 Worktree。");
		const workspacePath = this.requireWorkspacePath();
		return gitAddWorktree(workspacePath, branch);
	}

	async removeGitWorktree(path: string, force = false): Promise<DesktopRemoveWorktreeResult> {
		if (!this.projectTrusted) throw new Error("请先信任当前项目，再移除 Worktree。");
		const workspacePath = this.requireWorkspacePath();
		return gitRemoveWorktree(workspacePath, path, force);
	}

	async readFullBashOutput(messageId: string): Promise<string> {
		if (!this.session) throw new Error("没有活动会话。");
		const indexText = messageId.split(":", 1)[0] ?? "";
		if (!/^\d+$/u.test(indexText)) throw new Error("无效的终端输出标识。");
		const message = this.session.messages[Number(indexText)] as unknown as Record<string, unknown> | undefined;
		if (
			!message ||
			message.role !== "bashExecution" ||
			message.truncated !== true ||
			typeof message.fullOutputPath !== "string"
		) {
			throw new Error("该终端输出不可用。");
		}
		const candidate = resolve(message.fullOutputPath);
		const temporaryDirectory = await realpath(tmpdir());
		const resolvedOutput = await realpath(candidate);
		if (
			dirname(resolvedOutput) !== temporaryDirectory ||
			!/^pi-(?:bash|output)-[a-zA-Z0-9_-]+\.log$/u.test(basename(resolvedOutput))
		) {
			throw new Error("终端完整输出路径无效。");
		}
		const stats = await lstat(resolvedOutput);
		if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 20 * 1024 * 1024) {
			throw new Error("终端完整输出不是受支持的普通文件，或超过 20 MB。 ");
		}
		return readFile(resolvedOutput, "utf8");
	}

	requireWorkspacePath(): string {
		if (!this.workspacePath) {
			throw new Error("请先选择项目。");
		}
		return this.workspacePath;
	}

	async dispose(): Promise<void> {
		this.workspaceWatcher.stop();
		this.disposeAllSessions();
	}

	private applyManagedSessionState(managed: ManagedSession): void {
		this.error = managed.error;
		this.extensionStatuses = managed.extensionStatuses;
		this.extensionWidgets = managed.extensionWidgets;
		this.extensionEditorRequest = managed.extensionEditorRequest;
		this.extensionNotice = managed.extensionNotice;
		this.autoRetryState = managed.autoRetryState;
		this.lastCompaction = managed.lastCompaction;
		this.runningToolNames = managed.runningToolNames;
	}

	private syncActiveSessionState(): void {
		if (!this.activeSessionId) return;
		const managed = this.managedSessions.get(this.activeSessionId);
		if (!managed) return;
		managed.error = this.error;
		managed.extensionStatuses = this.extensionStatuses;
		managed.extensionWidgets = this.extensionWidgets;
		managed.extensionEditorRequest = this.extensionEditorRequest;
		managed.extensionNotice = this.extensionNotice;
		managed.autoRetryState = this.autoRetryState;
		managed.lastCompaction = this.lastCompaction;
		managed.runningToolNames = this.runningToolNames;
	}

	private activateManagedSession(managed: ManagedSession): void {
		this.syncActiveSessionState();
		this.activeSessionId = managed.id;
		managed.lastUsedAt = Date.now();
		this.session = managed.session;
		this.settingsManager = managed.settingsManager;
		this.workspacePath = managed.workspacePath;
		this.sessionDirectory = managed.sessionDirectory;
		this.projectTrusted = managed.projectTrusted;
		this.applyManagedSessionState(managed);
		queueMicrotask(() => {
			if (this.activeSessionId !== managed.id) return;
			this.extensionDialogQueue.reemitForSession(managed.id);
			managed.extensionCustomUi.reemit();
		});
		if (managed.workspacePath && managed.projectTrusted) this.workspaceWatcher.start(managed.workspacePath);
		else this.workspaceWatcher.stop();
	}

	private deactivateActiveSession(): void {
		this.syncActiveSessionState();
		this.workspaceWatcher.stop();
		this.activeSessionId = undefined;
		this.session = undefined;
		this.settingsManager = undefined;
		this.workspacePath = undefined;
		this.sessionDirectory = undefined;
		this.projectTrusted = false;
		this.error = undefined;
		this.extensionStatuses = [];
		this.extensionWidgets = [];
		this.extensionEditorRequest = undefined;
		this.extensionNotice = undefined;
		this.autoRetryState = undefined;
		this.lastCompaction = undefined;
		this.runningToolNames = new Set<string>();
	}

	private findManagedSessionByPath(sessionPath: string): ManagedSession | undefined {
		const resolvedPath = resolve(sessionPath);
		return [...this.managedSessions.values()].find((managed) => {
			const managedPath = managed.session.sessionManager.getSessionFile();
			return managedPath !== undefined && resolve(managedPath) === resolvedPath;
		});
	}

	private hasStreamingSession(): boolean {
		return [...this.managedSessions.values()].some((managed) => managed.session.isStreaming);
	}

	private disposeManagedSession(managed: ManagedSession): void {
		const wasActive = this.activeSessionId === managed.id;
		if (wasActive) this.deactivateActiveSession();
		this.approvalQueue.cancelGroup(managed.lifecycleId);
		this.extensionDialogQueue.cancelSession(managed.id);
		managed.extensionCustomUi.dispose();
		managed.unsubscribe();
		managed.session.dispose();
		this.managedSessions.delete(managed.id);
	}

	private disposeWorkspaceSessions(workspacePath: string): void {
		for (const managed of [...this.managedSessions.values()]) {
			if (managed.workspacePath === workspacePath) this.disposeManagedSession(managed);
		}
	}

	private disposeAllSessions(): void {
		this.approvalQueue.cancelAll();
		this.authenticationController?.abort();
		this.authenticationController = undefined;
		this.authenticationPromptQueue.cancelAll();
		this.deactivateActiveSession();
		for (const managed of this.managedSessions.values()) {
			this.extensionDialogQueue.cancelSession(managed.id);
			managed.extensionCustomUi.dispose();
			managed.unsubscribe();
			managed.session.dispose();
		}
		this.managedSessions.clear();
		this.sessions = [];
	}

	private async refreshSessions(): Promise<void> {
		try {
			const byPath = new Map<string, DesktopSessionInfo>();
			const indexedSessions = await listIndexedSessions(this.agentDir);
			const projectInfoByCwd = new Map<string, Awaited<ReturnType<typeof resolveGitProject>>>();
			await Promise.all(
				[...new Set(indexedSessions.map((info) => info.cwd))].map(async (cwd) => {
					projectInfoByCwd.set(cwd, await resolveGitProject(cwd));
				}),
			);
			for (const info of indexedSessions) {
				if (resolve(info.cwd) === resolve(this.agentDir)) continue;
				const managed = this.findManagedSessionByPath(info.path);
				const project = projectInfoByCwd.get(info.cwd);
				byPath.set(resolve(info.path), {
					path: info.path,
					id: info.id,
					...(info.name === undefined ? {} : { name: info.name }),
					cwd: info.cwd,
					...(project && project.projectRoot !== info.cwd ? { projectRoot: project.projectRoot } : {}),
					...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
					created: info.created.getTime(),
					modified: info.modified.getTime(),
					messageCount: info.messageCount,
					firstMessage: info.firstMessage,
					...(info.parentSessionPath ? { parentSessionPath: info.parentSessionPath } : {}),
					...(managed ? { phase: toPhase(managed.session, managed.error) } : {}),
				});
			}
			this.sessions = [...byPath.values()].sort((left, right) => right.modified - left.modified);
		} catch {
			this.sessions = [];
		}
	}

	private enqueueWorkspaceChange(operation: () => Promise<DesktopSnapshot>): Promise<DesktopSnapshot> {
		const queued = this.workspaceChangeQueue.then(operation, operation);
		this.workspaceChangeQueue = queued.then(
			() => undefined,
			() => undefined,
		);
		return queued;
	}

	private getTrustedWorkspaceBrowser(): TrustedWorkspaceBrowser {
		if (!this.workspacePath) {
			throw new Error("请先选择项目，再浏览文件。");
		}
		if (!this.projectTrusted) {
			throw new Error("请先信任该项目，再浏览其中的文件。");
		}
		return new TrustedWorkspaceBrowser(this.workspacePath);
	}

	private getModelRuntime(): Promise<ModelRuntime> {
		if (this.modelRuntime) return Promise.resolve(this.modelRuntime);
		if (!this.modelRuntimeInitialization) {
			this.modelRuntimeInitialization = ModelRuntime.create({
				authPath: join(this.agentDir, "auth.json"),
				modelsPath: join(this.agentDir, "models.json"),
				allowModelNetwork: true,
				modelRefreshTimeoutMs: 15_000,
			})
				.then((modelRuntime) => {
					this.modelRuntime = modelRuntime;
					return modelRuntime;
				})
				.finally(() => {
					this.modelRuntimeInitialization = undefined;
				});
		}
		return this.modelRuntimeInitialization;
	}

	private toDesktopAuthenticationPrompt(prompt: {
		type: DesktopAuthenticationPrompt["type"];
		message: string;
		placeholder?: string;
		options?: readonly { id: string; label: string; description?: string }[];
	}): Omit<DesktopAuthenticationPrompt, "id" | "requestedAt"> {
		return {
			type: prompt.type,
			message: prompt.message,
			...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
			...(prompt.options === undefined ? {} : { options: [...prompt.options] }),
		};
	}

	private publish(): DesktopSnapshot {
		this.syncActiveSessionState();
		const snapshot = this.getSnapshot();
		this.syncActiveSessionState();
		for (const listener of this.listeners) listener(snapshot);
		return snapshot;
	}

	private getApiKeyProviders(): DesktopApiKeyProvider[] {
		if (!this.modelRuntime) return [];
		const providers = this.modelRuntime
			.getProviders()
			.filter((provider) => provider.auth.apiKey?.login !== undefined || provider.auth.oauth !== undefined)
			.map((provider) => {
				const configured = this.modelRuntime?.getProviderAuthStatus(provider.id).configured ?? false;
				return {
					id: provider.id,
					name: provider.name,
					configured,
					...(configured
						? {
								credentialType: this.modelRuntime?.isUsingOAuth(provider.id)
									? ("oauth" as const)
									: ("api_key" as const),
							}
						: {}),
					supportsApiKey: provider.auth.apiKey?.login !== undefined,
					supportsOAuth: provider.auth.oauth !== undefined,
					...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
				};
			});
		return providers.sort((left, right) => left.name.localeCompare(right.name));
	}

	private getAvailableModels(): DesktopModel[] {
		if (!this.modelRuntime) return [];
		const models = this.session?.scopedModels.length
			? this.session.scopedModels.map((scoped) => scoped.model)
			: this.modelRuntime.getAvailableSnapshot();
		return models
			.map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				supportsImages: model.input.includes("image"),
			}))
			.sort((left, right) => {
				const providerOrder = left.provider.localeCompare(right.provider);
				return providerOrder === 0 ? left.name.localeCompare(right.name) : providerOrder;
			});
	}

	private async resolveModelScope(
		settingsManager: SettingsManager,
		modelRuntime: ModelRuntime,
	): Promise<{
		scopedModels: Array<AgentSession["scopedModels"][number]>;
		warnings: string[];
		patterns: string[];
		fixedLevels: DesktopModelScopeStatus["fixedLevels"];
	}> {
		const patterns =
			settingsManager
				.getEnabledModels()
				?.map((pattern) => pattern.trim())
				.filter(Boolean) ?? [];
		if (patterns.length === 0) return { scopedModels: [], warnings: [], patterns: [], fixedLevels: [] };
		const resolved = await resolveModelScopeWithDiagnostics(patterns, modelRuntime);
		return {
			scopedModels: resolved.scopedModels,
			warnings: resolved.diagnostics.map((diagnostic) => diagnostic.message),
			patterns,
			fixedLevels: resolved.scopedModels
				.filter((scoped) => scoped.thinkingLevel !== undefined)
				.map((scoped) => ({
					provider: scoped.model.provider,
					modelId: scoped.model.id,
					level: scoped.thinkingLevel as string,
				})),
		};
	}

	private getSkills(): DesktopSkillInfo[] {
		if (!this.session) return [];
		return this.session.resourceLoader
			.getSkills()
			.skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
				scope: skill.sourceInfo?.scope === "project" ? ("project" as const) : ("global" as const),
			}))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	private getPlugins(): DesktopPlugin[] {
		if (!this.session) return [];
		const extensions = this.session.resourceLoader.getExtensions().extensions;
		return extensions
			.filter((extension) => !extension.hidden)
			.map((extension) => ({ name: basename(extension.path), commands: [...extension.commands.keys()].sort() }))
			.sort((left, right) => left.name.localeCompare(right.name));
	}
}
