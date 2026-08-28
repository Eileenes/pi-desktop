import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type BrowserWindow, shell } from "electron";
import type { Response as FetchResponse } from "undici-types";
import type { DesktopUpdateAsset, DesktopUpdateDownloadState } from "../shared/contracts.ts";

const PLATFORM_ASSET_PATTERNS: Record<string, RegExp[]> = {
	darwin: [/\.dmg$/iu, /\.zip$/iu],
	win32: [/\.exe$/iu, /\.zip$/iu],
	linux: [/\.appimage$/iu, /\.deb$/iu],
};

const PROGRESS_EVENT_THROTTLE_MS = 250;

/** Keep only installer assets for the current platform, dropping checksums and blockmaps. */
export function selectUpdateAssets(
	assets: ReadonlyArray<{ name?: unknown; size?: unknown; browser_download_url?: unknown }>,
): DesktopUpdateAsset[] {
	const patterns = PLATFORM_ASSET_PATTERNS[process.platform] ?? [];
	const selected: DesktopUpdateAsset[] = [];
	for (const asset of assets) {
		const name = typeof asset.name === "string" ? asset.name : "";
		const url = typeof asset.browser_download_url === "string" ? asset.browser_download_url : "";
		const sizeBytes = typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : 0;
		if (!name || !url || !patterns.some((pattern) => pattern.test(name))) continue;
		if (/\.blockmap$/iu.test(name) || /checksum/iu.test(name)) continue;
		selected.push({ name, url, sizeBytes });
	}
	return selected;
}

type StateListener = (state: DesktopUpdateDownloadState) => void;

export class DesktopUpdateDownloader {
	private state: DesktopUpdateDownloadState = { phase: "idle" };
	private controller: AbortController | undefined;
	private readonly listeners = new Set<StateListener>();
	private updatesDirectory: string;
	private notifyWindow: () => BrowserWindow | undefined;

	constructor(updatesDirectory: string, notifyWindow: () => BrowserWindow | undefined) {
		this.updatesDirectory = updatesDirectory;
		this.notifyWindow = notifyWindow;
	}

	getState(): DesktopUpdateDownloadState {
		return this.state;
	}

	onState(listener: StateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(state: DesktopUpdateDownloadState): void {
		this.state = state;
		for (const listener of this.listeners) listener(state);
		const window = this.notifyWindow();
		if (window && !window.isDestroyed()) {
			window.webContents.send("pi-desktop:update-download-progress", state);
		}
	}

	isBusy(): boolean {
		return this.state.phase === "downloading";
	}

	/** Download an installer asset from the verified GitHub release list resolved by the main process. */
	async download(
		assetName: string,
		allowedAssets: ReadonlyArray<DesktopUpdateAsset>,
	): Promise<DesktopUpdateDownloadState> {
		if (this.state.phase === "downloading") {
			throw new Error("已有更新下载正在进行，请先取消。");
		}
		const asset = allowedAssets.find((candidate) => candidate.name === assetName);
		if (!asset || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(asset.name)) {
			throw new Error("请先检查更新，再从最新 Release 中选择安装包。");
		}
		this.controller = new AbortController();
		const controller = this.controller;
		this.setState({ phase: "downloading", assetName, receivedBytes: 0 });
		try {
			const response = (await fetch(asset.url, {
				redirect: "follow",
				signal: controller.signal,
				headers: { "User-Agent": "pi-agent-desktop" },
			})) as FetchResponse;
			if (!response.ok) {
				throw new Error(`下载失败（HTTP ${response.status}）。`);
			}
			const totalHeader = response.headers.get("content-length");
			const totalBytes =
				typeof totalHeader === "string" && Number.isFinite(Number(totalHeader)) && Number(totalHeader) > 0
					? Number(totalHeader)
					: undefined;
			if (!response.body) throw new Error("下载响应没有内容。");
			await mkdir(this.updatesDirectory, { recursive: true, mode: 0o700 });
			const finalPath = join(this.updatesDirectory, asset.name);
			const partPath = `${finalPath}.part`;
			const handle = await open(partPath, "w", 0o600);
			let received = 0;
			let lastEventAt = 0;
			try {
				for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
					await handle.write(chunk);
					received += chunk.byteLength;
					const now = Date.now();
					if (now - lastEventAt >= PROGRESS_EVENT_THROTTLE_MS) {
						lastEventAt = now;
						this.setState({
							phase: "downloading",
							assetName,
							receivedBytes: received,
							...(totalBytes !== undefined ? { totalBytes } : {}),
						});
					}
				}
			} finally {
				await handle.close();
			}
			await rename(partPath, finalPath);
			this.setState({
				phase: "completed",
				assetName,
				savedPath: finalPath,
			});
			return this.state;
		} catch (error) {
			const aborted = controller.signal.aborted;
			const message = error instanceof Error ? error.message : String(error);
			await rm(join(this.updatesDirectory, `${asset.name}.part`), { force: true }).catch(() => {});
			this.setState(aborted ? { phase: "cancelled", assetName } : { phase: "failed", assetName, message });
			return this.state;
		} finally {
			if (this.controller === controller) this.controller = undefined;
		}
	}

	cancel(): void {
		if (this.state.phase === "downloading") this.controller?.abort();
	}

	/** Open the downloaded installer so the user can complete the platform-specific install. */
	async install(): Promise<void> {
		if (this.state.phase !== "completed") {
			throw new Error("请先下载更新安装包。");
		}
		const savedPath = this.state.savedPath;
		if (dirname(savedPath) !== this.updatesDirectory || /^[A-Za-z0-9._-]+$/u.test(basename(savedPath)) === false) {
			throw new Error("安装包路径无效。");
		}
		const fileStats = await stat(savedPath);
		if (!fileStats.isFile() || fileStats.size === 0) {
			throw new Error("安装包文件不可用，请重新下载。");
		}
		const errorMessage = await shell.openPath(savedPath);
		if (errorMessage) throw new Error(errorMessage);
	}
}
