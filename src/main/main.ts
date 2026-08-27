import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
	type DesktopDirectoryEntry,
	type DesktopDirectoryListing,
	type DesktopImageAttachment,
	type DesktopSnapshot,
	type DesktopWorkspaceChange,
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
	isDesktopRestoreImageAttachmentsInput,
	isDesktopSaveModelsConfigInput,
	isDesktopToggleSkillInput,
	isDesktopToolApprovalDecisionInput,
	isDesktopWorkspaceFileInput,
} from "../shared/contracts.ts";
import { isNewerVersion } from "../shared/version.ts";
import { DesktopAgentHost, type DesktopPromptImage } from "./desktop-agent-host.ts";
import { importDroppedFiles } from "./dropped-file-import.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let mainWindow: BrowserWindow | undefined;
let host: DesktopAgentHost | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let closeQuits = false;

const TRAY_ICON_WHITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#1a1a1a" d="M3 5h8v1.8H7.8v1.4h2.9V10H7.8v3H3V5Zm11 0h1.8v1.8H14V5Zm0 2.6h1.8V13H14V7.6Z" opacity="0.9"/></svg>`;
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

const MAX_IMAGE_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface PendingImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	image: DesktopPromptImage;
}

const pendingImageAttachments = new Map<string, PendingImageAttachment>();

function pendingImageDirectory(): string {
	return join(app.getPath("userData"), "pending-images");
}

function pendingImagePaths(id: string): { data: string; metadata: string } {
	const directory = pendingImageDirectory();
	return {
		data: join(directory, `${id}.bin`),
		metadata: join(directory, `${id}.json`),
	};
}

function getHost(): DesktopAgentHost {
	if (!host) {
		host = new DesktopAgentHost(join(app.getPath("userData"), "agent"));
	}
	return host;
}

function publishSnapshot(snapshot: DesktopSnapshot): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send("pi-desktop:snapshot", snapshot);
	const folderName = snapshot.workspacePath?.split(/[\\/]/u).filter(Boolean).at(-1);
	const title = folderName ? `${folderName} - Pi Agent` : "Pi Agent";
	if (mainWindow.getTitle() !== title) mainWindow.setTitle(title);
}

function sendWorkspaceChanges(changes: DesktopWorkspaceChange[]): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send("pi-desktop:workspace-changed", changes);
}

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
	if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
		throw new Error("Pi 桌面端拒绝了来自未受信任渲染进程的请求。");
	}
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const actualKeys = Object.keys(value);
	return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
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
	await mkdir(pendingImageDirectory(), { recursive: true, mode: 0o700 });
	for (const attachment of selected) {
		pendingImageAttachments.set(attachment.id, attachment);
		const paths = pendingImagePaths(attachment.id);
		const thumbnailDataUrl = nativeImage
			.createFromBuffer(Buffer.from(attachment.image.data, "base64"))
			.resize({ width: 72, height: 72, quality: "good" })
			.toDataURL();
		await Promise.all([
			writeFile(paths.data, Buffer.from(attachment.image.data, "base64"), { mode: 0o600 }),
			writeFile(
				paths.metadata,
				JSON.stringify({
					id: attachment.id,
					name: attachment.name,
					mimeType: attachment.mimeType,
					size: attachment.size,
					thumbnailDataUrl,
				}),
				{ mode: 0o600 },
			),
		]);
	}
	return selected.map(({ id, name, mimeType, size, image }) => ({
		id,
		name,
		mimeType,
		size,
		thumbnailDataUrl: nativeImage
			.createFromBuffer(Buffer.from(image.data, "base64"))
			.resize({ width: 72, height: 72, quality: "good" })
			.toDataURL(),
	}));
}

