import { mkdir } from "node:fs/promises";
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
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopModel,
	DesktopPlugin,
	DesktopProviderConfig,
	DesktopSessionInfo,
	DesktopSessionPhase,
	DesktopSessionStats,
	DesktopSkill,
	DesktopSnapshot,
	DesktopTranscriptMessage,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";
import { AuthenticationPromptQueue } from "./authentication-prompt-queue.ts";
import {
	addGitWorktree as gitAddWorktree,
	getGitDiff as gitGetDiff,
	listGitChanges as gitListChanges,
	listGitWorktrees as gitListWorktrees,
} from "./git-integration.ts";
import {
	discoverModels as discoverModelsFromUrl,
	type ModelsJson,
	type ModelsJsonProvider,
	modelsJsonPathFor,
	readModelsConfig,
	writeModelsConfig,
} from "./models-config-store.ts";
import { setSkillDisableModelInvocation } from "./skill-toggle.ts";
import { ToolApprovalQueue } from "./tool-approval-queue.ts";
import { TrustedWorkspaceBrowser } from "./trusted-workspace-browser.ts";
import { getWorkspaceKey, WorkspaceTrustStore } from "./workspace-trust-store.ts";

type SnapshotListener = (snapshot: DesktopSnapshot) => void;

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

function contentToText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";

	const parts: string[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const block = item as Record<string, unknown>;
		if (typeof block.text === "string") {
			parts.push(block.text);
			continue;
		}
		if (typeof block.thinking === "string") {
			parts.push(block.thinking);
			continue;
		}
		if (typeof block.toolName === "string") {
			parts.push(`工具调用：${block.toolName}`);
			continue;
		}
		if (block.type === "image") parts.push("图片附件");
	}
	return parts.join("\n");
}

