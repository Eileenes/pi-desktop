import type {
	DesktopAuthenticationPromptResponseInput,
	DesktopDirectoryListing,
	DesktopExtensionUiListener,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopModelSelectionInput,
	DesktopNavigateTreeInput,
	DesktopOpenSessionInput,
	DesktopPluginPackage,
	DesktopPluginPackageFilterInput,
	DesktopProviderConfig,
	DesktopProviderModelConfig,
	DesktopProviderSetupInput,
	DesktopRemoveWorktreeResult,
	DesktopRestoreImageAttachmentsInput,
	DesktopRestoreMessageImagesInput,
	DesktopSkillInfo,
	DesktopSkillSearchResult,
	DesktopSkillUpdateResult,
	DesktopSnapshot,
	DesktopSnapshotListener,
	DesktopToolApprovalDecisionInput,
	DesktopUpdateDownloadInput,
	DesktopUpdateDownloadState,
	DesktopWorkspaceChange,
	DesktopWorkspaceDirectoryListing,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
	Unsubscribe,
} from "../shared/contracts.ts";
import { getAppLanguage, translate } from "./i18n.ts";

let snapshot: DesktopSnapshot = {
	apiKeyProviders: [],
	availableModels: [],
	pendingAuthenticationPrompts: [],
	pendingToolApprovals: [],
	plugins: [],
	projectTrusted: false,
	providerSetupInProgress: false,
	sessions: [],
	skills: [],
};
const listeners = new Set<DesktopSnapshotListener>();
let started = false;
let startPromise: Promise<void> | undefined;
let startupError: string | undefined;

function publish(next: DesktopSnapshot): void {
	snapshot = next;
	for (const listener of listeners) listener(snapshot);
}

export function getDesktopSnapshot(): DesktopSnapshot {
	return snapshot;
}

export function getDesktopStartupError(): string | undefined {
	return startupError;
}

export function subscribeDesktopSnapshot(listener: DesktopSnapshotListener): Unsubscribe {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function startDesktopStore(): Promise<void> {
	if (started) return;
	if (startPromise) return startPromise;

	startPromise = (async () => {
		try {
			startupError = undefined;
			await window.piDesktop.setCloseQuits(localStorage.getItem("pi-desktop-close-quits") === "on");
			const initial = await window.piDesktop.bootstrap();
			publish(initial);
			window.piDesktop.onSnapshot(publish);
			started = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			startupError = message;
			publish({
				...snapshot,
				notice: translate(getAppLanguage(), "startupFailed", { message }),
			});
		} finally {
			if (!started) startPromise = undefined;
		}
	})();
	return startPromise;
}

export async function chooseWorkspace(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.chooseWorkspace();
	publish(next);
	return next;
}

export async function openDefaultWorkspace(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.openDefaultWorkspace();
	publish(next);
	return next;
}

export function browseDirectories(path?: string): Promise<DesktopDirectoryListing> {
	return window.piDesktop.browseDirectories(path);
}

export function selectDirectory(): Promise<string | undefined> {
	return window.piDesktop.selectDirectory();
}

export function chooseImages(): Promise<DesktopImageAttachment[]> {
	return window.piDesktop.chooseImages();
}

export function attachDroppedImages(files: File[]): Promise<DesktopImageAttachment[]> {
	return window.piDesktop.attachDroppedImages(files);
}

export function restoreImageAttachments(ids: string[]): Promise<DesktopImageAttachment[]> {
	const input: DesktopRestoreImageAttachmentsInput = { ids };
	return window.piDesktop.restoreImageAttachments(input);
}

export function restoreMessageImages(messageId: string): Promise<DesktopImageAttachment[]> {
	const input: DesktopRestoreMessageImagesInput = { messageId };
	return window.piDesktop.restoreMessageImages(input);
}

export function discardImageAttachment(id: string): Promise<void> {
	return window.piDesktop.discardImageAttachment(id);
}

export function importDroppedFiles(files: File[], overwriteConflicts = false, targetDirectory?: string) {
	return window.piDesktop.importDroppedFiles(files, overwriteConflicts, targetDirectory);
}

export async function submitPrompt(
	text: string,
	attachmentIds: string[],
	streamingBehavior?: "steer" | "followUp",
	sessionReferenceLabels: string[] = [],
): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.prompt({
		text,
		...(attachmentIds.length ? { attachmentIds } : {}),
		...(sessionReferenceLabels.length ? { sessionReferenceLabels } : {}),
		...(streamingBehavior === undefined ? {} : { streamingBehavior }),
	});
	publish(next);
	return next;
}

export async function abortSession(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.abort();
	publish(next);
	return next;
}

export async function clearSessionQueue(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.clearQueue();
	publish(next);
	return next;
}

export async function openSession(input: DesktopOpenSessionInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.openSession(input);
	publish(next);
	return next;
}

export async function newSession(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.newSession();
	publish(next);
	return next;
}

