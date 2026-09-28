import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { DesktopUpdateDownloadState, DesktopUpdateInfo } from "../shared/contracts.ts";
import {
	cancelUpdateDownload,
	checkForUpdates,
	downloadUpdate,
	getUpdateDownloadState,
	installUpdate,
	onUpdateDownloadProgress,
} from "./desktop-store.ts";

export type AppUpdatePhase = "idle" | "checking" | "available" | "downloading" | "installing" | "ready" | "failed";

export interface AppUpdateState {
	phase: AppUpdatePhase;
	currentVersion?: string;
	latestVersion?: string;
	receivedBytes: number;
	totalBytes?: number;
	message?: string;
	check: () => void;
	download: () => void;
	cancel: () => void;
	install: () => void;
}

interface Snapshot {
	phase: AppUpdatePhase;
	info?: DesktopUpdateInfo;
	download?: DesktopUpdateDownloadState;
	message?: string;
}

/*
 * One update state for the whole renderer. Both the footer button and the
 * settings row read it, so a check or a download started in either place is
 * reflected in the other, and the app asks the update service once.
 */
let snapshot: Snapshot = { phase: "idle" };
const listeners = new Set<() => void>();
let started = false;

function publish(next: Partial<Snapshot>): void {
	snapshot = { ...snapshot, ...next };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function readSnapshot(): Snapshot {
	return snapshot;
}

const INSTALLER_ASSET = /\.(dmg|exe|appimage)$/iu;

/** Native installer first; a zip is only the fallback. */
function preferredAsset(info: DesktopUpdateInfo | undefined): string | undefined {
	const assets = info?.assets ?? [];
	return (
		assets.find((asset) => INSTALLER_ASSET.test(asset.name) && asset.sizeBytes > 0) ??
		assets.find((asset) => asset.sizeBytes > 0)
	)?.name;
}

function applyDownloadState(state: DesktopUpdateDownloadState): void {
	switch (state.phase) {
		case "downloading":
			publish({ phase: "downloading", download: state });
			return;
		case "completed":
			if (snapshot.phase === "installing") return;
			publish({ phase: "installing", download: state, message: undefined });
			void installUpdate().catch((error: unknown) =>
				publish({ phase: "failed", message: error instanceof Error ? error.message : String(error) }),
			);
			return;
		case "failed":
			publish({ phase: "failed", download: state, message: state.message });
			return;
		default:
			publish({ phase: "available", download: state });
	}
}

async function runCheck(): Promise<void> {
	publish({ phase: "checking", message: undefined });
	try {
		const info = await checkForUpdates();
		publish({
			info,
			phase: info.updateAvailable && info.latestVersion ? "available" : "idle",
		});
	} catch (error) {
		// A failed check is not user-actionable — the usual cause is the update
		// service rate-limiting an unauthenticated request — so it only reaches the
		// console, and the affordance stays hidden.
		console.warn("Update check failed", error);
		publish({ phase: "idle", message: undefined });
	}
}

/** Starts the shared state once: an unfinished download is picked up again. */
function ensureStarted(): void {
	if (started) return;
	started = true;
	void getUpdateDownloadState()
		.then((state) => {
			if (state.phase === "completed" || state.phase === "downloading") applyDownloadState(state);
			return runCheck();
		})
		.catch(() => runCheck());
	onUpdateDownloadProgress(applyDownloadState);
}

export function useAppUpdate(): AppUpdateState {
	const current = useSyncExternalStore(subscribe, readSnapshot);
	useEffect(ensureStarted, []);

	const check = useCallback(() => void runCheck(), []);
	const download = useCallback(() => {
		const assetName = preferredAsset(snapshot.info);
		if (!assetName) {
			publish({ phase: "failed", message: "no-installer" });
			return;
		}
		publish({
			phase: "downloading",
			message: undefined,
			download: { phase: "downloading", assetName, receivedBytes: 0 },
		});
		void downloadUpdate(assetName).then(applyDownloadState, (error: unknown) =>
			publish({ phase: "failed", message: error instanceof Error ? error.message : String(error) }),
		);
	}, []);
	const cancel = useCallback(() => {
		void cancelUpdateDownload().catch((error: unknown) =>
			publish({ phase: "failed", message: error instanceof Error ? error.message : String(error) }),
		);
	}, []);
	const install = useCallback(() => {
		publish({ phase: "installing", message: undefined });
		void installUpdate()
			.then(() => publish({ phase: "ready", message: "opened" }))
			.catch((error: unknown) =>
				publish({ phase: "failed", message: error instanceof Error ? error.message : String(error) }),
			);
	}, []);

	return {
		phase: current.phase,
		...(current.info?.currentVersion ? { currentVersion: current.info.currentVersion } : {}),
		...(current.info?.latestVersion ? { latestVersion: current.info.latestVersion } : {}),
		receivedBytes: current.download?.phase === "downloading" ? current.download.receivedBytes : 0,
		...(current.download?.phase === "downloading" && current.download.totalBytes
			? { totalBytes: current.download.totalBytes }
			: {}),
		...(current.message ? { message: current.message } : {}),
		check,
		download,
		cancel,
		install,
	};
}

/** Whole-percent progress, or undefined while the total size is unknown. */
export function updatePercent(state: AppUpdateState): number | undefined {
	if (state.phase !== "downloading" || !state.totalBytes) return undefined;
	return Math.min(100, Math.round((state.receivedBytes / state.totalBytes) * 100));
}
