import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopUpdateDownloadState, DesktopUpdateInfo } from "../shared/contracts.ts";
import {
	cancelUpdateDownload,
	checkForUpdates,
	downloadUpdate,
	getUpdateDownloadState,
	installUpdate,
	onUpdateDownloadProgress,
	openCustomCss,
	openExternalUrl,
	quitApp,
	setCloseQuits,
} from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";

interface AppSettingsModalProps {
	theme: "dark" | "light";
	accent: AppAccent;
	notifyOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light") => void;
	onChangeAccent: (accent: AppAccent) => void;
	onToggleNotify: () => void;
	onClose: () => void;
}

const PRODUCT_NAME = "Pi Agent";
const REPOSITORY = "Eileenes/pi-desktop";
const RELEASES_URL = "https://github.com/Eileenes/pi-desktop/releases";

export const APP_ACCENTS = ["blue", "indigo", "cyan", "green", "amber", "rose", "mono"] as const;
export type AppAccent = (typeof APP_ACCENTS)[number];

export function isAppAccent(value: string | null): value is AppAccent {
	return value !== null && (APP_ACCENTS as readonly string[]).includes(value);
}

const ACCENT_OPTIONS = [
	{ value: "blue", label: "accentBlue" },
	{ value: "indigo", label: "accentIndigo" },
	{ value: "cyan", label: "accentCyan" },
	{ value: "green", label: "accentGreen" },
	{ value: "amber", label: "accentAmber" },
	{ value: "rose", label: "accentRose" },
	{ value: "mono", label: "accentMono" },
] as const;

