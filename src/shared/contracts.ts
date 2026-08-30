export type DesktopSessionPhase = "idle" | "running" | "error" | "unavailable";

export type DesktopTranscriptBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "toolCall"; id: string; name: string; input: string }
	| { type: "image"; label: string; thumbnailDataUrl?: string };

export interface DesktopTranscriptMessage {
	id: string;
	role: "assistant" | "custom" | "system" | "tool" | "user";
	text: string;
	blocks?: DesktopTranscriptBlock[];
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	command?: string;
	exitCode?: number;
	cancelled?: boolean;
	truncated?: boolean;
	fullOutputAvailable?: boolean;
	forkEntryId?: string;
	stopReason?: string;
	errorMessage?: string;
	customType?: string;
	display?: string;
	details?: string;
	timestamp?: number;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	};
}

export type DesktopThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type DesktopToolPreset = "none" | "default" | "full";
export type DesktopThinkingLevelMap = Partial<Record<Exclude<DesktopThinkingLevel, "auto">, string | null>>;

export interface DesktopSessionSnapshot {
	id: string;
	name?: string;
	phase: DesktopSessionPhase;
	pendingMessages: Array<{
		behavior: "steer" | "followUp";
		text: string;
	}>;
	model?: {
		provider: string;
		id: string;
	};
	thinkingLevel?: DesktopThinkingLevel;
	availableThinkingLevels?: DesktopThinkingLevel[];
	activeToolNames?: string[];
	isCompacting?: boolean;
	autoRetry?: {
		attempt: number;
		maxAttempts: number;
		errorMessage: string;
	};
	lastCompaction?: {
		tokensBefore: number;
		tokensAfter?: number;
		reason: string;
	};
	runningTools?: string[];
	systemPrompt?: string;
	messages: DesktopTranscriptMessage[];
}

export interface DesktopSessionInfo {
	path: string;
	id: string;
	name?: string;
	cwd: string;
	projectRoot?: string;
	worktreeBranch?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	parentSessionPath?: string;
	phase?: DesktopSessionPhase;
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
	credentialType?: "api_key" | "oauth";
	supportsApiKey: boolean;
	supportsOAuth: boolean;
	oauthName?: string;
}

export interface DesktopModel {
	provider: string;
	id: string;
	name: string;
	supportsImages: boolean;
	thinkingLevelMap?: DesktopThinkingLevelMap;
}

export interface DesktopSkill {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
}

export interface DesktopSkillInstallInfo {
	package: string;
	scope: "global" | "project";
	source: string;
	sourceType?: string;
	skillsShUrl?: string;
	skillPath?: string;
	ref?: string;
	versionHash?: string;
	canCheckForUpdates: boolean;
}

export interface DesktopSkillInfo {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
	scope: "global" | "project";
	/** False when the skill failed to parse and is dormant (unavailable). */
	available?: boolean;
	/** Parse failure reason for dormant skills. */
	error?: string;
	install?: DesktopSkillInstallInfo;
}

export interface DesktopSkillSearchResult {
	package: string;
	installs: string;
	url: string;
}

export interface DesktopSkillUpdateResult {
	package: string;
	scope: "global" | "project";
	state: "up-to-date" | "update-available" | "unsupported" | "error";
	currentVersion?: string;
	latestVersion?: string;
	message?: string;
}

export interface DesktopPlugin {
	name: string;
	commands: string[];
}

export interface DesktopPluginPackageResourceFilters {
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
}

export interface DesktopPluginResourceInfo {
	name: string;
	path: string;
	relativePath: string;
}

export interface DesktopPluginDiagnostic {
	type: "error" | "warning";
	message: string;
	source?: string;
	path?: string;
}