async function restoreImageAttachments(ids: string[]): Promise<DesktopImageAttachment[]> {
	const restored: DesktopImageAttachment[] = [];
	for (const id of ids.slice(0, MAX_IMAGE_ATTACHMENTS)) {
		if (!/^[0-9a-f-]{36}$/iu.test(id)) continue;
		try {
			const paths = pendingImagePaths(id);
			const metadata = JSON.parse(await readFile(paths.metadata, "utf8")) as Partial<DesktopImageAttachment>;
			if (
				metadata.id !== id ||
				typeof metadata.name !== "string" ||
				typeof metadata.mimeType !== "string" ||
				!metadata.mimeType.startsWith("image/") ||
				typeof metadata.size !== "number" ||
				metadata.size <= 0 ||
				metadata.size > MAX_IMAGE_BYTES
			) {
				continue;
			}
			const content = await readFile(paths.data);
			if (content.length !== metadata.size || getImageMimeType(content) !== metadata.mimeType) continue;
			const attachment: PendingImageAttachment = {
				id,
				name: metadata.name,
				mimeType: metadata.mimeType,
				size: content.length,
				image: { data: content.toString("base64"), mimeType: metadata.mimeType },
			};
			pendingImageAttachments.set(id, attachment);
			restored.push({
				id,
				name: attachment.name,
				mimeType: attachment.mimeType,
				size: attachment.size,
				...(typeof metadata.thumbnailDataUrl === "string"
					? { thumbnailDataUrl: metadata.thumbnailDataUrl }
					: {
							thumbnailDataUrl: nativeImage
								.createFromBuffer(content)
								.resize({ width: 72, height: 72, quality: "good" })
								.toDataURL(),
						}),
			});
		} catch {
			// Drafts can outlive their files; silently drop unavailable images.
		}
	}
	return restored;
}

async function browseDirectories(directory?: string): Promise<DesktopDirectoryListing> {
	const requested = directory?.trim();
	if (process.platform === "win32" && !requested) {
		const drives = await Promise.all(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async (letter) => {
				const path = `${letter}:\\`;
				try {
					const entry = await stat(path);
					return entry.isDirectory() ? { name: `${letter}:`, path } : undefined;
				} catch {
					return undefined;
				}
			}),
		);
		return {
			path: "",
			directories: [],
			drives: drives.filter((entry): entry is DesktopDirectoryEntry => entry !== undefined),
		};
	}
	const expanded =
		!requested || requested === "~"
			? homedir()
			: requested.startsWith("~/")
				? join(homedir(), requested.slice(2))
				: requested;
	const currentPath = await realpath(resolve(expanded));
	const entries = await readdir(currentPath, { withFileTypes: true });
	const directories = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({ name: entry.name, path: join(currentPath, entry.name) }))
		.sort((left, right) => left.name.localeCompare(right.name));
	const parent = dirname(currentPath);
	return {
		path: currentPath,
		...(parent === currentPath ? {} : { parentPath: parent }),
		directories,
	};
}

