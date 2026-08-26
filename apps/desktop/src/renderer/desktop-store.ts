import type {
	DesktopAuthenticationPromptResponseInput,
	DesktopGitChange,
	DesktopGitWorktree,
	DesktopImageAttachment,
	DesktopModelSelectionInput,
	DesktopNavigateTreeInput,
	DesktopOpenSessionInput,
	DesktopProviderConfig,
	DesktopProviderSetupInput,
	DesktopSnapshot,
	DesktopSnapshotListener,
	DesktopToolApprovalDecisionInput,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
	Unsubscribe,
} from "../shared/contracts.ts";

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
			const initial = await window.piDesktop.bootstrap();
			publish(initial);
			window.piDesktop.onSnapshot(publish);
			started = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			startupError = message;
			publish({
				...snapshot,
				notice: `Pi 桌面端初始化失败：${message}。请解决问题后重试。`,
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

export function chooseImages(): Promise<DesktopImageAttachment[]> {
	return window.piDesktop.chooseImages();
}

export async function submitPrompt(text: string, attachmentIds: string[]): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.prompt({ text, ...(attachmentIds.length ? { attachmentIds } : {}) });
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

export async function setModel(input: DesktopModelSelectionInput): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.setModel(input);
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

export function readWorkspaceFile(path: string): Promise<DesktopWorkspaceFilePreview> {
	return window.piDesktop.readWorkspaceFile({ path });
}

export function openWorkspaceFile(path: string): Promise<void> {
	return window.piDesktop.openWorkspaceFile({ path });
}

export function revealWorkspaceFile(path: string): Promise<void> {
	return window.piDesktop.revealWorkspaceFile({ path });
}

export function notifyComplete(): Promise<void> {
	return window.piDesktop.notifyComplete();
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

export function addGitWorktree(branch: string): Promise<DesktopGitWorktree> {
	return window.piDesktop.addGitWorktree({ branch });
}

export function setCloseQuits(closeQuits: boolean): Promise<void> {
	return window.piDesktop.setCloseQuits(closeQuits);
}

export function quitApp(): Promise<void> {
	return window.piDesktop.quitApp();
}

export function getModelsConfig(): Promise<DesktopProviderConfig[]> {
	return window.piDesktop.getModelsConfig();
}

export async function saveModelsConfig(providers: DesktopProviderConfig[]): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.saveModelsConfig({ providers });
	publish(next);
	return next;
}

export function discoverModels(baseUrl: string, apiKey?: string): Promise<Array<{ id: string }>> {
	return window.piDesktop.discoverModels({ baseUrl, ...(apiKey ? { apiKey } : {}) });
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

export function getPluginPackages(): Promise<Array<{ source: string; scope: "user" | "project" }>> {
	return window.piDesktop.getPluginPackages();
}

export async function openWorkspacePath(path: string): Promise<DesktopSnapshot> {
	const next = await window.piDesktop.openWorkspacePath({ path });
	publish(next);
	return next;
}