export interface DesktopPluginPackage {
	source: string;
	scope: "user" | "project";
	status: "disabled" | "error" | "installed" | "loaded" | "missing";
	enabled: boolean;
	/** Resource filters from the package manager settings. */
	filtered?: boolean;
	/** Whether the package configuration allows automatic loading; undefined for plain string sources. */
	autoload?: boolean;
	/** Configured resource filter patterns, when the package uses object-form configuration. */
	filters?: DesktopPluginPackageResourceFilters;
	/** Version recorded by the package configuration, when available. */
	configuredVersion?: string;
	installedPath?: string;
	packageName?: string;
	version?: string;
	resources: {
		extensions: DesktopPluginResourceInfo[];
		skills: DesktopPluginResourceInfo[];
		prompts: DesktopPluginResourceInfo[];
		themes: DesktopPluginResourceInfo[];
	};
	diagnostics: DesktopPluginDiagnostic[];
}

export interface DesktopPluginPackagesResult {
	packages: DesktopPluginPackage[];
	diagnostics: DesktopPluginDiagnostic[];
	hasActiveSession: boolean;
	projectResourcesLoaded: boolean;
}

export interface DesktopPluginPackageFilterInput {
	source: string;
	local: boolean;
	autoload: boolean;
	filters: DesktopPluginPackageResourceFilters;
}

export interface DesktopImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	/** Small preview generated in the main process; original bytes never cross the bridge. */
	thumbnailDataUrl?: string;
}

export interface DesktopRestoreImageAttachmentsInput {
	ids: string[];
}

export interface DesktopRestoreMessageImagesInput {
	messageId: string;
}

export interface DesktopDirectoryEntry {
	name: string;
	path: string;
}

