// Electron loads sandboxed preload scripts as CommonJS; the .cts extension emits .cjs.
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";
import type {
	DesktopApi,
	DesktopAuthenticationPromptResponseInput,
	DesktopAddWorktreeInput,
	DesktopDiscoverModelsInput,
	DesktopGitChange,
	DesktopGitDiffInput,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopModelSelectionInput,
	DesktopModelTestInput,
	DesktopModelTestResult,
	DesktopNavigateTreeInput,
	DesktopOpenSessionInput,
	DesktopOpenWorkspacePathInput,
	DesktopPluginSourceInput,
	DesktopPromptInput,
	DesktopProviderConfig,
	DesktopRemoveWorktreeInput,
	DesktopProviderLogoutInput,
	DesktopProviderSetupInput,
	DesktopSaveModelsConfigInput,
	DesktopSnapshot,
	DesktopSnapshotListener,
	DesktopToggleSkillInput,
	DesktopUpdateInfo,
	DesktopWorkspaceFileInput,
	Unsubscribe,
} from "../shared/contracts.ts" with { "resolution-mode": "import" };

const desktopApi: DesktopApi = {
	bootstrap: () => ipcRenderer.invoke("pi-desktop:bootstrap") as Promise<DesktopSnapshot>,
	chooseWorkspace: () => ipcRenderer.invoke("pi-desktop:choose-workspace") as Promise<DesktopSnapshot>,
	chooseImages: () => ipcRenderer.invoke("pi-desktop:choose-images") as Promise<DesktopImageAttachment[]>,
	attachDroppedImages: (files: File[]) =>
		ipcRenderer.invoke("pi-desktop:attach-dropped-images", files.map((file) => webUtils.getPathForFile(file))) as Promise<DesktopImageAttachment[]>,
	prompt: (input: DesktopPromptInput) => ipcRenderer.invoke("pi-desktop:prompt", input) as Promise<DesktopSnapshot>,
	abort: () => ipcRenderer.invoke("pi-desktop:abort") as Promise<DesktopSnapshot>,
	openSession: (input: DesktopOpenSessionInput) =>
		ipcRenderer.invoke("pi-desktop:open-session", input) as Promise<DesktopSnapshot>,
	newSession: () => ipcRenderer.invoke("pi-desktop:new-session") as Promise<DesktopSnapshot>,
	navigateTree: (input: DesktopNavigateTreeInput) =>
		ipcRenderer.invoke("pi-desktop:navigate-tree", input) as Promise<DesktopSnapshot>,
	forkSession: () => ipcRenderer.invoke("pi-desktop:fork-session") as Promise<DesktopSnapshot>,
	setModel: (input: DesktopModelSelectionInput) =>
		ipcRenderer.invoke("pi-desktop:set-model", input) as Promise<DesktopSnapshot>,
	setProjectTrust: (input) => ipcRenderer.invoke("pi-desktop:set-project-trust", input) as Promise<DesktopSnapshot>,
	decideToolApproval: (input) =>
		ipcRenderer.invoke("pi-desktop:decide-tool-approval", input) as Promise<DesktopSnapshot>,
	startProviderSetup: (input: DesktopProviderSetupInput) =>
		ipcRenderer.invoke("pi-desktop:start-provider-setup", input) as Promise<DesktopSnapshot>,
	logoutProvider: (input: DesktopProviderLogoutInput) =>
		ipcRenderer.invoke("pi-desktop:logout-provider", input) as Promise<DesktopSnapshot>,
	respondToAuthenticationPrompt: (input: DesktopAuthenticationPromptResponseInput) =>
		ipcRenderer.invoke("pi-desktop:respond-to-authentication-prompt", input) as Promise<DesktopSnapshot>,
	listWorkspaceFiles: () => ipcRenderer.invoke("pi-desktop:list-workspace-files"),
	readWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:read-workspace-file", input),
	openWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:open-workspace-file", input) as Promise<void>,
	revealWorkspaceFile: (input: DesktopWorkspaceFileInput) =>
		ipcRenderer.invoke("pi-desktop:reveal-workspace-file", input) as Promise<void>,
	openExternalUrl: (url: string) =>
		ipcRenderer.invoke("pi-desktop:open-external-url", url) as Promise<void>,
	notifyComplete: () => ipcRenderer.invoke("pi-desktop:notify-complete") as Promise<void>,
	listGitChanges: () => ipcRenderer.invoke("pi-desktop:list-git-changes") as Promise<DesktopGitChange[]>,
	getGitDiff: (input: DesktopGitDiffInput) =>
		ipcRenderer.invoke("pi-desktop:git-diff", input) as Promise<string>,
	listGitWorktrees: () => ipcRenderer.invoke("pi-desktop:list-git-worktrees") as Promise<DesktopGitWorktree[]>,
	addGitWorktree: (input: DesktopAddWorktreeInput) =>
		ipcRenderer.invoke("pi-desktop:add-git-worktree", input) as Promise<DesktopGitWorktree>,
	removeGitWorktree: (input: DesktopRemoveWorktreeInput) =>
		ipcRenderer.invoke("pi-desktop:remove-git-worktree", input) as Promise<void>,
	openWorkspacePath: (input: DesktopOpenWorkspacePathInput) =>
		ipcRenderer.invoke("pi-desktop:open-workspace-path", input) as Promise<DesktopSnapshot>,
	setCloseQuits: (closeQuits: boolean) =>
		ipcRenderer.invoke("pi-desktop:set-close-quits", closeQuits) as Promise<void>,
	quitApp: () => ipcRenderer.invoke("pi-desktop:quit-app") as Promise<void>,
	getModelsConfig: () => ipcRenderer.invoke("pi-desktop:get-models-config") as Promise<DesktopProviderConfig[]>,
	saveModelsConfig: (input: DesktopSaveModelsConfigInput) =>
		ipcRenderer.invoke("pi-desktop:save-models-config", input) as Promise<DesktopSnapshot>,
	discoverModels: (input: DesktopDiscoverModelsInput) =>
		ipcRenderer.invoke("pi-desktop:discover-models", input) as Promise<Array<{ id: string }>>,
	testModel: (input: DesktopModelTestInput) =>
		ipcRenderer.invoke("pi-desktop:test-model", input) as Promise<DesktopModelTestResult>,
	openCustomCss: () => ipcRenderer.invoke("pi-desktop:open-custom-css") as Promise<string>,
	checkForUpdates: () => ipcRenderer.invoke("pi-desktop:check-for-updates") as Promise<DesktopUpdateInfo>,
	toggleSkill: (input: DesktopToggleSkillInput) =>
		ipcRenderer.invoke("pi-desktop:toggle-skill", input) as Promise<DesktopSnapshot>,
	installPlugin: (input: DesktopPluginSourceInput) =>
		ipcRenderer.invoke("pi-desktop:install-plugin", input) as Promise<DesktopSnapshot>,
	removePlugin: (input: DesktopPluginSourceInput) =>
		ipcRenderer.invoke("pi-desktop:remove-plugin", input) as Promise<DesktopSnapshot>,
	getPluginPackages: () =>
		ipcRenderer.invoke("pi-desktop:get-plugin-packages") as Promise<Array<{ source: string; scope: "user" | "project" }>>,
	onSnapshot(listener: DesktopSnapshotListener): Unsubscribe {
		const subscription = (_event: IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
		ipcRenderer.on("pi-desktop:snapshot", subscription);
		return () => ipcRenderer.removeListener("pi-desktop:snapshot", subscription);
	},
};

contextBridge.exposeInMainWorld("piDesktop", desktopApi);
