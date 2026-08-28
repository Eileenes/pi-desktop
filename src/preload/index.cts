// Electron loads sandboxed preload scripts as CommonJS; the .cts extension emits .cjs.
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";
import type {
	DesktopApi,
	DesktopAuthenticationPromptResponseInput,
	DesktopBashOutputInput,
	DesktopAddWorktreeInput,
	DesktopDiscoverModelsInput,
	DesktopGitChange,
	DesktopGitBranches,
	DesktopGitDiffInput,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopModelSelectionInput,
	DesktopModelScope,
	DesktopModelTestInput,
	DesktopModelTestResult,
	DesktopNavigateTreeInput,
	DesktopNotificationInput,
	DesktopRenameSessionInput,
	DesktopOpenSessionInput,
	DesktopOpenWorkspacePathInput,
	DesktopDeleteSessionInput,
	DesktopDirectoryListing,
	DesktopExtensionCustomInput,
	DesktopExtensionDialogResponseInput,
	DesktopExtensionUiEvent,
	DesktopExtensionUiListener,
	DesktopWorkspaceChange,
	DesktopWorkspaceDirectoryListing,
	DesktopPluginSourceInput,
	DesktopPluginPackage,
	DesktopPluginPackageFilterInput,
	DesktopPromptInput,
	DesktopRestoreImageAttachmentsInput,
	DesktopRestoreMessageImagesInput,
	DesktopProviderConfig,
	DesktopProviderModelConfig,
	DesktopRemoveWorktreeResult,
	DesktopRemoveWorktreeInput,
	DesktopProviderLogoutInput,
	DesktopProviderSetupInput,
	DesktopSaveModelsConfigInput,
	DesktopSnapshot,
	DesktopSnapshotListener,
	DesktopSkillInfo,
	DesktopSkillSearchResult,
	DesktopSkillUpdateResult,
	DesktopToggleSkillInput,
	DesktopTogglePluginInput,
	DesktopUpdateDownloadInput,
	DesktopUpdateDownloadState,
	DesktopUpdateInfo,
	DesktopWorkspaceFileInput,
	Unsubscribe,
} from "../shared/contracts.ts" with { "resolution-mode": "import" };