export interface DesktopDirectoryListing {
	path: string;
	parentPath?: string;
	directories: DesktopDirectoryEntry[];
	drives?: DesktopDirectoryEntry[];
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

export interface DesktopWorkspaceDirectoryListing {
	/** Workspace-relative directory path ("" for the project root). */
	path: string;
	directories: DesktopWorkspaceEntry[];
	files: DesktopWorkspaceEntry[];
	/** True when the directory has more entries than the listing cap. */
	truncated?: boolean;
}

export interface DesktopWorkspaceFilePreview {
	path: string;
	content: string;
	/** 图片文件的数据 URL（仅图片文件存在）。 */
	imageDataUrl?: string;
	/** 音频文件的数据 URL（仅音频文件存在）。 */
	audioDataUrl?: string;
	/** PDF 文件的数据 URL（仅 PDF 文件存在）。 */
	pdfDataUrl?: string;
	/** DOCX 渲染后的安全 HTML（仅 DOCX 文件存在）。 */
	docxHtml?: string;
	/** 二进制文件原始数据 URL，用于保存原文件。 */
	binaryDataUrl?: string;
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

export interface DesktopModelScopeStatus {
	/** Non-empty enabledModels patterns configured by the user. */
	patterns: string[];
	/** Resolution diagnostics (for example an unmatched wildcard). */
	warnings: string[];
	/** Number of models matched by the scope; 0 means fallback to all authenticated models. */
	matched: number;
	/** Thinking levels fixed by `provider/model:level` rules. */
	fixedLevels: Array<{ provider: string; modelId: string; level: string }>;
}

export interface DesktopSnapshot {
	workspacePath?: string;
	projectTrusted: boolean;
	userHomeName?: string;
	extensionStatuses?: DesktopExtensionStatus[];
	extensionWidgets?: DesktopExtensionWidget[];
	extensionEditorRequest?: DesktopExtensionEditorRequest;
	modelScope?: DesktopModelScopeStatus;
	pendingToolApprovals: DesktopToolApproval[];
	pendingAuthenticationPrompts: DesktopAuthenticationPrompt[];
	apiKeyProviders: DesktopApiKeyProvider[];
	availableModels: DesktopModel[];
	skills: DesktopSkill[];
	plugins: DesktopPlugin[];
	providerSetupInProgress: boolean;
	/** Human-readable OAuth/device-code instructions while provider setup is active. */
	authenticationNotice?: string;
	/** URL emitted by the provider's OAuth/device-code flow, when available. */
	authenticationUrl?: string;
	/** Device-code value emitted by OAuth providers, kept separate for copy/paste UX. */
	authenticationUserCode?: string;
	/** Absolute expiry timestamp for the current device code, when supplied by the provider. */
	authenticationExpiresAt?: number;
	sessions: DesktopSessionInfo[];
	sessionStats?: DesktopSessionStats;
	branchPoints?: DesktopBranchPoint[];
	branchTree?: DesktopSessionTreeNode[];
	branchActiveLeafId?: string | null;
	notice?: string;
	session?: DesktopSessionSnapshot;
}

export interface DesktopBranchPoint {
	entryId: string;
	text: string;
}

export interface DesktopSessionTreeNode {
	entry: {
		id: string;
		type: string;
		role?: string;
		text?: string;
	};
	children: DesktopSessionTreeNode[];
}

export interface DesktopGitChange {
	path: string;
	status: "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";
}

export interface DesktopGitWorktree {
	path: string;
	branch: string;
	isMain: boolean;
}

export interface DesktopRemoveWorktreeResult {
	dirty?: boolean;
}

export interface DesktopGitBranches {
	local: string[];
	remote: string[];
}

export interface DesktopProviderModelConfig {
	id: string;
	/** Original models.json key used by the main process for lossless renames. */
	sourceId?: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	/** Optional provider-specific mapping for Pi thinking levels. */
	thinkingLevelMap?: Record<string, string | null>;
	/** Provider compatibility flags (for example DeepSeek thinking format). */
	compat?: Record<string, unknown>;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface DesktopProviderConfig {
	id: string;
	/** Original models.json key used by the main process for lossless renames. */
	sourceId?: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	models?: DesktopProviderModelConfig[];
}

export interface DesktopSaveModelsConfigInput {
	providers: DesktopProviderConfig[];
}

export interface DesktopModelScope {
	patterns: string[];
	warnings: string[];
}

export interface DesktopDiscoverModelsInput {
	providerId: string;
	baseUrl: string;
	apiKey?: string;
}

export interface DesktopToggleSkillInput {
	filePath: string;
	disable: boolean;
}

export interface DesktopPluginSourceInput {
	source: string;
	local: boolean;
}

export interface DesktopConfirmedPluginActionResult {
	snapshot: DesktopSnapshot;
	performed: boolean;
}

export interface DesktopTogglePluginInput extends DesktopPluginSourceInput {
	enabled: boolean;
}

export interface DesktopGitDiffInput {
	path: string;
}

export interface DesktopAddWorktreeInput {
	branch: string;
}

export interface DesktopSwitchGitBranchInput {
	branch: string;
}

export interface DesktopRemoveWorktreeInput {
	path: string;
	force?: boolean;
}

export interface DesktopOpenWorkspacePathInput {
	path: string;
}

export interface DesktopPromptInput {
	text: string;
	attachmentIds?: string[];
	/** Labels explicitly selected from the session mention menu. */
	sessionReferenceLabels?: string[];
	streamingBehavior?: "steer" | "followUp";
}

export interface DesktopOpenSessionInput {
	sessionPath: string;
}

export interface DesktopNavigateTreeInput {
	entryId: string;
}

export interface DesktopRenameSessionInput {
	sessionPath: string;
	name: string;
}

export interface DesktopNotificationInput {
	sessionName?: string;
	force?: boolean;
}

export interface DesktopDeleteSessionInput {
	sessionPath: string;
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
	authType: "api_key" | "oauth";
}

export interface DesktopProviderLogoutInput {
	providerId: string;
}

export interface DesktopModelTestInput {
	provider: DesktopProviderConfig;
	model: DesktopProviderModelConfig;
}

export interface DesktopModelTestResult {
	ok: boolean;
	latencyMs?: number;
	status?: number;
	responseText?: string;
	error?: string;
}

export interface DesktopUpdateAsset {
	name: string;
	sizeBytes: number;
	url: string;
}

export interface DesktopUpdateInfo {
	currentVersion: string;
	latestVersion?: string;
	releaseUrl: string;
	updateAvailable: boolean;
	checkedAt: number;
	/** Release assets matching the current platform; URLs are resolved by the main process. */
	assets?: DesktopUpdateAsset[];
}

export type DesktopUpdateDownloadState =
	| { phase: "idle" }
	| { phase: "downloading"; assetName: string; receivedBytes: number; totalBytes?: number }
	| { phase: "completed"; assetName: string; savedPath: string }
	| { phase: "cancelled"; assetName: string }
	| { phase: "failed"; assetName: string; message: string };

export interface DesktopUpdateDownloadInput {
	assetName: string;
}

export interface DesktopAuthenticationPromptResponseInput {
	id: string;
	response: string;
}

export type DesktopExtensionDialog =
	| { kind: "select"; id: string; title: string; options: string[] }
	| { kind: "confirm"; id: string; title: string; message: string }
	| { kind: "input"; id: string; title: string; placeholder?: string }
	| { kind: "editor"; id: string; title: string; prefill?: string };

export interface DesktopExtensionWidget {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
}

export interface DesktopExtensionEditorRequest {
	id: number;
	text: string;
	mode: "insert" | "replace";
}

export type DesktopExtensionUiEvent =
	| { type: "dialog"; sessionId: string; dialog: DesktopExtensionDialog }
	| { type: "dialogClosed"; sessionId: string; id: string }
	| { type: "custom"; sessionId: string; id: string; lines: string[]; closed?: boolean };

export interface DesktopExtensionDialogResponseInput {
	id: string;
	value: string;
}

export interface DesktopExtensionCustomInput {
	id: string;
	data: string;
}

export type DesktopExtensionUiListener = (event: DesktopExtensionUiEvent) => void;

export interface DesktopExtensionStatus {
	key: string;
	text: string;
}

export interface DesktopWorkspaceChange {
	path: string;
}

export interface DesktopWorkspaceFileInput {
	path: string;
}

export interface DesktopBashOutputInput {
	messageId: string;
}

export interface DesktopImportedFileResult {
	name: string;
	path?: string;
	conflict?: boolean;
	error?: string;
}

export type DesktopSnapshotListener = (snapshot: DesktopSnapshot) => void;
export type Unsubscribe = () => void;

export interface DesktopApi {
	bootstrap(): Promise<DesktopSnapshot>;
	chooseWorkspace(): Promise<DesktopSnapshot>;
	openDefaultWorkspace(): Promise<DesktopSnapshot>;
	browseDirectories(path?: string): Promise<DesktopDirectoryListing>;
	selectDirectory(): Promise<string | undefined>;
	chooseImages(): Promise<DesktopImageAttachment[]>;
	attachDroppedImages(files: File[]): Promise<DesktopImageAttachment[]>;
	restoreImageAttachments(input: DesktopRestoreImageAttachmentsInput): Promise<DesktopImageAttachment[]>;
	restoreMessageImages(input: DesktopRestoreMessageImagesInput): Promise<DesktopImageAttachment[]>;
	discardImageAttachment(id: string): Promise<void>;
	importDroppedFiles(
		files: File[],
		overwriteConflicts?: boolean,
		targetDirectory?: string,
	): Promise<DesktopImportedFileResult[]>;
	prompt(input: DesktopPromptInput): Promise<DesktopSnapshot>;
	abort(): Promise<DesktopSnapshot>;
	clearQueue(): Promise<DesktopSnapshot>;
	openSession(input: DesktopOpenSessionInput): Promise<DesktopSnapshot>;
	newSession(): Promise<DesktopSnapshot>;
	navigateTree(input: DesktopNavigateTreeInput): Promise<DesktopSnapshot>;
	forkSession(): Promise<DesktopSnapshot>;
	autoNameSession(): Promise<DesktopSnapshot>;
	exportSession(): Promise<string>;
	renameSession(input: DesktopRenameSessionInput): Promise<DesktopSnapshot>;
	deleteSession(input: DesktopDeleteSessionInput): Promise<DesktopSnapshot>;
	executeBashCommand(command: string, excludeFromContext: boolean): Promise<string>;
	readFullBashOutput(input: DesktopBashOutputInput): Promise<string>;
	saveFullBashOutput(input: DesktopBashOutputInput): Promise<string>;
	copyLastAnswer(): Promise<string>;
	setModel(input: DesktopModelSelectionInput): Promise<DesktopSnapshot>;
	setThinkingLevel(level: DesktopThinkingLevel): Promise<DesktopSnapshot>;
	setToolPreset(preset: DesktopToolPreset): Promise<DesktopSnapshot>;
	compact(customInstructions?: string): Promise<DesktopSnapshot>;
	setProjectTrust(input: DesktopProjectTrustInput): Promise<DesktopSnapshot>;
	decideToolApproval(input: DesktopToolApprovalDecisionInput): Promise<DesktopSnapshot>;
	startProviderSetup(input: DesktopProviderSetupInput): Promise<DesktopSnapshot>;
	cancelProviderSetup(): Promise<DesktopSnapshot>;
	logoutProvider(input: DesktopProviderLogoutInput): Promise<DesktopSnapshot>;
	respondToAuthenticationPrompt(input: DesktopAuthenticationPromptResponseInput): Promise<DesktopSnapshot>;
	listWorkspaceFiles(): Promise<DesktopWorkspaceEntry[]>;
	listWorkspaceDirectory(path?: string): Promise<DesktopWorkspaceDirectoryListing>;
	searchWorkspaceFiles(query: string): Promise<DesktopWorkspaceEntry[]>;
	readWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<DesktopWorkspaceFilePreview>;
	openWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<void>;
	revealWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<void>;
	saveWorkspaceFile(input: DesktopWorkspaceFileInput): Promise<string>;
	respondToExtensionDialog(input: DesktopExtensionDialogResponseInput): Promise<void>;
	sendExtensionCustomInput(input: DesktopExtensionCustomInput): Promise<void>;
	onExtensionUi(listener: DesktopExtensionUiListener): Unsubscribe;
	onWorkspaceChanged(listener: (changes: DesktopWorkspaceChange[]) => void): Unsubscribe;
	openExternalUrl(url: string): Promise<void>;
	notifyComplete(input?: DesktopNotificationInput): Promise<void>;
	listGitChanges(): Promise<DesktopGitChange[]>;
	getGitDiff(input: DesktopGitDiffInput): Promise<string>;
	listGitWorktrees(): Promise<DesktopGitWorktree[]>;
	listGitBranches(): Promise<DesktopGitBranches>;
	fetchGitBranches(): Promise<void>;
	switchGitBranch(input: DesktopSwitchGitBranchInput): Promise<DesktopSnapshot>;
	addGitWorktree(input: DesktopAddWorktreeInput): Promise<DesktopGitWorktree>;
	removeGitWorktree(input: DesktopRemoveWorktreeInput): Promise<DesktopRemoveWorktreeResult>;
	openWorkspacePath(input: DesktopOpenWorkspacePathInput): Promise<DesktopSnapshot>;
	setCloseQuits(closeQuits: boolean): Promise<void>;
	quitApp(): Promise<void>;
	minimizeWindow(): Promise<void>;
	toggleWindowMaximize(): Promise<boolean>;
	closeWindow(): Promise<void>;
	getModelsConfig(): Promise<DesktopProviderConfig[]>;
	saveModelsConfig(input: DesktopSaveModelsConfigInput): Promise<DesktopSnapshot>;
	getModelScope(): Promise<DesktopModelScope>;
	saveModelScope(patterns: string[]): Promise<DesktopModelScope>;
	discoverModels(input: DesktopDiscoverModelsInput): Promise<Array<{ id: string }>>;
	lookupModelCatalog(input: { providerId: string; modelId: string }): Promise<DesktopProviderModelConfig | undefined>;
	testModel(input: DesktopModelTestInput): Promise<DesktopModelTestResult>;
	openCustomCss(): Promise<string>;
	checkForUpdates(): Promise<DesktopUpdateInfo>;
	downloadUpdate(input: DesktopUpdateDownloadInput): Promise<DesktopUpdateDownloadState>;
	cancelUpdateDownload(): Promise<void>;
	getUpdateDownloadState(): Promise<DesktopUpdateDownloadState>;
	installUpdate(): Promise<void>;
	onUpdateDownloadProgress(listener: (state: DesktopUpdateDownloadState) => void): Unsubscribe;
	toggleSkill(input: DesktopToggleSkillInput): Promise<DesktopSnapshot>;
	installPlugin(input: DesktopPluginSourceInput): Promise<DesktopConfirmedPluginActionResult>;
	updatePlugin(input: DesktopPluginSourceInput): Promise<DesktopConfirmedPluginActionResult>;
	removePlugin(input: DesktopPluginSourceInput): Promise<DesktopSnapshot>;
	togglePlugin(input: DesktopTogglePluginInput): Promise<DesktopSnapshot>;
	savePluginPackageFilters(input: DesktopPluginPackageFilterInput): Promise<DesktopSnapshot>;
	reloadSession(): Promise<DesktopSnapshot>;
	getPluginPackages(): Promise<DesktopPluginPackagesResult>;
	listSkillsDetailed(): Promise<DesktopSkillInfo[]>;
	searchSkills(query: string): Promise<DesktopSkillSearchResult[]>;
	installSkill(pkg: string, scope: "global" | "project"): Promise<DesktopSnapshot>;
	checkSkillUpdates(target?: { pkg: string; scope: "global" | "project" }): Promise<DesktopSkillUpdateResult[]>;
	updateSkill(pkg: string, scope: "global" | "project"): Promise<string>;
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
	if (
		!keys.every(
			(key) =>
				key === "text" ||
				key === "attachmentIds" ||
				key === "sessionReferenceLabels" ||
				key === "streamingBehavior",
		)
	)
		return false;
	if (typeof input.text !== "string") return false;
	if (
		input.streamingBehavior !== undefined &&
		input.streamingBehavior !== "steer" &&
		input.streamingBehavior !== "followUp"
	)
		return false;
	if (
		input.attachmentIds !== undefined &&
		(!Array.isArray(input.attachmentIds) ||
			input.attachmentIds.length > 10 ||
			!input.attachmentIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200))
	)
		return false;
	return (
		input.sessionReferenceLabels === undefined ||
		(Array.isArray(input.sessionReferenceLabels) &&
			input.sessionReferenceLabels.length <= 20 &&
			input.sessionReferenceLabels.every(
				(label) => typeof label === "string" && label.length > 0 && label.length <= 200,
			))
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

export function isDesktopRestoreImageAttachmentsInput(value: unknown): value is DesktopRestoreImageAttachmentsInput {
	return (
		isExactRecord(value, ["ids"]) &&
		Array.isArray(value.ids) &&
		value.ids.length <= 10 &&
		value.ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/iu.test(id))
	);
}

export function isDesktopRestoreMessageImagesInput(value: unknown): value is DesktopRestoreMessageImagesInput {
	return (
		isExactRecord(value, ["messageId"]) &&
		typeof value.messageId === "string" &&
		value.messageId.length <= 120 &&
		/^\d+:/u.test(value.messageId)
	);
}

export function isDesktopUpdateDownloadInput(value: unknown): value is DesktopUpdateDownloadInput {
	return (
		isExactRecord(value, ["assetName"]) &&
		typeof value.assetName === "string" &&
		value.assetName.length > 0 &&
		value.assetName.length <= 300 &&
		/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.assetName)
	);
}

export function isDesktopRemoveWorktreeInput(value: unknown): value is DesktopRemoveWorktreeInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const input = value as Record<string, unknown>;
	if (!Object.keys(input).every((key) => key === "path" || key === "force")) return false;
	return (
		typeof input.path === "string" &&
		input.path.length > 0 &&
		input.path.length <= 2000 &&
		(input.force === undefined || typeof input.force === "boolean")
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
	const keys = Object.keys(input);
	if (!keys.every((key) => key === "providerId" || key === "baseUrl" || key === "apiKey")) return false;
	if (typeof input.providerId !== "string" || input.providerId.length === 0 || input.providerId.length > 200)
		return false;
	if (typeof input.baseUrl !== "string" || input.baseUrl.length === 0 || input.baseUrl.length > 2000) return false;
	if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 2000)) return false;
	return true;
}

