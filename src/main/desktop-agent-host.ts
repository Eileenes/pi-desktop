import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultPackageManager,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import type {
	DesktopApiKeyProvider,
	DesktopAuthenticationPrompt,
	DesktopBranchPoint,
	DesktopExtensionDialog,
	DesktopExtensionDialogListener,
	DesktopExtensionStatus,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopModel,
	DesktopModelTestResult,
	DesktopPlugin,
	DesktopProviderConfig,
	DesktopProviderModelConfig,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopSessionStats,
	DesktopSkillInfo,
	DesktopSkillInstallInfo,
	DesktopSkillSearchResult,
	DesktopSkillUpdateResult,
	DesktopSnapshot,
	DesktopTranscriptBlock,
	DesktopTranscriptMessage,
	DesktopWorkspaceChange,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { AuthenticationPromptQueue } from "./authentication-prompt-queue.ts";
import {
	addGitWorktree as gitAddWorktree,
	getGitDiff as gitGetDiff,
	listGitChanges as gitListChanges,
	listGitWorktrees as gitListWorktrees,
	removeGitWorktree as gitRemoveWorktree,
} from "./git-integration.ts";
import {
	discoverModels as discoverModelsFromUrl,
	lookupModelCatalog,
	type ModelsJson,
	type ModelsJsonProvider,
	modelsJsonPathFor,
	readModelsConfig,
	writeModelsConfig,
} from "./models-config-store.ts";
import { SecurityAuditLog } from "./security-audit-log.ts";
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

class ExtensionDialogQueue {
	private pending = new Map<string, (value: string) => void>();
	private sequence = 0;
	private readonly emit: (dialog: DesktopExtensionDialog) => void;

	constructor(emit: (dialog: DesktopExtensionDialog) => void) {
		this.emit = emit;
	}

	request(
		dialog:
			| { kind: "select"; title: string; options: string[] }
			| { kind: "confirm"; title: string; message: string }
			| { kind: "input"; title: string; placeholder?: string },
	): Promise<string> {
		const id = `ext-dialog-${++this.sequence}`;
		return new Promise((resolvePromise) => {
			this.pending.set(id, resolvePromise);
			this.emit({ ...dialog, id } as DesktopExtensionDialog);
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					resolvePromise("");
				}
			}, 120_000);
		});
	}

	resolve(id: string, value: string): boolean {
		const resolver = this.pending.get(id);
		if (!resolver) return false;
		this.pending.delete(id);
		resolver(value);
		return true;
	}
}

const DESKTOP_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export interface DesktopPromptImage {
	data: string;
	mimeType: string;
}

