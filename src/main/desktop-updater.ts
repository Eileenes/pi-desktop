import { type AppUpdater, CancellationToken } from "electron-updater";
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

const ELECTRON_UPDATE_ASSET = "app-update";

/**
 * Packaged updates go through electron-updater so the downloaded zip/nsis
 * can be applied with quitAndInstall instead of opening a dmg/exe.
 */
export async function downloadElectronUpdate(
	autoUpdater: AppUpdater,
	onState: (state: DesktopUpdateDownloadState) => void,
	holdToken: (token: CancellationToken | undefined) => void,
): Promise<DesktopUpdateDownloadState> {
	const token = new CancellationToken();
	holdToken(token);
	const assetName = ELECTRON_UPDATE_ASSET;
	onState({ phase: "downloading", assetName, receivedBytes: 0 });
	let lastEventAt = 0;
	const onProgress = (info: { transferred: number; total: number }): void => {
		const now = Date.now();
		if (now - lastEventAt < PROGRESS_EVENT_THROTTLE_MS && info.total > 0 && info.transferred < info.total) {
			return;
		}
		lastEventAt = now;
		onState({
			phase: "downloading",
			assetName,
			receivedBytes: info.transferred,
			...(info.total > 0 ? { totalBytes: info.total } : {}),
		});
	};
	autoUpdater.on("download-progress", onProgress);
	try {
		const check = await autoUpdater.checkForUpdates();
		if (token.cancelled) {
			const cancelled = { phase: "cancelled" as const, assetName };
			onState(cancelled);
			return cancelled;
		}
		if (!check?.isUpdateAvailable) {
			throw new Error("没有可用更新。");
		}
		const files = await autoUpdater.downloadUpdate(token);
		const completed = { phase: "completed" as const, assetName, savedPath: files[0] ?? "" };
		onState(completed);
		return completed;
	} catch (error) {
		if (token.cancelled) {
			const cancelled = { phase: "cancelled" as const, assetName };
			onState(cancelled);
			return cancelled;
		}
		const message = error instanceof Error ? error.message : String(error);
		const failed = { phase: "failed" as const, assetName, message };
		onState(failed);
		return failed;
	} finally {
		autoUpdater.off("download-progress", onProgress);
		holdToken(undefined);
	}
}
