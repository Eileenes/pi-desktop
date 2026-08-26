import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	Menu,
	type NativeImage,
	Notification,
	nativeImage,
	Tray,
} from "electron";
import type { Response as FetchResponse } from "undici-types";
import {
	type DesktopImageAttachment,
	type DesktopSnapshot,
	isDesktopAddWorktreeInput,
	isDesktopAuthenticationPromptResponseInput,
	isDesktopDiscoverModelsInput,
	isDesktopGitDiffInput,
	isDesktopModelSelectionInput,
	isDesktopModelTestInput,
	isDesktopNavigateTreeInput,
	isDesktopOpenExternalUrlInput,
	isDesktopOpenSessionInput,
	isDesktopOpenWorkspacePathInput,
	isDesktopPluginSourceInput,
	isDesktopProjectTrustInput,
	isDesktopPromptInput,
	isDesktopProviderLogoutInput,
	isDesktopProviderSetupInput,
	isDesktopRemoveWorktreeInput,
	isDesktopSaveModelsConfigInput,
	isDesktopToggleSkillInput,
	isDesktopToolApprovalDecisionInput,
	isDesktopWorkspaceFileInput,
} from "../shared/contracts.ts";
import { isNewerVersion } from "../shared/version.ts";
import { DesktopAgentHost, type DesktopPromptImage } from "./desktop-agent-host.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let mainWindow: BrowserWindow | undefined;
let host: DesktopAgentHost | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let closeQuits = false;

const TRAY_ICON_WHITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="white" d="M9 2.25a6.75 6.75 0 1 0 0 13.5A6.75 6.75 0 0 0 9 2.25Zm0 2.1a4.65 4.65 0 1 1 0 9.3 4.65 4.65 0 0 1 0-9.3Z"/><circle cx="9" cy="9" r="2.05" fill="white"/></svg>`;
const TRAY_ICON_COLOR_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAABjklEQVR4nO2ZvW6DMBRGv5ZKvARlqxTBC2RJ361pJNKdJWVpprqvwEuwBnVmYWFGArWTo/J/DdjgKmdiMPcefTK2hYEbcrmbq9Bm8/QzNOZy+Z7cb1IBimQXY+VHvTRFtI6ouNDgOUXrUMXvqQVlyorUJwnLlhXpMyisSpbar1dYtSylb6fwUrJD/VuFl5bltHk8jCm02z3D87xJMmEYYr9/EX6vkfBa0uXUfRqLtYiwZVlg7AsAwNgnfN9vHee6Lk6ndwBAEAQ4nz/oxqhuKpWE15Yu568XeadbC/oKr3U6cLifvgnrwk1YNkqEi6K4PhuGMamWEuEsy67P2+0WlvUI27ZH1VIinKYpkiQBADiOA8YYjse3UbWUzeHD4RVxHKMsy0l1Kocf0c3DNE04jgOgmqIM+AFo1HmYk+c5oiiax4iI3svaHP++ZNB5HtaBhvDaUq776J8wsJ6U2zw6E15auqt/75RYSrqv7+AcVi091I/00amSpvQhrxKypan1//cdRx1tbpHaUHVPpx2/NvmcOC+ox8YAAAAASUVORK5CYII=";

function getTrayIcon(): NativeImage {
	if (process.platform === "darwin") {
		const image = nativeImage.createFromDataURL(
			`data:image/svg+xml;base64,${Buffer.from(TRAY_ICON_WHITE_SVG).toString("base64")}`,
		);
		image.setTemplateImage(false);
		return image;
	}
	return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_COLOR_BASE64}`);
}

const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface PendingImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	image: DesktopPromptImage;
}

const pendingImageAttachments = new Map<string, PendingImageAttachment>();

function getHost(): DesktopAgentHost {
	if (!host) {
		host = new DesktopAgentHost(join(app.getPath("userData"), "agent"));
	}
	return host;
}

function publishSnapshot(snapshot: DesktopSnapshot): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send("pi-desktop:snapshot", snapshot);
}

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
	if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
		throw new Error("Pi 桌面端拒绝了来自未受信任渲染进程的请求。");
	}
}