const desktopApi: DesktopApi = {
	bootstrap: () => ipcRenderer.invoke("pi-desktop:bootstrap") as Promise<DesktopSnapshot>,
	chooseWorkspace: () => ipcRenderer.invoke("pi-desktop:choose-workspace") as Promise<DesktopSnapshot>,
	browseDirectories: (path?: string) => ipcRenderer.invoke("pi-desktop:browse-directories", path) as Promise<DesktopDirectoryListing>,
	selectDirectory: () => ipcRenderer.invoke("pi-desktop:select-directory") as Promise<string | undefined>,
	chooseImages: () => ipcRenderer.invoke("pi-desktop:choose-images") as Promise<DesktopImageAttachment[]>,
	attachDroppedImages: (files: File[]) =>
		ipcRenderer.invoke("pi-desktop:attach-dropped-images", files.map((file) => webUtils.getPathForFile(file))) as Promise<DesktopImageAttachment[]>,
	restoreImageAttachments: (input: DesktopRestoreImageAttachmentsInput) =>
		ipcRenderer.invoke("pi-desktop:restore-image-attachments", input) as Promise<DesktopImageAttachment[]>,
	restoreMessageImages: (input: DesktopRestoreMessageImagesInput) =>
		ipcRenderer.invoke("pi-desktop:restore-message-images", input) as Promise<DesktopImageAttachment[]>,
	discardImageAttachment: (id: string) => ipcRenderer.invoke("pi-desktop:discard-image-attachment", id) as Promise<void>,
	importDroppedFiles: (files: File[], overwriteConflicts = false, targetDirectory?: string) =>
		ipcRenderer.invoke("pi-desktop:import-dropped-files", {
			paths: files.map((file) => webUtils.getPathForFile(file)),
			overwriteConflicts,
			...(targetDirectory ? { targetDirectory } : {}),
		}),
	prompt: (input: DesktopPromptInput) => ipcRenderer.invoke("pi-desktop:prompt", input) as Promise<DesktopSnapshot>,
	abort: () => ipcRenderer.invoke("pi-desktop:abort") as Promise<DesktopSnapshot>,
	openSession: (input: DesktopOpenSessionInput) =>
		ipcRenderer.invoke("pi-desktop:open-session", input) as Promise<DesktopSnapshot>,
	newSession: () => ipcRenderer.invoke("pi-desktop:new-session") as Promise<DesktopSnapshot>,
	navigateTree: (input: DesktopNavigateTreeInput) =>
		ipcRenderer.invoke("pi-desktop:navigate-tree", input) as Promise<DesktopSnapshot>,
	forkSession: () => ipcRenderer.invoke("pi-desktop:fork-session") as Promise<DesktopSnapshot>,
	autoNameSession: () => ipcRenderer.invoke("pi-desktop:auto-name-session") as Promise<DesktopSnapshot>,
	exportSession: () => ipcRenderer.invoke("pi-desktop:export-session") as Promise<string>,
	renameSession: (input: DesktopRenameSessionInput) =>
		ipcRenderer.invoke("pi-desktop:rename-session", input) as Promise<DesktopSnapshot>,
	deleteSession: (input: DesktopDeleteSessionInput) =>
		ipcRenderer.invoke("pi-desktop:delete-session", input) as Promise<DesktopSnapshot>,
	executeBashCommand: (command: string, excludeFromContext: boolean) =>
		ipcRenderer.invoke("pi-desktop:execute-bash", { command, excludeFromContext }) as Promise<string>,
	readFullBashOutput: (input: DesktopBashOutputInput) =>
		ipcRenderer.invoke("pi-desktop:read-full-bash-output", input) as Promise<string>,
	saveFullBashOutput: (input: DesktopBashOutputInput) =>
		ipcRenderer.invoke("pi-desktop:save-full-bash-output", input) as Promise<string>,
	copyLastAnswer: () => ipcRenderer.invoke("pi-desktop:copy-last-answer") as Promise<string>,
	setModel: (input: DesktopModelSelectionInput) =>
		ipcRenderer.invoke("pi-desktop:set-model", input) as Promise<DesktopSnapshot>,
	setThinkingLevel: (level) => ipcRenderer.invoke("pi-desktop:set-thinking-level", level) as Promise<DesktopSnapshot>,
	compact: (customInstructions?: string) =>
		ipcRenderer.invoke("pi-desktop:compact", customInstructions) as Promise<DesktopSnapshot>,
	setProjectTrust: (input) => ipcRenderer.invoke("pi-desktop:set-project-trust", input) as Promise<DesktopSnapshot>,
	decideToolApproval: (input) =>
		ipcRenderer.invoke("pi-desktop:decide-tool-approval", input) as Promise<DesktopSnapshot>,
	startProviderSetup: (input: DesktopProviderSetupInput) =>
		ipcRenderer.invoke("pi-desktop:start-provider-setup", input) as Promise<DesktopSnapshot>,
	cancelProviderSetup: () => ipcRenderer.invoke("pi-desktop:cancel-provider-setup") as Promise<DesktopSnapshot>,
	logoutProvider: (input: DesktopProviderLogoutInput) =>
		ipcRenderer.invoke("pi-desktop:logout-provider", input) as Promise<DesktopSnapshot>,
	respondToAuthenticationPrompt: (input: DesktopAuthenticationPromptResponseInput) =>
		ipcRenderer.invoke("pi-desktop:respond-to-authentication-prompt", input) as Promise<DesktopSnapshot>,
	listWorkspaceFiles: () => ipcRenderer.invoke("pi-desktop:list-workspace-files"),
	listWorkspaceDirectory: (path?: string) =>
		ipcRenderer.invoke("pi-desktop:list-workspace-directory", path) as Promise<DesktopWorkspaceDirectoryListing>,
	searchWorkspaceFiles: (query: string) => ipcRenderer.invoke("pi-desktop:search-workspace-files", query),
	readWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:read-workspace-file", input),
	openWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:open-workspace-file", input) as Promise<void>,
	revealWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:reveal-workspace-file", input) as Promise<void>,
	saveWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:save-workspace-file", input) as Promise<string>,
	openExternalUrl: (url: string) =>
		ipcRenderer.invoke("pi-desktop:open-external-url", url) as Promise<void>,
	notifyComplete: (input?: DesktopNotificationInput) =>
		ipcRenderer.invoke("pi-desktop:notify-complete", input) as Promise<void>,
	listGitChanges: () => ipcRenderer.invoke("pi-desktop:list-git-changes") as Promise<DesktopGitChange[]>,
	getGitDiff: (input: DesktopGitDiffInput) =>
		ipcRenderer.invoke("pi-desktop:git-diff", input) as Promise<string>,
	listGitWorktrees: () => ipcRenderer.invoke("pi-desktop:list-git-worktrees") as Promise<DesktopGitWorktree[]>,
	listGitBranches: () => ipcRenderer.invoke("pi-desktop:list-git-branches") as Promise<DesktopGitBranches>,
	fetchGitBranches: () => ipcRenderer.invoke("pi-desktop:fetch-git-branches") as Promise<void>,
	switchGitBranch: (input) =>
		ipcRenderer.invoke("pi-desktop:switch-git-branch", input) as Promise<DesktopSnapshot>,
	addGitWorktree: (input: DesktopAddWorktreeInput) =>
		ipcRenderer.invoke("pi-desktop:add-git-worktree", input) as Promise<DesktopGitWorktree>,
	removeGitWorktree: (input: DesktopRemoveWorktreeInput) =>
		ipcRenderer.invoke("pi-desktop:remove-git-worktree", input) as Promise<DesktopRemoveWorktreeResult>,
	openWorkspacePath: (input: DesktopOpenWorkspacePathInput) =>
		ipcRenderer.invoke("pi-desktop:open-workspace-path", input) as Promise<DesktopSnapshot>,
	setCloseQuits: (closeQuits: boolean) =>
		ipcRenderer.invoke("pi-desktop:set-close-quits", closeQuits) as Promise<void>,
	quitApp: () => ipcRenderer.invoke("pi-desktop:quit-app") as Promise<void>,
	getModelsConfig: () => ipcRenderer.invoke("pi-desktop:get-models-config") as Promise<DesktopProviderConfig[]>,
	saveModelsConfig: (input: DesktopSaveModelsConfigInput) =>
		ipcRenderer.invoke("pi-desktop:save-models-config", input) as Promise<DesktopSnapshot>,
	getModelScope: () => ipcRenderer.invoke("pi-desktop:get-model-scope") as Promise<DesktopModelScope>,
	saveModelScope: (patterns: string[]) =>
		ipcRenderer.invoke("pi-desktop:save-model-scope", { patterns }) as Promise<DesktopModelScope>,
	discoverModels: (input: DesktopDiscoverModelsInput) =>
		ipcRenderer.invoke("pi-desktop:discover-models", input) as Promise<Array<{ id: string }>>,
	lookupModelCatalog: (input: { providerId: string; modelId: string }) =>
		ipcRenderer.invoke("pi-desktop:lookup-model-catalog", input) as Promise<DesktopProviderModelConfig | undefined>,
	testModel: (input: DesktopModelTestInput) =>
		ipcRenderer.invoke("pi-desktop:test-model", input) as Promise<DesktopModelTestResult>,
	openCustomCss: () => ipcRenderer.invoke("pi-desktop:open-custom-css") as Promise<string>,
	checkForUpdates: () => ipcRenderer.invoke("pi-desktop:check-for-updates") as Promise<DesktopUpdateInfo>,
	downloadUpdate: (input: DesktopUpdateDownloadInput) =>
		ipcRenderer.invoke("pi-desktop:download-update", input) as Promise<DesktopUpdateDownloadState>,
	cancelUpdateDownload: () =>
		ipcRenderer.invoke("pi-desktop:cancel-update-download") as Promise<void>,
	getUpdateDownloadState: () =>
		ipcRenderer.invoke("pi-desktop:get-update-download-state") as Promise<DesktopUpdateDownloadState>,
	installUpdate: () => ipcRenderer.invoke("pi-desktop:install-update") as Promise<void>,
	onUpdateDownloadProgress(listener: (state: DesktopUpdateDownloadState) => void): Unsubscribe {
		const subscription = (_event: IpcRendererEvent, state: DesktopUpdateDownloadState) => listener(state);
		ipcRenderer.on("pi-desktop:update-download-progress", subscription);
		return () => ipcRenderer.removeListener("pi-desktop:update-download-progress", subscription);
	},
	respondToExtensionDialog: (input: DesktopExtensionDialogResponseInput) =>
		ipcRenderer.invoke("pi-desktop:respond-to-extension-dialog", input) as Promise<void>,
	sendExtensionCustomInput: (input: DesktopExtensionCustomInput) =>
		ipcRenderer.invoke("pi-desktop:extension-custom-input", input) as Promise<void>,
	onExtensionUi(listener: DesktopExtensionUiListener): Unsubscribe {
		const subscription = (_event: IpcRendererEvent, uiEvent: DesktopExtensionUiEvent) => listener(uiEvent);
		ipcRenderer.on("pi-desktop:extension-ui", subscription);
		return () => ipcRenderer.removeListener("pi-desktop:extension-ui", subscription);
	},
	onWorkspaceChanged(listener: (changes: DesktopWorkspaceChange[]) => void): Unsubscribe {
		const subscription = (_event: IpcRendererEvent, changes: DesktopWorkspaceChange[]) => listener(changes);
		ipcRenderer.on("pi-desktop:workspace-changed", subscription);
		return () => ipcRenderer.removeListener("pi-desktop:workspace-changed", subscription);
	},
	toggleSkill: (input: DesktopToggleSkillInput) =>
		ipcRenderer.invoke("pi-desktop:toggle-skill", input) as Promise<DesktopSnapshot>,
	installPlugin: (input: DesktopPluginSourceInput) =>
		ipcRenderer.invoke("pi-desktop:install-plugin", input) as Promise<DesktopSnapshot>,
	removePlugin: (input: DesktopPluginSourceInput) =>
		ipcRenderer.invoke("pi-desktop:remove-plugin", input) as Promise<DesktopSnapshot>,
	togglePlugin: (input: DesktopTogglePluginInput) =>
		ipcRenderer.invoke("pi-desktop:toggle-plugin", input) as Promise<DesktopSnapshot>,
	savePluginPackageFilters: (input: DesktopPluginPackageFilterInput) =>
		ipcRenderer.invoke("pi-desktop:save-plugin-filters", input) as Promise<DesktopSnapshot>,
	reloadSession: () => ipcRenderer.invoke("pi-desktop:reload-session") as Promise<DesktopSnapshot>,
	getPluginPackages: () =>
		ipcRenderer.invoke("pi-desktop:get-plugin-packages") as Promise<DesktopPluginPackage[]>,
	listSkillsDetailed: () => ipcRenderer.invoke("pi-desktop:list-skills-detailed") as Promise<DesktopSkillInfo[]>,
	searchSkills: (query: string) => ipcRenderer.invoke("pi-desktop:search-skills", query) as Promise<DesktopSkillSearchResult[]>,
	installSkill: (pkg: string, scope: "global" | "project") =>
		ipcRenderer.invoke("pi-desktop:install-skill", { pkg, scope }) as Promise<DesktopSnapshot>,
	checkSkillUpdates: (target?: { pkg: string; scope: "global" | "project" }) =>
		ipcRenderer.invoke("pi-desktop:check-skill-updates", target) as Promise<DesktopSkillUpdateResult[]>,
	updateSkill: (pkg: string, scope: "global" | "project") =>
		ipcRenderer.invoke("pi-desktop:update-skill", { pkg, scope }) as Promise<string>,
	onSnapshot(listener: DesktopSnapshotListener): Unsubscribe {
		const subscription = (_event: IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
		ipcRenderer.on("pi-desktop:snapshot", subscription);
		return () => ipcRenderer.removeListener("pi-desktop:snapshot", subscription);
	},
};

contextBridge.exposeInMainWorld("piDesktop", desktopApi);