export async function navigateTree(input: DesktopNavigateTreeInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.navigateTree(input);
	publish(next);
	return next;
}

export async function forkSession(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.forkSession();
	publish(next);
	return next;
}

export async function autoNameSession(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.autoNameSession();
	publish(next);
	return next;
}

export function exportSession(): Promise<string> {
	return window.piDesktop.exportSession();
}

export async function renameSession(sessionPath: string, name: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.renameSession({ sessionPath, name });
	publish(next);
	return next;
}

export async function deleteSession(sessionPath: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.deleteSession({ sessionPath });
	publish(next);
	return next;
}

export function executeBashCommand(command: string, excludeFromContext: boolean): Promise<string> {
	return window.piDesktop.executeBashCommand(command, excludeFromContext);
}

export function readFullBashOutput(messageId: string): Promise<string> {
	return window.piDesktop.readFullBashOutput({ messageId });
}

export function saveFullBashOutput(messageId: string): Promise<string> {
	return window.piDesktop.saveFullBashOutput({ messageId });
}

export function copyLastAnswer(): Promise<string> {
	return window.piDesktop.copyLastAnswer();
}

export function respondToExtensionDialog(id: string, value: string): Promise<void> {
	return window.piDesktop.respondToExtensionDialog({ id, value });
}

export function sendExtensionCustomInput(id: string, data: string): Promise<void> {
	return window.piDesktop.sendExtensionCustomInput({ id, data });
}

export function onExtensionUi(listener: DesktopExtensionUiListener): Unsubscribe {
	return window.piDesktop.onExtensionUi(listener);
}

export function onWorkspaceChanged(listener: (changes: DesktopWorkspaceChange[]) => void): Unsubscribe {
	return window.piDesktop.onWorkspaceChanged(listener);
}

export async function setModel(input: DesktopModelSelectionInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.setModel(input);
	publish(next);
	return next;
}

export async function setThinkingLevel(
	level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.setThinkingLevel(level);
	publish(next);
	return next;
}

export async function setToolPreset(preset: "none" | "default" | "full"): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.setToolPreset(preset);
	publish(next);
	return next;
}

export async function compactSession(customInstructions?: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.compact(customInstructions);
	publish(next);
	return next;
}

export async function setProjectTrust(trusted: boolean): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.setProjectTrust({ trusted });
	publish(next);
	return next;
}

export async function decideToolApproval(input: DesktopToolApprovalDecisionInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.decideToolApproval(input);
	publish(next);
	return next;
}

export async function startProviderSetup(input: DesktopProviderSetupInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.startProviderSetup(input);
	publish(next);
	return next;
}

export async function cancelProviderSetup(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.cancelProviderSetup();
	publish(next);
	return next;
}

export async function respondToAuthenticationPrompt(
	input: DesktopAuthenticationPromptResponseInput,
): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.respondToAuthenticationPrompt(input);
	publish(next);
	return next;
}

export function listWorkspaceFiles(): Promise<DesktopWorkspaceEntry[]> {
	return window.piDesktop.listWorkspaceFiles();
}

export function listWorkspaceDirectory(path?: string): Promise<DesktopWorkspaceDirectoryListing> {
	return window.piDesktop.listWorkspaceDirectory(path);
}

export function searchWorkspaceFiles(query: string): Promise<DesktopWorkspaceEntry[]> {
	return window.piDesktop.searchWorkspaceFiles(query);
}

export function readWorkspaceFile(path: string): Promise<DesktopWorkspaceFilePreview> {
	return window.piDesktop.readWorkspaceFile({ path });
}

export function openWorkspaceFile(path: string): Promise<void> {
	return window.piDesktop.openWorkspaceFile({ path });
}

export function revealWorkspaceFile(path: string): Promise<void> {
	return window.piDesktop.revealWorkspaceFile({ path });
}

export function saveWorkspaceFile(path: string): Promise<string> {
	return window.piDesktop.saveWorkspaceFile({ path });
}

export function notifyComplete(sessionName?: string, force = false): Promise<void> {
	return window.piDesktop.notifyComplete({ ...(sessionName ? { sessionName } : {}), ...(force ? { force } : {}) });
}

export function listGitChanges(): Promise<DesktopGitChange[]> {
	return window.piDesktop.listGitChanges();
}

export function getGitDiff(path: string): Promise<string> {
	return window.piDesktop.getGitDiff({ path });
}

export function listGitWorktrees(): Promise<DesktopGitWorktree[]> {
	return window.piDesktop.listGitWorktrees();
}

export function listGitBranches(): Promise<{ local: string[]; remote: string[] }> {
	return window.piDesktop.listGitBranches();
}

export function fetchGitBranches(): Promise<void> {
	return window.piDesktop.fetchGitBranches();
}

export async function switchGitBranch(branch: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.switchGitBranch({ branch });
	publish(next);
	return next;
}

