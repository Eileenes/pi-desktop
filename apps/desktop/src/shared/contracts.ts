export type DesktopSessionPhase = "idle" | "running" | "error" | "unavailable";

export interface DesktopTranscriptMessage {
	id: string;
	role: "assistant" | "system" | "tool" | "user";
	text: string;
	timestamp?: number;
}

export interface DesktopSessionSnapshot {
	id: string;
	name?: string;
	phase: DesktopSessionPhase;
	model?: {
		provider: string;
		id: string;
	};
	thinkingLevel?: string;
	messages: DesktopTranscriptMessage[];
}

export interface DesktopSessionInfo {
	path: string;
	id: string;
	name?: string;
	cwd: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
}

export interface DesktopToolApproval {
	id: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	requestedAt: number;
}

export interface DesktopApiKeyProvider {
	id: string;
	name: string;
	configured: boolean;
}

export interface DesktopModel {
	provider: string;
	id: string;
	name: string;
	supportsImages: boolean;
}

export interface DesktopSkill {
	name: string;
	description: string;
}

export interface DesktopPlugin {
	name: string;
	commands: string[];
}

export interface DesktopImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
}

export interface DesktopAuthenticationPrompt {
	id: string;
	type: "manual_code" | "secret" | "select" | "text";
	message: string;
	placeholder?: string;
	options?: Array<{
		id: string;
		label: string;
		description?: string;
	}>;
	requestedAt: number;
}

export interface DesktopWorkspaceEntry {
	path: string;
	name: string;
	type: "directory" | "file";
	depth: number;
}

export interface DesktopWorkspaceFilePreview {
	path: string;
	content: string;
	/** 图片文件的数据 URL（仅图片文件存在）。 */
	imageDataUrl?: string;
	/** 音频文件的数据 URL（仅音频文件存在）。 */
	audioDataUrl?: string;
}

export interface DesktopSessionStats {
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}

export interface DesktopSnapshot {
	workspacePath?: string;
	projectTrusted: boolean;
	pendingToolApprovals: DesktopToolApproval[];
	pendingAuthenticationPrompts: DesktopAuthenticationPrompt[];
	apiKeyProviders: DesktopApiKeyProvider[];
	availableModels: DesktopModel[];
	skills: DesktopSkill[];
	plugins: DesktopPlugin[];
	providerSetupInProgress: boolean;
	sessions: DesktopSessionInfo[];
	sessionStats?: DesktopSessionStats;
	branchPoints?: DesktopBranchPoint[];
	notice?: string;
	session?: DesktopSessionSnapshot;
}

export interface DesktopBranchPoint {
	entryId: string;
	text: string;
}

export interface DesktopGitChange {
	path: string;
	status: "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";
}

export interface DesktopGitWorktree {
	path: string;
	branch: string;
}

export interface DesktopProviderConfig {
	id: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	models?: Array<{ id: string; name?: string }>;
}

export interface DesktopSaveModelsConfigInput {
	providers: DesktopProviderConfig[];
}

export interface DesktopDiscoverModelsInput {
	baseUrl: string;
	apiKey?: string;
}

export interface DesktopGitDiffInput {
	path: string;
}

export interface DesktopAddWorktreeInput {
	branch: string;
}

export interface DesktopOpenWorkspacePathInput {
	path: string;
}

export interface DesktopPromptInput {
	text: string;
	attachmentIds?: string[];
}

export interface DesktopOpenSessionInput {
	sessionPath: string;
}

export interface DesktopNavigateTreeInput {
	entryId: string;
}

export interface DesktopProjectTrustInput {
	trusted: boolean;
}

export interface DesktopToolApprovalDecisionInput {
	id: string;
	approved: boolean;
}

export interface DesktopProviderSetupInput {
	providerId: string;
}

export interface DesktopAuthenticationPromptResponseInput {
	id: string;
	response: string;
}

export interface DesktopWorkspaceFileInput {
	path: string;
}

export type DesktopSnapshotListener = (snapshot: DesktopSnapshot) => void;
export type Unsubscribe = () => void;

export interface DesktopApi {
	bootstrap(): Promise<DesktopSnapshot>;
	chooseWorkspace(): Promise<DesktopSnapshot>;
	chooseImages(): Promise<DesktopImageAttachment[]>;
	prompt(input: DesktopPromptInput): Promise<DesktopSnapshot>;
	openSession(input: DesktopOpenSessionInput): Promise<DesktopSnapshot>;
	newSession(): Promise<DesktopSnapshot>;
	navigateTree(input: DesktopNavigateTreeInput): Promise<DesktopSnapshot>;
	forkSession(): Promise<DesktopSnapshot>;
	setModel(input: DesktopModelSelectionInput): Promise<DesktopSnapshot>;
	setProjectTrust(input: DesktopProjectTrustInput): Promise<DesktopSnapshot>;
	decideToolApproval(input: DesktopToolApprovalDecisionInput): Promise<DesktopSnapshot>;
	startProviderSetup(input: DesktopProviderSetupInput): Promise<DesktopSnapshot>;
	respondToAuthenticationPrompt(input: DesktopAuthenticationPromptResponseInput): Promise<DesktopSnapshot>;
	listWorkspaceFiles(): Promise<DesktopWorkspaceEntry[]>;
	readWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<DesktopWorkspaceFilePreview>;
	openWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<void>;
	revealWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<void>;
	openExternalUrl(url: string): Promise<void>;
	notifyComplete(): Promise<void>;
	listGitChanges(): Promise<DesktopGitChange[]>;
	getGitDiff(input: DesktopGitDiffInput): Promise<string>;
	listGitWorktrees(): Promise<DesktopGitWorktree[]>;
	addGitWorktree(input: DesktopAddWorktreeInput): Promise<DesktopGitWorktree>;
	openWorkspacePath(input: DesktopOpenWorkspacePathInput): Promise<DesktopSnapshot>;
	setCloseQuits(closeQuits: boolean): Promise<void>;
	quitApp(): Promise<void>;
	getModelsConfig(): Promise<DesktopProviderConfig[]>;
	saveModelsConfig(input: DesktopSaveModelsConfigInput): Promise<DesktopSnapshot>;
	discoverModels(input: DesktopDiscoverModelsInput): Promise<Array<{ id: string }>>;
	onSnapshot(listener: DesktopSnapshotListener): Unsubscribe;
}