function toTranscriptMessage(message: unknown, index: number): DesktopTranscriptMessage {
	if (typeof message !== "object" || message === null || Array.isArray(message)) {
		return { id: String(index), role: "system", text: "不支持的会话消息" };
	}

	const value = message as Record<string, unknown>;
	const timestamp = typeof value.timestamp === "number" ? value.timestamp : undefined;
	return {
		id: `${index}:${timestamp ?? ""}`,
		role: toMessageRole(value.role),
		text: contentToText(value.content),
		...(timestamp === undefined ? {} : { timestamp }),
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

	constructor(agentDir: string) {
		this.agentDir = agentDir;
		this.approvalQueue = new ToolApprovalQueue({ onChange: () => this.publish() });
		this.authenticationPromptQueue = new AuthenticationPromptQueue({ onChange: () => this.publish() });
		this.trustStore = new WorkspaceTrustStore(join(agentDir, "trusted-workspaces.json"));
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
			pendingToolApprovals: this.approvalQueue.getPendingApprovals(),
			pendingAuthenticationPrompts: this.authenticationPromptQueue.getPendingPrompts(),
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
			this.error ??
			this.authenticationNotice ??
			(this.projectTrusted
				? "项目资源已信任。每次工具调用仍需要单独确认。"
				: "未选择项目时，智能体可以对话，但不会读取文件或调用项目工具。");
		snapshot.session = {
			id: this.session.sessionId,
			...(this.session.sessionName === undefined ? {} : { name: this.session.sessionName }),
			phase: toPhase(this.session, this.error),
			...(model === undefined ? {} : { model: { provider: model.provider, id: model.id } }),
			thinkingLevel: this.session.thinkingLevel,
			messages: this.session.messages.map(toTranscriptMessage),
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

		this.workspacePath = options.workspacePath;
		this.sessionDirectory = options.sessionDirectory;
		this.projectTrusted = options.projectTrusted;
		this.session = created.session;
		this.error = created.modelFallbackMessage ? "没有可用模型。请在设置中配置模型服务商。" : undefined;
		this.unsubscribeSession = this.session.subscribe(() => this.publish());
		await this.refreshSessions();
	}

	async prompt(text: string, images: DesktopPromptImage[] = []): Promise<DesktopSnapshot> {
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

		this.error = undefined;
		try {
			await this.session.prompt(text, {
				images: images.map((image) => ({ ...image, type: "image" as const })),
				source: "interactive",
			});
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
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
				return await this.openWorkspaceInternal(workspacePath);
			} catch (error) {
				this.error = error instanceof Error ? error.message : String(error);
				return this.publish();
			}
		});
	}

	decideToolApproval(id: string, approved: boolean): DesktopSnapshot {
		if (!this.approvalQueue.resolve(id, approved)) {
			throw new Error("This tool approval request is no longer pending.");
		}
		return this.getSnapshot();
	}

	async startProviderSetup(providerId: string): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再更改模型认证信息。");
		}
		if (this.providerSetupInProgress) {
			throw new Error("已有模型服务商配置正在进行中。");
		}

		const modelRuntime = await this.getModelRuntime();
		const provider = modelRuntime.getProviders().find((candidate) => candidate.id === providerId);
		if (!provider?.auth.apiKey?.login) {
			throw new Error("该模型服务商暂不支持在 Pi 桌面端中配置 API Key。");
		}
		const workspacePath = this.workspacePath;
		const controller = new AbortController();
		this.providerSetupInProgress = true;
		this.authenticationController = controller;
		this.authenticationNotice = undefined;
		this.error = undefined;
		this.publish();

		try {
			await modelRuntime.login(providerId, "api_key", {
				signal: controller.signal,
				prompt: async (prompt) => {
					return this.authenticationPromptQueue.request(this.toDesktopAuthenticationPrompt(prompt), prompt.signal);
				},
				notify: (event) => {
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
			if (!workspacePath) return this.publish();
			return await this.enqueueWorkspaceChange(() => this.openWorkspaceInternal(workspacePath));
		} catch {
			this.error = "模型服务商配置失败，请检查填写内容后重试。";
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
			...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
			...(provider.api === undefined ? {} : { api: provider.api }),
			...(provider.models === undefined
				? {}
				: {
						models: provider.models.map((model) => ({
							id: model.id,
							...(model.name === undefined ? {} : { name: model.name }),
							...(model.cost === undefined ? {} : { cost: model.cost }),
						})),
					}),
		}));
	}

	async saveModelsConfig(providers: DesktopProviderConfig[]): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再保存模型配置。");
		}

		const config: ModelsJson = {
			providers: Object.fromEntries(
				providers.map((provider): [string, ModelsJsonProvider] => [
					provider.id,
					{
						...(provider.name === undefined ? {} : { name: provider.name }),
						...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
						...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
						...(provider.api === undefined ? {} : { api: provider.api }),
						...(provider.models === undefined
							? {}
							: {
									models: provider.models.map((model) => ({
										id: model.id,
										...(model.name === undefined ? {} : { name: model.name }),
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

	async discoverModels(baseUrl: string, apiKey?: string): Promise<Array<{ id: string }>> {
		return discoverModelsFromUrl(baseUrl, apiKey);
	}

	async toggleSkill(filePath: string, disable: boolean): Promise<DesktopSnapshot> {
		if (this.session?.isStreaming) {
			throw new Error("请等待当前智能体任务完成后，再修改技能。");
		}
		await setSkillDisableModelInvocation(filePath, disable);
		if (this.session) {
			await this.session.resourceLoader.reload();
		}
		return this.publish();
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
		await packageManager.installAndPersist(source, { local });
		return this.reloadSessionResources();
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
		await packageManager.removeAndPersist(source, { local });
		return this.reloadSessionResources();
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
		return gitGetDiff(workspacePath, path);
	}

	async listGitWorktrees(): Promise<DesktopGitWorktree[]> {
		const workspacePath = this.requireWorkspacePath();
		return gitListWorktrees(workspacePath);
	}

	async addGitWorktree(branch: string): Promise<DesktopGitWorktree> {
		const workspacePath = this.requireWorkspacePath();
		return gitAddWorktree(workspacePath, branch);
	}

	private requireWorkspacePath(): string {
		if (!this.workspacePath) {
			throw new Error("请先选择项目。");
		}
		return this.workspacePath;
	}

	async dispose(): Promise<void> {
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
			.filter((provider) => provider.auth.apiKey?.login !== undefined)
			.map((provider) => ({
				id: provider.id,
				name: provider.name,
				configured: this.modelRuntime?.getProviderAuthStatus(provider.id).configured ?? false,
			}));
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

	private getSkills(): DesktopSkill[] {
		if (!this.session) return [];
		return this.session.resourceLoader
			.getSkills()
			.skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
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