function toMessageRole(value: unknown): DesktopTranscriptMessage["role"] {
	if (value === "assistant" || value === "user") return value;
	if (value === "toolResult" || value === "bashExecution") return "tool";
	return "system";
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
		if (block.type === "image") blocks.push({ type: "image", label: "图片附件" });
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
					: block.label,
		)
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
		...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
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
	private session: AgentSession | undefined;
	private modelRuntime: ModelRuntime | undefined;
	private modelRuntimeInitialization: Promise<ModelRuntime> | undefined;
	private settingsManager: SettingsManager | undefined;
	private workspacePath: string | undefined;
	private sessionDirectory: string | undefined;
	private projectTrusted = false;
	private sessions: DesktopSessionInfo[] = [];
	private providerSetupInProgress = false;
	private authenticationController: AbortController | undefined;
	private authenticationNotice: string | undefined;
	private error: string | undefined;
	private unsubscribeSession: (() => void) | undefined;
	private readonly listeners = new Set<SnapshotListener>();
	private readonly workspaceWatcher = new WorkspaceWatcher((changes) => {
		for (const listener of this.workspaceChangeListeners) listener(changes);
	});
	private readonly workspaceChangeListeners = new Set<(changes: DesktopWorkspaceChange[]) => void>();
	private readonly extensionDialogListeners = new Set<DesktopExtensionDialogListener>();
	private extensionStatuses: DesktopExtensionStatus[] = [];
	private extensionNotice: string | undefined;
	private autoRetryState: { attempt: number; maxAttempts: number; errorMessage: string } | undefined;
	private lastCompaction: { reason: string; tokensBefore: number; tokensAfter?: number } | undefined;
	private runningToolNames = new Set<string>();
	private readonly extensionDialogQueue: ExtensionDialogQueue = new ExtensionDialogQueue((dialog) => {
		for (const listener of this.extensionDialogListeners) listener(dialog);
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
			apiKeyProviders: this.getApiKeyProviders(),
			availableModels: this.getAvailableModels(),
			skills: this.getSkills(),
			plugins: this.getPlugins(),
			providerSetupInProgress: this.providerSetupInProgress,
			sessions: this.sessions,
		};
		if (this.workspacePath) snapshot.workspacePath = this.workspacePath;
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
		return snapshot;
	}

	private toDesktopBranchPoints(): DesktopBranchPoint[] {
		if (!this.session) return [];
		return this.session.getUserMessagesForForking().map((point) => ({
			entryId: point.entryId,
			text: point.text.length > 50 ? `${point.text.slice(0, 50)}…` : point.text,
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

	onExtensionDialog(listener: DesktopExtensionDialogListener): () => void {
		this.extensionDialogListeners.add(listener);
		return () => this.extensionDialogListeners.delete(listener);
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
		await this.disposeSession();

		try {
			const projectTrusted = await this.trustStore.isTrusted(cwd);
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
		const sessionManager = options.sessionFile
			? SessionManager.open(options.sessionFile, options.sessionDirectory)
			: options.resumeRecent
				? SessionManager.continueRecent(options.cwd, options.sessionDirectory)
				: SessionManager.create(options.cwd, options.sessionDirectory);
		const settingsManager = SettingsManager.create(options.cwd, this.agentDir, {
			projectTrusted: options.projectTrusted,
		});
		this.settingsManager = settingsManager;
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
							const approved = await this.approvalQueue.request({
								toolCallId: event.toolCallId,
								toolName: event.toolName,
								input: event.input,
							});
							return approved
								? undefined
								: { block: true, reason: "Desktop user denied this tool call.", terminate: true };
						});
					},
				},
			],
		});
		await resourceLoader.reload();
		const created = await createAgentSession({
			cwd: options.cwd,
			agentDir: this.agentDir,
			modelRuntime: await modelRuntimePromise,
			...(options.projectTrusted ? { tools: [...DESKTOP_TOOL_NAMES] } : { noTools: "all" }),
			resourceLoader,
			settingsManager,
			sessionManager,
		});

		const statuses = new Map<string, string>();
		const partialUiContext = {
			select: async (title: string, dialogOptions: string[]) => {
				const value = await this.extensionDialogQueue.request({
					kind: "select",
					title,
					options: dialogOptions ?? [],
				});
				return value || undefined;
			},
			confirm: async (title: string, message: string) => {
				const value = await this.extensionDialogQueue.request({ kind: "confirm", title, message });
				return value === "confirm";
			},
			input: async (title: string, placeholder?: string) => {
				const value = await this.extensionDialogQueue.request({
					kind: "input",
					title,
					...(placeholder ? { placeholder } : {}),
				});
				return value || undefined;
			},
			editor: async (title: string, prefill?: string) => {
				const value = await this.extensionDialogQueue.request({
					kind: "input",
					title,
					...(prefill ? { placeholder: prefill } : {}),
				});
				return value || undefined;
			},
			notify: (message: string, type?: "info" | "warning" | "error") => {
				this.extensionNotice = `${type === "error" ? "错误" : type === "warning" ? "警告" : "提示"}：${message}`;
				this.publish();
			},
			setStatus: (key: string, text: string | undefined) => {
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
				this.extensionStatuses = [...statuses.entries()].map(([statusKey, statusText]) => ({
					key: statusKey,
					text: statusText,
				}));
				this.publish();
			},
		};
		try {
			created.session.extensionRunner.setUIContext(
				partialUiContext as unknown as Parameters<typeof created.session.extensionRunner.setUIContext>[0],
				"rpc",
			);
		} catch {
			// UI 桥不可用时扩展交互静默降级。
		}

		this.workspacePath = options.workspacePath;
		this.sessionDirectory = options.sessionDirectory;
		this.projectTrusted = options.projectTrusted;
		this.session = created.session;
		this.error = created.modelFallbackMessage ? "没有可用模型。请在设置中配置模型服务商。" : undefined;
		this.autoRetryState = undefined;
		this.lastCompaction = undefined;
		this.runningToolNames = new Set<string>();
		this.unsubscribeSession = this.session.subscribe((event: unknown) => {
			const typed = event as { type?: string; [key: string]: unknown };
			if (typed.type === "auto_retry_start") {
				this.autoRetryState = {
					attempt: typeof typed.attempt === "number" ? typed.attempt : 0,
					maxAttempts: typeof typed.maxAttempts === "number" ? typed.maxAttempts : 0,
					errorMessage: typeof typed.errorMessage === "string" ? typed.errorMessage : "未知错误",
				};
			} else if (typed.type === "auto_retry_end") {
				this.autoRetryState = undefined;
			} else if (typed.type === "tool_execution_start" && typeof typed.toolName === "string") {
				this.runningToolNames.add(typed.toolName);
			} else if (typed.type === "tool_execution_end" && typeof typed.toolName === "string") {
				this.runningToolNames.delete(typed.toolName);
			} else if (typed.type === "compaction_end") {
				const result = typed.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown } | undefined;
				this.lastCompaction = {
					reason: typeof typed.reason === "string" ? typed.reason : "manual",
					tokensBefore: typeof result?.tokensBefore === "number" ? result.tokensBefore : 0,
					...(typeof result?.estimatedTokensAfter === "number"
						? { tokensAfter: result.estimatedTokensAfter }
						: {}),
				};
			}
			this.publish();
		});
		if (options.workspacePath && options.projectTrusted) {
			this.workspaceWatcher.start(options.workspacePath);
		} else {
			this.workspaceWatcher.stop();
		}
		await this.refreshSessions();
	}

	async prompt(
		text: string,
		images: DesktopPromptImage[] = [],
		streamingBehavior?: "steer" | "followUp",
	): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再发送消息。");
		}
		if (!this.session) {
			throw new Error("请先选择项目，再发送消息。");
		}

		if (this.session.sessionName === undefined) {
			const trimmed = text.trim().replace(/\s+/gu, " ");
			if (trimmed) {
				const name = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
				this.session.sessionManager.appendSessionInfo(name);
			}
		}

		if (this.session.isStreaming && streamingBehavior === undefined) {
			throw new Error("智能体运行中，请选择立即引导或排队跟进。");
		}

		this.error = undefined;
		try {
			await this.session.prompt(text, {
				images: images.map((image) => ({ ...image, type: "image" as const })),
				source: "interactive",
				...(streamingBehavior === undefined ? {} : { streamingBehavior }),
			});
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		return this.publish();
	}

	async abort(): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		if (!this.session.isStreaming) return this.getSnapshot();
		this.approvalQueue.cancelAll();
		await this.session.abort();
		return this.publish();
	}

	async openSession(sessionPath: string): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再切换会话。");
		}
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再切换会话。");
		}
		return this.enqueueWorkspaceChange(() => this.switchSession({ sessionFile: sessionPath }));
	}

	async newSession(): Promise<DesktopSnapshot> {
		if (this.providerSetupInProgress) {
			throw new Error("请先完成当前模型服务商配置，再新建会话。");
		}
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再新建会话。");
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
		await this.disposeSession();
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
		const workspacePath = this.workspacePath;
		const projectTrusted = this.projectTrusted;
		const sessionDirectory = this.sessionDirectory;
		if (!workspacePath || !sessionDirectory) {
			throw new Error("请先选择项目，再管理会话。");
		}

		let sessionFile: string | undefined;
		if (options.sessionFile) {
			const resolvedDirectory = resolve(sessionDirectory);
			const resolvedFile = resolve(options.sessionFile);
			if (!resolvedFile.startsWith(resolvedDirectory + sep) || !resolvedFile.endsWith(".jsonl")) {
				throw new Error("无效的会话文件。");
			}
			sessionFile = resolvedFile;
		}

		await this.disposeSession();
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
		const model = modelRuntime.getAvailableSnapshot().find((candidate) => {
			return candidate.provider === providerId && candidate.id === modelId;
		});
		if (!model) throw new Error("该模型不可用。请先检查服务商认证信息。");

		this.error = undefined;
		try {
			await this.session.setModel(model, { persist: true });
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

	async renameSession(name: string): Promise<DesktopSnapshot> {
		if (!this.session) throw new Error("本地智能体会话尚未就绪。");
		const trimmed = name.trim().slice(0, 120);
		if (!trimmed) throw new Error("会话名称不能为空。");
		this.session.setSessionName(trimmed);
		return this.publish();
	}

	async deleteSession(sessionPath: string): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) throw new Error("请等待当前智能体任务完成后再删除会话。");
		const { unlink } = await import("node:fs/promises");
		const realPath = resolve(sessionPath);
		const directory = this.sessionDirectory ? resolve(this.sessionDirectory) : undefined;
		if (!directory || !realPath.startsWith(directory + sep)) {
			throw new Error("只能删除当前工作区目录中的会话文件。");
		}
		await unlink(realPath);
		this.auditLog.write("workspace.trust", "denied", { deletedSession: basename(realPath) });
		await this.refreshSessions();
		const currentFile = this.session?.sessionManager.getSessionFile();
		if (currentFile && resolve(currentFile) === realPath) {
			await this.newSession();
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
			if (this.session?.isStreaming) {
				throw new Error("请等待当前智能体任务完成后，再更改项目权限。");
			}

			const workspacePath = this.workspacePath;
			try {
				await this.trustStore.setTrusted(workspacePath, trusted);
				this.auditLog.write("workspace.trust", trusted ? "allowed" : "denied", {
					workspaceKey: getWorkspaceKey(workspacePath),
				});
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
		if (this.session?.isStreaming) {
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
						void shell.openExternal(event.url).catch((error: unknown) => {
							this.error = error instanceof Error ? error.message : "无法打开 OAuth 登录页面。";
							this.publish();
						});
					}
					this.authenticationNotice =
						event.type === "auth_url"
							? (event.instructions ?? "请在浏览器窗口中完成模型服务商登录。")
							: event.type === "device_code"
								? `请在 ${event.verificationUri} 输入验证码 ${event.userCode}。`
								: event.message;
					this.publish();
				},
			});
			await modelRuntime.refresh({ allowNetwork: true, signal: controller.signal });
			this.auditLog.write("credential.configure", "succeeded", { providerId, authType });
			if (!workspacePath) return this.publish();
			return await this.enqueueWorkspaceChange(() => this.openWorkspaceInternal(workspacePath));
		} catch (error) {
			this.auditLog.write("credential.configure", "failed", { providerId, authType });
			this.error = error instanceof Error ? error.message : "模型服务商配置失败，请检查填写内容后重试。";
			return this.publish();
		} finally {
			this.authenticationPromptQueue.cancelAll();
			if (this.authenticationController === controller) {
				this.authenticationController = undefined;
			}
			this.authenticationNotice = undefined;
			this.providerSetupInProgress = false;
			this.publish();
		}
	}

	async logoutProvider(providerId: string): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) throw new Error("请等待当前智能体任务完成后，再断开模型服务商。");
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

	async readWorkspaceFile(path: string): Promise<DesktopWorkspaceFilePreview> {
		return this.getTrustedWorkspaceBrowser().read(path);
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
			...(provider.name === undefined ? {} : { name: provider.name }),
			...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
			...(provider.api === undefined ? {} : { api: provider.api }),
			...(provider.models === undefined
				? {}
				: {
						models: provider.models.map((model) => ({
							id: model.id,
							...(model.name === undefined ? {} : { name: model.name }),
							...(model.api === undefined ? {} : { api: model.api }),
							...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
							...(model.input === undefined ? {} : { input: model.input }),
							...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
							...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
							...(model.cost === undefined ? {} : { cost: model.cost }),
						})),
					}),
		}));
	}

	async saveModelsConfig(providers: DesktopProviderConfig[]): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再保存模型配置。");
		}

		const currentConfig = await readModelsConfig(modelsJsonPathFor(this.agentDir));
		const config: ModelsJson = {
			providers: Object.fromEntries(
				providers.map((provider): [string, ModelsJsonProvider] => [
					provider.id,
					{
						...(provider.name === undefined ? {} : { name: provider.name }),
						...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
						...(provider.apiKey === undefined
							? currentConfig.providers[provider.id]?.apiKey === undefined
								? {}
								: { apiKey: currentConfig.providers[provider.id].apiKey }
							: { apiKey: provider.apiKey }),
						...(provider.api === undefined ? {} : { api: provider.api }),
						...(provider.models === undefined
							? {}
							: {
									models: provider.models.map((model) => ({
										id: model.id,
										...(model.name === undefined ? {} : { name: model.name }),
										...(model.api === undefined ? {} : { api: model.api }),
										...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
										...(model.input === undefined ? {} : { input: model.input }),
										...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
										...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
										...(model.cost === undefined ? {} : { cost: model.cost }),
									})),
								}),
					},
				]),
			),
		};
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
			const apiKey = provider.apiKey ?? storedConfig.providers[provider.id]?.apiKey;
			await writeFile(
				modelsPath,
				JSON.stringify({
					providers: { [provider.id]: { ...provider, apiKey, id: undefined, models: [{ ...model }] } },
				}),
			);
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
		if (this.session?.isStreaming) {
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
		if (this.session?.isStreaming) {
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
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再安装插件。");
		}
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
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再移除插件。");
		}
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

	async getPluginPackages(): Promise<Array<{ source: string; scope: "user" | "project" }>> {
		const settingsManager = this.requireSettingsManager();
		const result: Array<{ source: string; scope: "user" | "project" }> = [];
		for (const pkg of settingsManager.getPackages()) {
			result.push({ source: typeof pkg === "string" ? pkg : pkg.source, scope: "user" });
		}
		for (const pkg of settingsManager.getProjectSettings().packages ?? []) {
			result.push({ source: typeof pkg === "string" ? pkg : pkg.source, scope: "project" });
		}
		return result;
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
		await this.disposeSession();

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

	async addGitWorktree(branch: string): Promise<DesktopGitWorktree> {
		const workspacePath = this.requireWorkspacePath();
		return gitAddWorktree(workspacePath, branch);
	}

	async removeGitWorktree(path: string): Promise<void> {
		const workspacePath = this.requireWorkspacePath();
		await gitRemoveWorktree(workspacePath, path);
	}

	requireWorkspacePath(): string {
		if (!this.workspacePath) {
			throw new Error("请先选择项目。");
		}
		return this.workspacePath;
	}

	async dispose(): Promise<void> {
		this.workspaceWatcher.stop();
		await this.disposeSession();
	}

	private async disposeSession(): Promise<void> {
		this.approvalQueue.cancelAll();
		this.authenticationController?.abort();
		this.authenticationController = undefined;
		this.authenticationPromptQueue.cancelAll();
		this.unsubscribeSession?.();
		this.unsubscribeSession = undefined;
		this.session?.dispose();
		this.session = undefined;
		this.workspacePath = undefined;
		this.sessionDirectory = undefined;
		this.projectTrusted = false;
		this.sessions = [];
		this.error = undefined;
	}

	private async refreshSessions(): Promise<void> {
		if (!this.workspacePath || !this.sessionDirectory) {
			this.sessions = [];
			return;
		}
		try {
			const infos = await SessionManager.list(this.workspacePath, this.sessionDirectory);
			this.sessions = infos.map((info) => ({
				path: info.path,
				id: info.id,
				...(info.name === undefined ? {} : { name: info.name }),
				cwd: info.cwd,
				created: info.created.getTime(),
				modified: info.modified.getTime(),
				messageCount: info.messageCount,
				firstMessage: info.firstMessage,
			}));
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
		const snapshot = this.getSnapshot();
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
		return this.modelRuntime
			.getAvailableSnapshot()
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