export function addGitWorktree(branch: string): Promise<DesktopGitWorktree> {
	return window.piDesktop.addGitWorktree({ branch });
}

export function removeGitWorktree(path: string, force = false): Promise<DesktopRemoveWorktreeResult> {
	return window.piDesktop.removeGitWorktree({ path, ...(force ? { force: true } : {}) });
}

export function setCloseQuits(closeQuits: boolean): Promise<void> {
	return window.piDesktop.setCloseQuits(closeQuits);
}

export function quitApp(): Promise<void> {
	return window.piDesktop.quitApp();
}

export function minimizeWindow(): Promise<void> {
	return window.piDesktop.minimizeWindow();
}

export function toggleWindowMaximize(): Promise<boolean> {
	return window.piDesktop.toggleWindowMaximize();
}

export function closeWindow(): Promise<void> {
	return window.piDesktop.closeWindow();
}

export function openExternalUrl(url: string): Promise<void> {
	return window.piDesktop.openExternalUrl(url);
}

export function getModelsConfig(): Promise<DesktopProviderConfig[]> {
	return window.piDesktop.getModelsConfig();
}

export async function saveModelsConfig(providers: DesktopProviderConfig[]): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.saveModelsConfig({ providers });
	publish(next);
	return next;
}

export function getModelScope() {
	return window.piDesktop.getModelScope();
}

export function saveModelScope(patterns: string[]) {
	return window.piDesktop.saveModelScope(patterns);
}

export function discoverModels(providerId: string, baseUrl: string, apiKey?: string): Promise<Array<{ id: string }>> {
	return window.piDesktop.discoverModels({ providerId, baseUrl, ...(apiKey ? { apiKey } : {}) });
}

export function lookupModelCatalog(
	providerId: string,
	modelId: string,
): Promise<DesktopProviderModelConfig | undefined> {
	return window.piDesktop.lookupModelCatalog({ providerId, modelId });
}

export async function logoutProvider(providerId: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.logoutProvider({ providerId });
	publish(next);
	return next;
}

export function testModel(provider: DesktopProviderConfig, model: DesktopProviderModelConfig) {
	const { models: _models, ...providerWithoutModels } = provider;
	return window.piDesktop.testModel({ provider: providerWithoutModels, model });
}

export function openCustomCss(): Promise<string> {
	return window.piDesktop.openCustomCss();
}

export function checkForUpdates() {
	return window.piDesktop.checkForUpdates();
}

export function downloadUpdate(assetName: string): Promise<DesktopUpdateDownloadState> {
	const input: DesktopUpdateDownloadInput = { assetName };
	return window.piDesktop.downloadUpdate(input);
}

export function cancelUpdateDownload(): Promise<void> {
	return window.piDesktop.cancelUpdateDownload();
}

export function getUpdateDownloadState(): Promise<DesktopUpdateDownloadState> {
	return window.piDesktop.getUpdateDownloadState();
}

export function installUpdate(): Promise<void> {
	return window.piDesktop.installUpdate();
}

export function onUpdateDownloadProgress(listener: (state: DesktopUpdateDownloadState) => void): Unsubscribe {
	return window.piDesktop.onUpdateDownloadProgress(listener);
}

export async function toggleSkill(filePath: string, disable: boolean): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.toggleSkill({ filePath, disable });
	publish(next);
	return next;
}

export async function installPlugin(source: string, local: boolean): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.installPlugin({ source, local });
	publish(next);
	return next;
}

export async function removePlugin(source: string, local: boolean): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.removePlugin({ source, local });
	publish(next);
	return next;
}

export async function togglePlugin(source: string, local: boolean, enabled: boolean): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.togglePlugin({ source, local, enabled });
	publish(next);
	return next;
}

export async function savePluginPackageFilters(input: DesktopPluginPackageFilterInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.savePluginPackageFilters(input);
	publish(next);
	return next;
}

export async function reloadSession(): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.reloadSession();
	publish(next);
	return next;
}

export function getPluginPackages(): Promise<DesktopPluginPackage[]> {
	return window.piDesktop.getPluginPackages();
}

export function listSkillsDetailed(): Promise<DesktopSkillInfo[]> {
	return window.piDesktop.listSkillsDetailed();
}

export function searchSkills(query: string): Promise<DesktopSkillSearchResult[]> {
	return window.piDesktop.searchSkills(query);
}

export async function installSkill(pkg: string, scope: "global" | "project"): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.installSkill(pkg, scope);
	publish(next);
	return next;
}

export function checkSkillUpdates(target?: {
	pkg: string;
	scope: "global" | "project";
}): Promise<DesktopSkillUpdateResult[]> {
	return window.piDesktop.checkSkillUpdates(target);
}

export async function updateSkill(pkg: string, scope: "global" | "project"): Promise<string> {
	return window.piDesktop.updateSkill(pkg, scope);
}

export async function openWorkspacePath(path: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.openWorkspacePath({ path });
	publish(next);
	return next;
}
