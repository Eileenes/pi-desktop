import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "../shared/contracts.ts";
import { checkForUpdates, openCustomCss, openExternalUrl, quitApp, setCloseQuits } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";
import { UpdateButton } from "./update-button.tsx";

interface AppSettingsModalProps {
	theme: "dark" | "light";
	accent: AppAccent;
	notifyOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light") => void;
	onChangeAccent: (accent: AppAccent) => void;
	onToggleNotify: () => void;
	onClose: () => void;
}

const PRODUCT_NAME = "Pi Desktop";
const REPOSITORY = "Eileenes/pi-desktop";
const RELEASES_URL = "https://github.com/Eileenes/pi-desktop/releases";

export const APP_ACCENTS = [
	"mono",
	"blue",
	"sky",
	"indigo",
	"violet",
	"cyan",
	"teal",
	"green",
	"amber",
	"orange",
	"rose",
] as const;
export type AppAccent = (typeof APP_ACCENTS)[number];

export function isAppAccent(value: string | null): value is AppAccent {
	return value !== null && (APP_ACCENTS as readonly string[]).includes(value);
}

const ACCENT_OPTIONS = [
	{ value: "mono", label: "accentMono" },
	{ value: "blue", label: "accentBlue" },
	{ value: "sky", label: "accentSky" },
	{ value: "indigo", label: "accentIndigo" },
	{ value: "violet", label: "accentViolet" },
	{ value: "cyan", label: "accentCyan" },
	{ value: "teal", label: "accentTeal" },
	{ value: "green", label: "accentGreen" },
	{ value: "amber", label: "accentAmber" },
	{ value: "orange", label: "accentOrange" },
	{ value: "rose", label: "accentRose" },
] as const;

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
	const [cssBusy, setCssBusy] = useState(false);
	const [cssError, setCssError] = useState<string>();

	const runUpdateCheck = useCallback(async () => {
		setCheckingUpdate(true);
		setUpdateError(undefined);
		try {
			const info = await checkForUpdates();
			setUpdate(info);
		} catch (error: unknown) {
			setUpdateError(error instanceof Error ? error.message : String(error));
		} finally {
			setCheckingUpdate(false);
		}
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

	const versionText = checkingUpdate ? t("checkingUpdate") : (update?.currentVersion ?? "…");
	const latestText = update?.latestVersion ? `latest ${update.latestVersion}` : undefined;
	const updateAvailable = update?.updateAvailable === true;
	/*
	 * One installer is enough — the native package for this platform (dmg on
	 * macOS, exe on Windows, AppImage on Linux) with the archive as a fallback —
	 * so the version line offers a single update button instead of a picker.
	 */
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
				{updateAvailable ? <UpdateButton variant="settings" /> : null}
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
						<span>
							{t("accentColor")}
							<em>{t(ACCENT_OPTIONS.find((option) => option.value === accent)?.label ?? "accentMono")}</em>
						</span>
						<div className="accent-swatch-row">
							{ACCENT_OPTIONS.map((option) => (
								<button
									className={`accent-swatch is-${option.value} ${accent === option.value ? "is-active" : ""}`}
									type="button"
									key={option.value}
									aria-label={t(option.label)}
									aria-pressed={accent === option.value}
									title={t(option.label)}
									onClick={() => onChangeAccent(option.value)}
								>
									<span className="accent-swatch-color" aria-hidden="true" />
								</button>
							))}
						</div>
						<small>{t("accentColorHint")}</small>
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
						<div className="toggle-row">
							<span>
								<strong>{t("appUpdate")}</strong>
								<small className="settings-version-line">
									<UpdateButton variant="settings" />
									{t("currentVersionLabel")} v{__APP_VERSION__}
								</small>
							</span>
						</div>
						<button className="outline-button settings-quit" type="button" onClick={() => void quitApp()}>
							{t("quitPi")}
						</button>
					</div>
				</section>
			</div>
		</Modal>
	);
});