export interface DesktopModelSelectionInput {
	provider: string;
	modelId: string;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const actualKeys = Object.keys(value);
	return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isDesktopPromptInput(value: unknown): value is DesktopPromptInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const input = value as Record<string, unknown>;
	const keys = Object.keys(input);
	if (!keys.every((key) => key === "text" || key === "attachmentIds")) return false;
	if (typeof input.text !== "string") return false;
	if (input.attachmentIds === undefined) return true;
	return (
		Array.isArray(input.attachmentIds) &&
		input.attachmentIds.length <= 5 &&
		input.attachmentIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)
	);
}

export function isDesktopOpenSessionInput(value: unknown): value is DesktopOpenSessionInput {
	return (
		isExactRecord(value, ["sessionPath"]) &&
		typeof value.sessionPath === "string" &&
		value.sessionPath.length > 0 &&
		value.sessionPath.length <= 2000
	);
}

export function isDesktopNavigateTreeInput(value: unknown): value is DesktopNavigateTreeInput {
	return (
		isExactRecord(value, ["entryId"]) &&
		typeof value.entryId === "string" &&
		value.entryId.length > 0 &&
		value.entryId.length <= 200
	);
}

export function isDesktopOpenExternalUrlInput(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 2000) return false;
	return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:");
}

export function isDesktopGitDiffInput(value: unknown): value is DesktopGitDiffInput {
	return (
		isExactRecord(value, ["path"]) &&
		typeof value.path === "string" &&
		value.path.length > 0 &&
		value.path.length <= 2000
	);
}

export function isDesktopAddWorktreeInput(value: unknown): value is DesktopAddWorktreeInput {
	return (
		isExactRecord(value, ["branch"]) &&
		typeof value.branch === "string" &&
		value.branch.length > 0 &&
		value.branch.length <= 200 &&
		/^[A-Za-z0-9._/-]+$/u.test(value.branch)
	);
}

export function isDesktopOpenWorkspacePathInput(value: unknown): value is DesktopOpenWorkspacePathInput {
	return (
		isExactRecord(value, ["path"]) &&
		typeof value.path === "string" &&
		value.path.length > 0 &&
		value.path.length <= 2000
	);
}

export function isDesktopDiscoverModelsInput(value: unknown): value is DesktopDiscoverModelsInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const input = value as Record<string, unknown>;
	if (typeof input.baseUrl !== "string" || input.baseUrl.length === 0 || input.baseUrl.length > 2000) return false;
	if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 2000)) return false;
	return true;
}

export function isDesktopSaveModelsConfigInput(value: unknown): value is DesktopSaveModelsConfigInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const input = value as Record<string, unknown>;
	if (!Array.isArray(input.providers) || input.providers.length > 500) return false;
	return input.providers.every((provider) => {
		if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return false;
		const record = provider as Record<string, unknown>;
		return typeof record.id === "string" && record.id.length > 0 && record.id.length <= 200;
	});
}

export function isDesktopModelSelectionInput(value: unknown): value is DesktopModelSelectionInput {
	return (
		isExactRecord(value, ["provider", "modelId"]) &&
		typeof value.provider === "string" &&
		value.provider.length > 0 &&
		value.provider.length <= 200 &&
		typeof value.modelId === "string" &&
		value.modelId.length > 0 &&
		value.modelId.length <= 500
	);
}

export function isDesktopProjectTrustInput(value: unknown): value is DesktopProjectTrustInput {
	return isExactRecord(value, ["trusted"]) && typeof value.trusted === "boolean";
}

export function isDesktopToolApprovalDecisionInput(value: unknown): value is DesktopToolApprovalDecisionInput {
	return (
		isExactRecord(value, ["id", "approved"]) &&
		typeof value.id === "string" &&
		value.id.length > 0 &&
		typeof value.approved === "boolean"
	);
}

export function isDesktopProviderSetupInput(value: unknown): value is DesktopProviderSetupInput {
	return (
		isExactRecord(value, ["providerId"]) &&
		typeof value.providerId === "string" &&
		value.providerId.length > 0 &&
		value.providerId.length <= 200
	);
}

export function isDesktopAuthenticationPromptResponseInput(
	value: unknown,
): value is DesktopAuthenticationPromptResponseInput {
	return (
		isExactRecord(value, ["id", "response"]) &&
		typeof value.id === "string" &&
		value.id.length > 0 &&
		typeof value.response === "string" &&
		value.response.length <= 10_000
	);
}

export function isDesktopWorkspaceFileInput(value: unknown): value is DesktopWorkspaceFileInput {
	return (
		isExactRecord(value, ["path"]) &&
		typeof value.path === "string" &&
		value.path.length > 0 &&
		value.path.length <= 2_000 &&
		!value.path.includes("\\") &&
		!value.path.startsWith("/") &&
		!value.path.includes("\0") &&
		!value.path.split("/").includes("..")
	);
}