async function removePendingImageAttachment(id: string): Promise<void> {
	pendingImageAttachments.delete(id);
	const paths = pendingImagePaths(id);
	await Promise.all([unlink(paths.data).catch(() => {}), unlink(paths.metadata).catch(() => {})]);
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
	ipcMain.handle("pi-desktop:browse-directories", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > 4000)) {
			throw new Error("无效的目录浏览请求。");
		}
		return browseDirectories(value as string | undefined);
	});
	ipcMain.handle("pi-desktop:select-directory", async (event): Promise<string | undefined> => {
		assertMainWindowSender(event);
		const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择本地目录" });
		return result.canceled ? undefined : result.filePaths[0];
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
	ipcMain.handle("pi-desktop:restore-image-attachments", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (!isDesktopRestoreImageAttachmentsInput(value)) {
			throw new Error("无效的图片草稿恢复请求。");
		}
		return restoreImageAttachments(value.ids);
	});
	ipcMain.handle("pi-desktop:discard-image-attachment", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (typeof value !== "string" || !/^[0-9a-f-]{36}$/iu.test(value)) {
			throw new Error("无效的图片附件请求。");
		}
		await removePendingImageAttachment(value);
	});
	ipcMain.handle("pi-desktop:import-dropped-files", async (event, value: unknown) => {
		assertMainWindowSender(event);
		const host = getHost();
		if (!host.getSnapshot().projectTrusted) {
			throw new Error("请先信任当前项目，再导入文件。");
		}
		if (
			!isExactRecord(value, ["paths", "overwriteConflicts"]) ||
			!Array.isArray(value.paths) ||
			value.paths.length > 20 ||
			!value.paths.every((path) => typeof path === "string" && path.length > 0 && path.length <= 4000) ||
			typeof value.overwriteConflicts !== "boolean"
		) {
			throw new Error("无效的拖放文件请求。");
		}
		return importDroppedFiles(host.requireWorkspacePath(), value.paths as string[], value.overwriteConflicts);
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
		const snapshot = await getHost().prompt(text, images, value.streamingBehavior);
		await Promise.all(attachmentIds.map((id) => removePendingImageAttachment(id)));
		return snapshot;
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
	ipcMain.handle("pi-desktop:auto-name-session", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		return getHost().autoNameSession();
	});
	ipcMain.handle("pi-desktop:rename-session", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (
			!isExactRecord(value, ["sessionPath", "name"]) ||
			typeof value.sessionPath !== "string" ||
			value.sessionPath.length === 0 ||
			value.sessionPath.length > 2000 ||
			typeof value.name !== "string" ||
			value.name.length > 120
		) {
			throw new Error("无效的会话重命名请求。");
		}
		return getHost().renameSession(value.sessionPath, value.name);
	});
	ipcMain.handle("pi-desktop:delete-session", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (
			!isExactRecord(value, ["sessionPath"]) ||
			typeof value.sessionPath !== "string" ||
			value.sessionPath.length === 0 ||
			value.sessionPath.length > 2000
		) {
			throw new Error("无效的会话删除请求。");
		}
		const confirmed = await dialog.showMessageBox(mainWindow!, {
			type: "warning",
			title: "删除会话",
			message: "确定删除这个会话？",
			detail: "会话历史文件将被永久删除。",
			buttons: ["取消", "删除"],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		});
		if (confirmed.response !== 1) return getHost().getSnapshot();
		return getHost().deleteSession(value.sessionPath);
	});
	ipcMain.handle("pi-desktop:execute-bash", async (event, value: unknown): Promise<string> => {
		assertMainWindowSender(event);
		if (typeof value !== "object" || value === null) throw new Error("无效的命令执行请求。");
		const input = value as { command?: unknown; excludeFromContext?: unknown };
		if (typeof input.command !== "string" || input.command.length === 0 || input.command.length > 10_000) {
			throw new Error("无效的命令内容。");
		}
		return getHost().executeBashCommand(input.command, input.excludeFromContext === true);
	});
	ipcMain.handle("pi-desktop:read-full-bash-output", async (event, value: unknown): Promise<string> => {
		assertMainWindowSender(event);
		if (!isExactRecord(value, ["messageId"]) || typeof value.messageId !== "string") {
			throw new Error("无效的终端输出请求。");
		}
		return getHost().readFullBashOutput(value.messageId);
	});
	ipcMain.handle("pi-desktop:save-full-bash-output", async (event, value: unknown): Promise<string> => {
		assertMainWindowSender(event);
		if (!isExactRecord(value, ["messageId"]) || typeof value.messageId !== "string") {
			throw new Error("无效的完整输出保存请求。");
		}
		const output = await getHost().readFullBashOutput(value.messageId);
		const result = await dialog.showSaveDialog(mainWindow!, {
			title: "保存完整终端输出",
			defaultPath: `pi-terminal-output-${Date.now()}.txt`,
			filters: [{ name: "文本文件", extensions: ["txt", "log"] }],
		});
		if (result.canceled || !result.filePath) return "";
		await writeFile(result.filePath, output, { mode: 0o600 });
		return result.filePath;
	});
	ipcMain.handle("pi-desktop:copy-last-answer", async (event): Promise<string> => {
		assertMainWindowSender(event);
		return getHost().copyLastAnswer();
	});
	ipcMain.handle("pi-desktop:respond-to-extension-dialog", (event, value: unknown): void => {
		assertMainWindowSender(event);
		if (!isExactRecord(value, ["id", "value"]) || typeof value.id !== "string" || typeof value.value !== "string") {
			throw new Error("无效的扩展对话框响应。");
		}
		getHost().respondToExtensionDialog(value.id, value.value);
	});
	ipcMain.handle("pi-desktop:extension-custom-input", (event, value: unknown): void => {
		assertMainWindowSender(event);
		if (
			!isExactRecord(value, ["id", "data"]) ||
			typeof value.id !== "string" ||
			typeof value.data !== "string" ||
			value.id.length > 128 ||
			value.data.length > 100_000
		) {
			throw new Error("无效的扩展自定义界面输入。");
		}
		getHost().sendExtensionCustomInput(value.id, value.data);
	});
	ipcMain.handle("pi-desktop:export-session", async (event): Promise<string> => {
		assertMainWindowSender(event);
		const snapshot = getHost().getSnapshot();
		const session = snapshot.session;
		if (!session) throw new Error("没有可导出的会话。");
		const escapeHtml = (text: string): string =>
			text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
		const body = session.messages
			.map((message) => {
				const label =
					message.role === "user" ? "你" : message.role === "assistant" ? "助手" : (message.toolName ?? "系统");
				return `<section class="msg ${message.role}"><h3>${escapeHtml(label)}${
					message.timestamp ? `<time>${new Date(message.timestamp).toLocaleString()}</time>` : ""
				}</h3><pre>${escapeHtml(message.text)}</pre></section>`;
			})
			.join("\n");
		const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(
			session.name ?? "Pi 会话",
		)}</title><style>body{font-family:-apple-system,'Segoe UI',sans-serif;max-width:820px;margin:0 auto;padding:32px 20px;color:#1a1a1a;background:#fff}h1{font-size:20px}section.msg{margin:0 0 20px;padding:12px 16px;border-radius:10px;background:#f5f5f5}section.msg.user{background:#e8f0fe}section.msg h3{margin:0 0 8px;font-size:12px;color:#666;display:flex;justify-content:space-between}section.msg pre{white-space:pre-wrap;word-break:break-word;margin:0;font:inherit;font-size:14px;line-height:1.65}</style></head><body><h1>${escapeHtml(
			session.name ?? "Pi 会话",
		)}</h1>${body}</body></html>`;
		const filePath = join(app.getPath("temp"), `pi-session-${Date.now()}.html`);
		await writeFile(filePath, html, { mode: 0o600 });
		await getHost().openPath(filePath);
		return filePath;
	});
	ipcMain.handle("pi-desktop:set-model", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopModelSelectionInput(value)) {
			throw new Error("无效的模型选择请求。");
		}
		return getHost().setModel(value.provider, value.modelId);
	});
	ipcMain.handle("pi-desktop:set-thinking-level", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (
			typeof value !== "string" ||
			!["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
		) {
			throw new Error("无效的思考级别。");
		}
		return getHost().setThinkingLevel(
			value as "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
		);
	});
	ipcMain.handle("pi-desktop:compact", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (value !== undefined && (typeof value !== "string" || value.length > 4000)) {
			throw new Error("无效的压缩指令。");
		}
		return getHost().compact(value as string | undefined);
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
	ipcMain.handle("pi-desktop:cancel-provider-setup", (event): DesktopSnapshot => {
		assertMainWindowSender(event);
		return getHost().cancelProviderSetup();
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
	ipcMain.handle("pi-desktop:search-workspace-files", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (typeof value !== "string" || value.length > 200) throw new Error("无效的文件搜索请求。");
		return getHost().searchWorkspaceFiles(value);
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
	ipcMain.handle("pi-desktop:save-workspace-file", async (event, value: unknown): Promise<string> => {
		assertMainWindowSender(event);
		if (!isDesktopWorkspaceFileInput(value)) {
			throw new Error("无效的项目文件请求。");
		}
		const preview = await getHost().readWorkspaceFile(value.path);
		const suggestedName = value.path.split("/").at(-1) ?? "file";
		const result = await dialog.showSaveDialog({
			title: "保存文件",
			defaultPath: join(app.getPath("downloads"), suggestedName),
		});
		if (result.canceled || !result.filePath) return "";
		const binaryDataUrl = preview.binaryDataUrl ?? preview.imageDataUrl;
		if (binaryDataUrl?.startsWith("data:")) {
			const base64 = binaryDataUrl.slice(binaryDataUrl.indexOf(",") + 1);
			await writeFile(result.filePath, Buffer.from(base64, "base64"));
		} else {
			await writeFile(result.filePath, preview.content, "utf8");
		}
		return result.filePath;
	});
	ipcMain.handle("pi-desktop:open-external-url", async (event, value: unknown): Promise<void> => {
		assertMainWindowSender(event);
		if (!isDesktopOpenExternalUrlInput(value)) {
			throw new Error("无效的外部链接请求。");
		}
		await getHost().openExternalUrl(value);
	});
	ipcMain.handle("pi-desktop:notify-complete", (event, value: unknown): void => {
		assertMainWindowSender(event);
		if (
			value !== undefined &&
			(!isExactRecord(value, ["sessionName", "force"]) ||
				(value.sessionName !== undefined &&
					(typeof value.sessionName !== "string" || value.sessionName.length > 120)) ||
				(value.force !== undefined && typeof value.force !== "boolean"))
		) {
			throw new Error("无效的完成通知请求。");
		}
		const input = value as { sessionName?: string; force?: boolean } | undefined;
		if (!input?.force && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
		if (!Notification.isSupported()) return;
		new Notification({
			title: input?.sessionName ? `已完成：${input.sessionName}` : "Pi 任务完成",
			body: "智能体已处理完毕。",
		}).show();
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
	ipcMain.handle("pi-desktop:list-git-branches", async (event) => {
		assertMainWindowSender(event);
		return getHost().listGitBranches();
	});
	ipcMain.handle("pi-desktop:fetch-git-branches", async (event): Promise<void> => {
		assertMainWindowSender(event);
		await getHost().fetchGitBranches();
	});
	ipcMain.handle("pi-desktop:switch-git-branch", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (!isDesktopAddWorktreeInput(value)) throw new Error("无效的 Git 分支请求。");
		return getHost().switchGitBranch(value.branch);
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
			message: value.force ? `强制移除 ${value.path}？` : `确定移除 ${value.path}？`,
			detail: value.force
				? "这会丢弃该 Worktree 中所有未提交和未跟踪的文件，且无法撤销。"
				: "如果 Worktree 有未提交修改，下一步会提供强制移除选项。",
		});
		if (confirmed.response !== 1) return {};
		return getHost().removeGitWorktree(value.path, value.force === true);
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
	ipcMain.handle("pi-desktop:lookup-model-catalog", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (
			!isExactRecord(value, ["providerId", "modelId"]) ||
			typeof value.providerId !== "string" ||
			typeof value.modelId !== "string" ||
			!value.providerId ||
			!value.modelId ||
			value.providerId.length > 200 ||
			value.modelId.length > 500
		) {
			throw new Error("无效的模型目录查询。");
		}
		return getHost().lookupModelCatalog(value.providerId, value.modelId);
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
			await writeFile(cssPath, "/* Pi Agent custom styles */\n", { mode: 0o600 });
		}
		await getHost().openPath(cssPath);
		return cssPath;
	});
	ipcMain.handle("pi-desktop:check-for-updates", async (event) => {
		assertMainWindowSender(event);
		const response = (await fetch("https://api.github.com/repos/abcwyc/pi-agent-desktop/releases/latest", {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "pi-agent-desktop" },
		})) as FetchResponse;
		if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）。`);
		const release = (await response.json()) as { tag_name?: string; html_url?: string };
		const latestVersion = release.tag_name?.replace(/^v/u, "");
		return {
			currentVersion: app.getVersion(),
			...(latestVersion ? { latestVersion } : {}),
			releaseUrl: release.html_url ?? "https://github.com/abcwyc/pi-agent-desktop/releases",
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
	ipcMain.handle("pi-desktop:toggle-plugin", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (
			!isExactRecord(value, ["source", "local", "enabled"]) ||
			typeof value.source !== "string" ||
			typeof value.local !== "boolean" ||
			typeof value.enabled !== "boolean"
		) {
			throw new Error("无效的插件启停请求。");
		}
		return getHost().togglePlugin(value.source, value.local, value.enabled);
	});
	ipcMain.handle("pi-desktop:reload-session", async (event): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		return getHost().reloadSession();
	});
	ipcMain.handle("pi-desktop:get-plugin-packages", async (event) => {
		assertMainWindowSender(event);
		return getHost().getPluginPackages();
	});
	ipcMain.handle("pi-desktop:list-skills-detailed", async (event) => {
		assertMainWindowSender(event);
		return getHost().listSkillsDetailed();
	});
	ipcMain.handle("pi-desktop:search-skills", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (typeof value !== "string" || !value.trim() || value.length > 200) {
			throw new Error("无效的技能搜索请求。");
		}
		return getHost().searchSkills(value);
	});
	ipcMain.handle("pi-desktop:install-skill", async (event, value: unknown): Promise<DesktopSnapshot> => {
		assertMainWindowSender(event);
		if (typeof value !== "object" || value === null) throw new Error("无效的技能安装请求。");
		const input = value as { pkg?: unknown; scope?: unknown };
		if (typeof input.pkg !== "string" || !input.pkg.trim() || input.pkg.length > 500) {
			throw new Error("无效的技能资源包。");
		}
		if (input.scope !== "global" && input.scope !== "project") throw new Error("无效的技能安装范围。");
		const confirmation = await dialog.showMessageBox(mainWindow!, {
			type: "warning",
			title: "确认安装技能",
			message: `安装${input.scope === "project" ? "项目" : "全局"}技能？`,
			detail: input.pkg,
			buttons: ["取消", "安装"],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		});
		if (confirmation.response !== 1) return getHost().getSnapshot();
		return getHost().installSkill(input.pkg, input.scope);
	});
	ipcMain.handle("pi-desktop:check-skill-updates", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (value === undefined || value === null) return getHost().checkSkillUpdates();
		if (typeof value !== "object") throw new Error("无效的技能更新检查请求。");
		const input = value as { pkg?: unknown; scope?: unknown };
		if (typeof input.pkg !== "string" || (input.scope !== "global" && input.scope !== "project")) {
			throw new Error("无效的技能更新检查请求。");
		}
		return getHost().checkSkillUpdates({ pkg: input.pkg, scope: input.scope });
	});
	ipcMain.handle("pi-desktop:update-skill", async (event, value: unknown) => {
		assertMainWindowSender(event);
		if (typeof value !== "object" || value === null) throw new Error("无效的技能更新请求。");
		const input = value as { pkg?: unknown; scope?: unknown };
		if (typeof input.pkg !== "string" || (input.scope !== "global" && input.scope !== "project")) {
			throw new Error("无效的技能更新请求。");
		}
		return getHost().updateSkill(input.pkg, input.scope);
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
		host.onWorkspaceChanged(sendWorkspaceChanges);
		host.onExtensionUi((event) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("pi-desktop:extension-ui", event);
			}
		});
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