function getImageMimeType(content: Buffer): string | undefined {
	if (
		content.length >= 8 &&
		content[0] === 0x89 &&
		content[1] === 0x50 &&
		content[2] === 0x4e &&
		content[3] === 0x47 &&
		content[4] === 0x0d &&
		content[5] === 0x0a &&
		content[6] === 0x1a &&
		content[7] === 0x0a
	) {
		return "image/png";
	}
	if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		content.length >= 6 &&
		(content.subarray(0, 6).toString("ascii") === "GIF87a" || content.subarray(0, 6).toString("ascii") === "GIF89a")
	) {
		return "image/gif";
	}
	if (
		content.length >= 12 &&
		content.subarray(0, 4).toString("ascii") === "RIFF" &&
		content.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	return undefined;
}

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1440,
		height: 920,
		minWidth: 980,
		minHeight: 680,
		backgroundColor: "#161615",
		...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
		show: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: join(currentDirectory, "..", "preload", "index.cjs"),
			sandbox: true,
		},
	});

	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.on("will-redirect", (event) => event.preventDefault());
	window.on("close", (event) => {
		if (isQuitting || closeQuits) return;
		event.preventDefault();
		window.hide();
	});
	window.once("ready-to-show", () => window.show());
	window.webContents.on("did-finish-load", () => {
		void readFile(join(app.getPath("userData"), "custom.css"), "utf8")
			.then((css) => window.webContents.insertCSS(css))
			.catch(() => {});
	});
	void window.loadFile(join(currentDirectory, "..", "..", "renderer", "index.html"));
	return window;
}

function showMainWindow(): void {
	if (!mainWindow || mainWindow.isDestroyed()) {
		mainWindow = createWindow();
		return;
	}
	mainWindow.show();
	mainWindow.focus();
}

function createTray(): void {
	if (tray) return;
	tray = new Tray(getTrayIcon());
	tray.setToolTip("Pi 桌面端");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "显示 Pi", click: () => showMainWindow() },
			{ type: "separator" },
			{
				label: "退出",
				click: () => {
					isQuitting = true;
					app.quit();
				},
			},
		]),
	);
	tray.on("click", () => showMainWindow());
}