function formatAssetSize(sizeBytes: number): string {
	if (sizeBytes <= 0) return "";
	if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`;
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button
			className={`choice-button ${active ? "is-active" : ""}`}
			type="button"
			aria-pressed={active}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

export const AppSettingsModal = memo(function AppSettingsModal({
	theme,
	accent,
	notifyOnComplete,
	onChangeTheme,
	onChangeAccent,
	onToggleNotify,
	onClose,
}: AppSettingsModalProps) {
	const { t, language, setLanguage } = useI18n();
	const [closeQuits, setCloseQuitsState] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-close-quits") === "on",
	);
	const [update, setUpdate] = useState<DesktopUpdateInfo>();
	const [checkingUpdate, setCheckingUpdate] = useState(true);
	const [updateError, setUpdateError] = useState<string>();
	const [downloadState, setDownloadState] = useState<DesktopUpdateDownloadState>({ phase: "idle" });
	const [selectedAsset, setSelectedAsset] = useState<string>();
	const [installError, setInstallError] = useState<string>();
	const [cssBusy, setCssBusy] = useState(false);
	const [cssError, setCssError] = useState<string>();

	const runUpdateCheck = useCallback(async () => {
		setCheckingUpdate(true);
		setUpdateError(undefined);
		try {
			const info = await checkForUpdates();
			setUpdate(info);
			setSelectedAsset((current) => current ?? info.assets?.[0]?.name);
		} catch (error: unknown) {
			setUpdateError(error instanceof Error ? error.message : String(error));
		} finally {
			setCheckingUpdate(false);
		}
	}, []);

	useEffect(() => {
		void getUpdateDownloadState()
			.then(setDownloadState)
			.catch(() => {});
		const unsubscribe = onUpdateDownloadProgress(setDownloadState);
		return unsubscribe;
	}, []);

	useEffect(() => {
		void runUpdateCheck();
	}, [runUpdateCheck]);

	function handleToggleCloseQuits(): void {
		const next = !closeQuits;
		setCloseQuitsState(next);
		localStorage.setItem("pi-desktop-close-quits", next ? "on" : "off");
		void setCloseQuits(next);
	}

	async function handleUpgrade(): Promise<void> {
		if (!selectedAsset) return;
		setInstallError(undefined);
		setDownloadState({ phase: "downloading", assetName: selectedAsset, receivedBytes: 0 });
		try {
			const state = await downloadUpdate(selectedAsset);
			setDownloadState(state);
			if (state.phase === "completed") await installUpdate();
		} catch (error: unknown) {
			setDownloadState({
				phase: "failed",
				assetName: selectedAsset,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async function handleInstall(): Promise<void> {
		setInstallError(undefined);
		try {
			await installUpdate();
		} catch (error: unknown) {
			setInstallError(error instanceof Error ? error.message : String(error));
		}
	}

	const versionText = checkingUpdate ? t("checkingUpdate") : (update?.currentVersion ?? "…");
	const latestText = update?.latestVersion ? `latest ${update.latestVersion}` : undefined;
	const updateAvailable = update?.updateAvailable === true;
	const assets = update?.assets ?? [];
	const downloading = downloadState.phase === "downloading";
	const downloadProgress =
		downloadState.phase === "downloading" && downloadState.totalBytes
			? Math.min(100, Math.round((downloadState.receivedBytes / downloadState.totalBytes) * 100))
			: undefined;

	return (
		<Modal title={PRODUCT_NAME} subtitle={t("localAiAgent")} className="app-settings-dialog" onClose={onClose}>
			<div className="settings-meta-row">
				<button
					className="settings-meta-chip"
					type="button"
					title={t("openRepoHint")}
					onClick={() => void openExternalUrl(`https://github.com/${REPOSITORY}`)}
				>
					<span>{t("repository")}</span>
					<span className="is-value">{REPOSITORY}</span>
					<span aria-hidden="true">↗</span>
				</button>
				<button
					className={`settings-meta-chip ${updateAvailable ? "is-emphasized" : ""}`}
					type="button"
					title={
						latestText
							? t("chipTitleLatest", { version: versionText, latest: latestText })
							: t("chipTitle", { version: versionText })
					}
					onClick={() => void openExternalUrl(update?.releaseUrl ?? RELEASES_URL)}
				>
					<span>
						{updateAvailable
							? `v${versionText} → v${update?.latestVersion}`
							: t("versionChip", { version: versionText })}
					</span>
					{updateAvailable ? <span aria-hidden="true">↗</span> : null}
				</button>
				{!updateAvailable && !checkingUpdate ? <span className="settings-update-ok">{t("upToDate")}</span> : null}
			</div>
			{updateError ? (
				<p className="settings-update-error" aria-live="polite">
					{updateError}
					<button className="settings-update-retry" type="button" onClick={() => void runUpdateCheck()}>
						{t("retry")}
					</button>
				</p>
			) : null}
			{updateAvailable ? (
				<div className="settings-update-panel" aria-live="polite">
					{assets.length > 0 ? (
						<div className="settings-update-asset-row">
							<label>
								<span>{t("installerPackage")}</span>
								<select
									value={selectedAsset ?? ""}
									disabled={downloading}
									onChange={(event) => setSelectedAsset(event.target.value)}
								>
									{!selectedAsset ? <option value="">{t("chooseInstaller")}</option> : null}
									{assets.map((asset) => (
										<option key={asset.name} value={asset.name}>
											{asset.name}
											{asset.sizeBytes ? ` (${formatAssetSize(asset.sizeBytes)})` : ""}
										</option>
									))}
								</select>
							</label>
							{downloadState.phase === "completed" && downloadState.assetName === selectedAsset ? (
								<button className="accent-button" type="button" onClick={() => void handleInstall()}>
									{t("openInstaller")}
								</button>
							) : downloading ? (
								<button
									className="outline-button"
									type="button"
									onClick={() => void cancelUpdateDownload().catch(() => {})}
								>
									{t("cancelDownload")}
								</button>
							) : (
								<button
									className="accent-button"
									type="button"
									disabled={!selectedAsset}
									onClick={() => void handleUpgrade()}
								>
									{downloadState.phase === "failed" ? t("retryDownload") : t("update")}
								</button>
							)}
						</div>
					) : (
						<p className="settings-update-hint">{t("noInstallerForPlatform")}</p>
					)}
					{downloading ? (
						<div className="settings-update-progress">
							<div className="settings-update-progress-track">
								<div className="settings-update-progress-fill" style={{ width: `${downloadProgress ?? 0}%` }} />
							</div>
							<span>
								{downloadProgress !== undefined
									? `${downloadProgress}%`
									: formatAssetSize(downloadState.receivedBytes)}
							</span>
						</div>
					) : null}
					{downloadState.phase === "completed" ? (
						<p className="settings-update-hint">{t("downloadCompleteHint", { name: downloadState.assetName })}</p>
					) : null}
					{downloadState.phase === "failed" ? (
						<p className="settings-update-error">{downloadState.message}</p>
					) : null}
					{installError ? <p className="settings-update-error">{installError}</p> : null}
				</div>
			) : null}
			<div className="app-settings-cards">
				<section className="app-settings-card">
					<strong>{t("language")}</strong>
					<p>{t("languageDescription")}</p>
					<div className="choice-row">
						<ChoiceButton active={language === "zh-CN"} onClick={() => setLanguage("zh-CN")}>
							简体中文
						</ChoiceButton>
						<ChoiceButton active={language === "en"} onClick={() => setLanguage("en")}>
							English
						</ChoiceButton>
					</div>
				</section>
				<section className="app-settings-card">
					<strong>{t("appearance")}</strong>
					<p>{t("appearanceDescription")}</p>
					<div className="choice-row">
						<ChoiceButton active={theme === "light"} onClick={() => onChangeTheme("light")}>
							{t("light")}
						</ChoiceButton>
						<ChoiceButton active={theme === "dark"} onClick={() => onChangeTheme("dark")}>
							{t("dark")}
						</ChoiceButton>
					</div>
					<div className="accent-setting">
						<span>{t("accentColor")}</span>
						<div className="accent-swatch-row">
							{ACCENT_OPTIONS.map((option) => (
								<button
									className={`accent-swatch is-${option.value} ${accent === option.value ? "is-active" : ""}`}
									type="button"
									key={option.value}
									aria-label={t(option.label)}
									aria-pressed={accent === option.value}
									onClick={() => onChangeAccent(option.value)}
								>
									<span className="accent-swatch-color" aria-hidden="true" />
									{t(option.label)}
								</button>
							))}
						</div>
					</div>
					<div className="custom-css-row">
						<span>
							<strong>{t("customCss")}</strong>
							<small>{t("customCssHint")}</small>
						</span>
						<button
							className="outline-button"
							type="button"
							disabled={cssBusy}
							onClick={() => {
								setCssBusy(true);
								setCssError(undefined);
								void openCustomCss()
									.catch((error: unknown) =>
										setCssError(error instanceof Error ? error.message : String(error)),
									)
									.finally(() => setCssBusy(false));
							}}
						>
							{cssBusy ? t("opening") : t("openCustomCss")}
						</button>
					</div>
					{cssError ? <p className="sidebar-error">{cssError}</p> : null}
				</section>
				<section className="app-settings-card">
					<strong>{t("desktopApp")}</strong>
					<p>{t("desktopAppDescription")}</p>
					<div className="app-settings-options">
						<label className="toggle-row">
							<span>
								<strong>{t("notifyOnComplete")}</strong>
								<small>{t("notifyHint")}</small>
							</span>
							<input type="checkbox" checked={notifyOnComplete} onChange={onToggleNotify} />
						</label>
						<label className="toggle-row">
							<span>
								<strong>{t("closeQuits")}</strong>
								<small>{t("closeQuitsHint")}</small>
							</span>
							<input type="checkbox" checked={closeQuits} onChange={handleToggleCloseQuits} />
						</label>
						<button className="outline-button settings-quit" type="button" onClick={() => void quitApp()}>
							{t("quitPi")}
						</button>
					</div>
				</section>
			</div>
		</Modal>
	);
});