export function isDesktopToggleSkillInput(value: unknown): value is DesktopToggleSkillInput {
	return (
		isExactRecord(value, ["filePath", "disable"]) &&
		typeof value.filePath === "string" &&
		value.filePath.length > 0 &&
		value.filePath.length <= 2000 &&
		typeof value.disable === "boolean"
	);
}

export function isDesktopPluginSourceInput(value: unknown): value is DesktopPluginSourceInput {
	return (
		isExactRecord(value, ["source", "local"]) &&
		typeof value.source === "string" &&
		value.source.length > 0 &&
		value.source.length <= 2000 &&
		typeof value.local === "boolean"
	);
}

function isValidFilterPatternList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= 100 &&
		value.every(
			(pattern) =>
				typeof pattern === "string" &&
				pattern.length > 0 &&
				pattern.length <= 200 &&
				!pattern.includes("\0") &&
				!/[\p{C}]/u.test(pattern),
		)
	);
}

export function isDesktopPluginPackageFilterInput(value: unknown): value is DesktopPluginPackageFilterInput {
	if (!isExactRecord(value, ["source", "local", "autoload", "filters"])) return false;
	if (typeof value.source !== "string" || value.source.length === 0 || value.source.length > 2000) return false;
	if (typeof value.local !== "boolean" || typeof value.autoload !== "boolean") return false;
	if (typeof value.filters !== "object" || value.filters === null || Array.isArray(value.filters)) return false;
	const filters = value.filters as Record<string, unknown>;
	if (
		!isExactRecord(filters, ["extensions", "skills", "prompts", "themes"]) ||
		!isValidFilterPatternList(filters.extensions) ||
		!isValidFilterPatternList(filters.skills) ||
		!isValidFilterPatternList(filters.prompts) ||
		!isValidFilterPatternList(filters.themes)
	) {
		return false;
	}
	return true;
}