async function prepareImageAttachments(filePaths: string[]): Promise<DesktopImageAttachment[]> {
	if (filePaths.length > MAX_IMAGE_ATTACHMENTS) {
		throw new Error(`一次最多选择 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
	}
	const selected: PendingImageAttachment[] = [];
	for (const filePath of filePaths) {
		const content = await readFile(filePath);
		if (content.length === 0 || content.length > MAX_IMAGE_BYTES) {
			throw new Error("每张图片必须大于 0 字节且不超过 10 MB。");
		}
		const mimeType = getImageMimeType(content);
		if (!mimeType) throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片。");
		const id = randomUUID();
		selected.push({
			id,
			name: filePath.split(/[\\/]/u).at(-1) ?? "图片",
			mimeType,
			size: content.length,
			image: { data: content.toString("base64"), mimeType },
		});
	}
	pendingImageAttachments.clear();
	for (const attachment of selected) pendingImageAttachments.set(attachment.id, attachment);
	return selected.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
}

function registerIpc(): void {
	ipcMain.handle("pi-desktop:bootstrap", async (event) => {
		assertMainWindowSender(event);
		return getHost().initialize();
	});
	ipcMain.handle("pi-desktop:choose-workspace", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory"],
			title: "选择项目文件夹",
		});
		if (result.canceled || !result.filePaths[0]) return getHost().getSnapshot();
		return getHost().openWorkspace(result.filePaths[0]);
	});
	ipcMain.handle("pi-desktop:choose-images", async (event) => {
		assertMainWindowSender(event);
		const result = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			title: "选择图片",
			filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
		});
		if (result.canceled) return [];
		return prepareImageAttachments(result.filePaths);
	});
	ipcMain.handle("pi-desktop:attach-dropped-images", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (
			!Array.isArray(value) ||
			value.length > MAX_IMAGE_ATTACHMENTS ||
			!value.every((path) => typeof path === "string" && path.length > 0 && path.length <= 4000)
		) {
			throw new Error("无效的拖放图片请求。");
		}
		return prepareImageAttachments(value);
	});
	ipcMain.handle("pi-desktop:prompt", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopPromptInput(value)) {
			throw new Error("无效的桌面端消息请求。");
		}
		const text = value.text.trim();
		const attachmentIds = value.attachmentIds ?? [];
		if (!text && attachmentIds.length === 0) return getHost().getSnapshot();
		if (text.length > 100_000) {
			throw new Error("桌面端消息不能超过 100,000 个字符。");
		}
		const images = attachmentIds.map((id) => {
			const attachment = pendingImageAttachments.get(id);
			if (!attachment) throw new Error("所选图片已失效，请重新选择。");
			return attachment.image;
		});
		return getHost().prompt(text, images, value.streamingBehavior);
	});
	ipcMain.handle("pi-desktop:abort", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		return getHost().abort();
	});
	ipcMain.handle("pi-desktop:open-session", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopOpenSessionInput(value)) {
			throw new Error("无效的会话切换请求。");
		}
		return getHost().openSession(value.sessionPath);
	});
	ipcMain.handle("pi-desktop:new-session", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		return getHost().newSession();
	});
	ipcMain.handle("pi-desktop:navigate-tree", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopNavigateTreeInput(value)) {
			throw new Error("无效的分支切换请求。");
		}
		return getHost().navigateTree(value.entryId);
	});
	ipcMain.handle("pi-desktop:fork-session", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		return getHost().forkSession();
	});
	ipcMain.handle("pi-desktop:set-model", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopModelSelectionInput(value)) {
			throw new Error("无效的模型选择请求。");
		}
		return getHost().setModel(value.provider, value.modelId);
	});
	ipcMain.handle("pi-desktop:set-project-trust", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopProjectTrustInput(value)) {
			throw new Error("无效的项目权限请求。");
		}
		return getHost().setProjectTrust(value.trusted);
	});
	ipcMain.handle("pi-desktop:decide-tool-approval", (event, value: unknown): DesktopSnapshot => {
		assertMainWindowSender(event);
		if (!isDesktopToolApprovalDecisionInput(value)) {
			throw new Error("无效的工具审批请求。");
		}
		return getHost().decideToolApproval(value.id, value.approved);
	});
	ipcMain.handle("pi-desktop:start-provider-setup", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopProviderSetupInput(value)) {
			throw new Error("无效的模型服务商配置请求。");
		}
		return getHost().startProviderSetup(value.providerId, value.authType);
	});
	ipcMain.handle("pi-desktop:logout-provider", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopProviderLogoutInput(value)) throw new Error("无效的模型服务商注销请求。");
		return getHost().logoutProvider(value.providerId);
	});
	ipcMain.handle("pi-desktop:respond-to-authentication-prompt", (event, value: unknown): DesktopSnapshot => {
		assertMainWindowSender(event);
		if (!isDesktopAuthenticationPromptResponseInput(value)) {
			throw new Error("无效的认证响应。");
		}
		return getHost().respondToAuthenticationPrompt(value.id, value.response);
	});
	ipcMain.handle("pi-desktop:list-workspace-files", async (event) => {
		assertMainWindowSender(event);
		return getHost().listWorkspaceFiles();
	});
	ipcMain.handle("pi-desktop:read-workspace-file", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopWorkspaceFileInput(value)) {
			throw new Error("无效的项目文件请求。");
		}
		return getHost().readWorkspaceFile(value.path);
	});
	ipcMain.handle("pi-desktop:open-workspace-file", async (event, value: unknown): Promise<void> => {
		assertMainWindowSender(event);
		if (!isDesktopWorkspaceFileInput(value)) {
			throw new Error("无效的项目文件请求。");
		}
		await getHost().openWorkspaceFile(value.path);
	});
	ipcMain.handle("pi-desktop:reveal-workspace-file", async (event, value: unknown): Promise<void> => {
		assertMainWindowSender(event);
		if (!isDesktopWorkspaceFileInput(value)) {
			throw new Error("无效的项目文件请求。");
		}
		await getHost().revealWorkspaceFile(value.path);
	});
	ipcMain.handle("pi-desktop:open-external-url", async (event, value: unknown): Promise<void> => {
		assertMainWindowSender(event);
		if (!isDesktopOpenExternalUrlInput(value)) {
			throw new Error("无效的外部链接请求。");
		}
		await getHost().openExternalUrl(value);
	});
	ipcMain.handle("pi-desktop:notify-complete", (event): void => {
		assertMainWindowSender(event);
		if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
		if (!Notification.isSupported()) return;
		new Notification({ title: "Pi 任务完成", body: "智能体已处理完毕。" }).show();
	});
	ipcMain.handle("pi-desktop:set-close-quits", (event, value: unknown): void => {
		assertMainWindowSender(event);
		if (typeof value !== "boolean") {
			throw new Error("无效的关闭行为设置。");
		}
		closeQuits = value;
	});
	ipcMain.handle("pi-desktop:quit-app", (event): void => {
		assertMainWindowSender(event);
		isQuitting = true;
		app.quit();
	});
	ipcMain.handle("pi-desktop:list-git-changes", async (event) => {
		assertMainWindowSender(event);
		return getHost().listGitChanges();
	});
	ipcMain.handle("pi-desktop:git-diff", async (event, value: unknown): Promise<string> => {
		assertMainWindowSender(event);
		if (!isDesktopGitDiffInput(value)) {
			throw new Error("无效的差异请求。");
		}
		return getHost().getGitDiff(value.path);
	});
	ipcMain.handle("pi-desktop:list-git-worktrees", async (event) => {
		assertMainWindowSender(event);
		return getHost().listGitWorktrees();
	});
	ipcMain.handle("pi-desktop:add-git-worktree", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopAddWorktreeInput(value)) {
			throw new Error("无效的 worktree 请求。");
		}
		return getHost().addGitWorktree(value.branch);
	});
	ipcMain.handle("pi-desktop:remove-git-worktree", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopRemoveWorktreeInput(value)) {
			throw new Error("无效的 worktree 删除请求。");
		}
		const confirmed = await dialog.showMessageBox({
			type: "warning",
			buttons: ["取消", "移除"],
			defaultId: 0,
			cancelId: 0,
			title: "移除 Worktree",
			message: `确定移除 ${value.path}？`,
			detail: "Git 将拒绝删除包含未提交修改的 Worktree。",
		});
		if (confirmed.response !== 1) return;
		return getHost().removeGitWorktree(value.path);
	});
	ipcMain.handle("pi-desktop:open-workspace-path", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopOpenWorkspacePathInput(value)) {
			throw new Error("无效的项目路径请求。");
		}
		return getHost().openWorkspace(value.path);
	});
	ipcMain.handle("pi-desktop:get-models-config", async (event) => {
		assertMainWindowSender(event);
		return getHost().getModelsConfig();
	});
	ipcMain.handle("pi-desktop:save-models-config", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopSaveModelsConfigInput(value)) {
			throw new Error("无效的模型配置。");
		}
		return getHost().saveModelsConfig(value.providers);
	});
	ipcMain.handle("pi-desktop:discover-models", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopDiscoverModelsInput(value)) {
			throw new Error("无效的模型发现请求。");
		}
		return getHost().discoverModels(value.providerId, value.baseUrl, value.apiKey);
	});
	ipcMain.handle("pi-desktop:test-model", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopModelTestInput(value)) throw new Error("无效的模型测试请求。");
		return getHost().testModel(value.provider, value.model);
	});
	ipcMain.handle("pi-desktop:open-custom-css", async (event): Promise<string> => {
		assertMainWindowSender(event);
		const cssPath = join(app.getPath("userData"), "custom.css");
		await mkdir(app.getPath("userData"), { recursive: true });
		try {
			await readFile(cssPath);
		} catch {
			await writeFile(cssPath, "/* Pi Desktop custom styles */\n", { mode: 0o600 });
		}
		await getHost().openPath(cssPath);
		return cssPath;
	});
	ipcMain.handle("pi-desktop:check-for-updates", async (event) => {
		assertMainWindowSender(event);
		const response = (await fetch("https://api.github.com/repos/Eileenes/pi-desktop/releases/latest", {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "pi-desktop" },
		})) as FetchResponse;
		if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）。`);
		const release = (await response.json()) as { tag_name?: string; html_url?: string };
		const latestVersion = release.tag_name?.replace(/^v/u, "");
		return {
			currentVersion: app.getVersion(),
			...(latestVersion ? { latestVersion } : {}),
			releaseUrl: release.html_url ?? "https://github.com/Eileenes/pi-desktop/releases",
			updateAvailable: Boolean(latestVersion && isNewerVersion(latestVersion, app.getVersion())),
			checkedAt: Date.now(),
		};
	});
	ipcMain.handle("pi-desktop:toggle-skill", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopToggleSkillInput(value)) {
			throw new Error("无效的技能切换请求。");
		}
		return getHost().toggleSkill(value.filePath, value.disable);
	});
	ipcMain.handle("pi-desktop:install-plugin", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopPluginSourceInput(value)) {
			throw new Error("无效的插件安装请求。");
		}
		const host = getHost();
		if (value.local && !host.getSnapshot().projectTrusted) {
			throw new Error("请先信任当前项目，再安装项目插件。");
		}
		const confirmation = await dialog.showMessageBox(mainWindow!, {
			type: "warning",
			title: "确认安装插件",
			message: `安装${value.local ? "项目" : "用户"}插件？`,
			detail: value.source,
			buttons: ["取消", "安装"],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		});
		if (confirmation.response !== 1) return host.getSnapshot();
		return host.installPlugin(value.source, value.local);
	});
	ipcMain.handle("pi-desktop:remove-plugin", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopPluginSourceInput(value)) {
			throw new Error("无效的插件移除请求。");
		}
		return getHost().removePlugin(value.source, value.local);
	});
	ipcMain.handle("pi-desktop:get-plugin-packages", async (event) => {
		assertMainWindowSender(event);
		return getHost().getPluginPackages();
	});
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", () => showMainWindow());

	app.whenReady().then(() => {
		registerIpc();
		host = getHost();
		host.subscribe(publishSnapshot);
		mainWindow = createWindow();
		createTray();

		app.on("activate", () => showMainWindow());
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("before-quit", () => {
		isQuitting = true;
		void host?.dispose();
	});
}