export function isDesktopSaveModelsConfigInput(value: unknown): value is DesktopSaveModelsConfigInput {
	if (!isExactRecord(value, ["providers"])) return false;
	const input = value as Record<string, unknown>;
	if (!Array.isArray(input.providers) || input.providers.length > 500) return false;
	const ids = new Set<string>();
	for (const provider of input.providers) {
		if (!isDesktopProviderConfig(provider)) return false;
		if (ids.has(provider.id)) return false;
		ids.add(provider.id);
	}
	return true;
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
		isExactRecord(value, ["providerId", "authType"]) &&
		typeof value.providerId === "string" &&
		value.providerId.length > 0 &&
		value.providerId.length <= 200 &&
		(value.authType === "api_key" || value.authType === "oauth")
	);
}

export function isDesktopProviderLogoutInput(value: unknown): value is DesktopProviderLogoutInput {
	return (
		isExactRecord(value, ["providerId"]) &&
		typeof value.providerId === "string" &&
		value.providerId.length > 0 &&
		value.providerId.length <= 200
	);
}

export function isDesktopModelTestInput(value: unknown): value is DesktopModelTestInput {
	if (!isExactRecord(value, ["provider", "model"])) return false;
	return isDesktopProviderConfig(value.provider) && isDesktopProviderModelConfig(value.model);
}

function isDesktopProviderConfig(value: unknown): value is DesktopProviderConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const provider = value as Record<string, unknown>;
	const providerKeys = ["id", "sourceId", "name", "baseUrl", "apiKey", "api", "models"];
	if (!Object.keys(provider).every((key) => providerKeys.includes(key))) return false;
	if (typeof provider.id !== "string" || provider.id.length === 0 || provider.id.length > 200) return false;
	if (provider.sourceId !== undefined && (typeof provider.sourceId !== "string" || provider.sourceId.length > 200))
		return false;
	if (provider.name !== undefined && (typeof provider.name !== "string" || provider.name.length > 500)) return false;
	if (provider.baseUrl !== undefined && (typeof provider.baseUrl !== "string" || provider.baseUrl.length > 2000))
		return false;
	if (provider.apiKey !== undefined && (typeof provider.apiKey !== "string" || provider.apiKey.length > 2000))
		return false;
	if (provider.api !== undefined && (typeof provider.api !== "string" || provider.api.length > 200)) return false;
	if (provider.models === undefined) return true;
	if (!Array.isArray(provider.models) || provider.models.length > 500) return false;
	const ids = new Set<string>();
	for (const model of provider.models) {
		if (!isDesktopProviderModelConfig(model)) return false;
		if (ids.has(model.id)) return false;
		ids.add(model.id);
	}
	return true;
}

function isDesktopProviderModelConfig(value: unknown): value is DesktopProviderModelConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const model = value as Record<string, unknown>;
	const modelKeys = [
		"id",
		"sourceId",
		"name",
		"api",
		"reasoning",
		"thinkingLevelMap",
		"compat",
		"input",
		"contextWindow",
		"maxTokens",
		"cost",
	];
	if (!Object.keys(model).every((key) => modelKeys.includes(key))) return false;
	if (typeof model.id !== "string" || model.id.length === 0 || model.id.length > 500) return false;
	if (model.sourceId !== undefined && (typeof model.sourceId !== "string" || model.sourceId.length > 500))
		return false;
	if (model.name !== undefined && (typeof model.name !== "string" || model.name.length > 500)) return false;
	if (model.api !== undefined && (typeof model.api !== "string" || model.api.length > 200)) return false;
	if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") return false;
	if (model.thinkingLevelMap !== undefined) {
		if (
			typeof model.thinkingLevelMap !== "object" ||
			model.thinkingLevelMap === null ||
			Array.isArray(model.thinkingLevelMap)
		)
			return false;
		if (
			!Object.entries(model.thinkingLevelMap).every(
				([key, value]) => key.length <= 50 && (typeof value === "string" || value === null),
			)
		)
			return false;
	}
	if (model.compat !== undefined) {
		if (typeof model.compat !== "object" || model.compat === null || Array.isArray(model.compat)) return false;
		if (Object.keys(model.compat).some((key) => key.length > 100)) return false;
	}
	if (
		model.input !== undefined &&
		(!Array.isArray(model.input) ||
			model.input.length > 10 ||
			!model.input.every((item) => typeof item === "string" && item.length <= 50))
	)
		return false;
	if (
		model.contextWindow !== undefined &&
		(typeof model.contextWindow !== "number" || !Number.isFinite(model.contextWindow) || model.contextWindow <= 0)
	)
		return false;
	if (
		model.maxTokens !== undefined &&
		(typeof model.maxTokens !== "number" || !Number.isFinite(model.maxTokens) || model.maxTokens <= 0)
	)
		return false;
	if (model.cost !== undefined) {
		if (!isExactRecord(model.cost, ["input", "output", "cacheRead", "cacheWrite"])) return false;
		if (!Object.values(model.cost).every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0))
			return false;
	}
	return true;
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

export function isDesktopWorkspaceDirectoryPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 2_000 &&
		!value.includes("\\") &&
		!value.startsWith("/") &&
		!value.endsWith("/") &&
		!value.includes("\0") &&
		value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
	);
}
