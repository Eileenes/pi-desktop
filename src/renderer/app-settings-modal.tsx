import { type CSSProperties, memo, useState } from "react";
import { openCustomCss, openExternalUrl, setCloseQuits } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";
import { Switch } from "./ui/switch.tsx";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

interface AppSettingsModalProps {
	theme: "dark" | "light";
	themeFollowsSystem: boolean;
	accent: AppAccent;
	notifyOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light") => void;
	onFollowSystem: () => void;
	onChangeAccent: (accent: AppAccent) => void;
	onToggleNotify: () => void;
	onClose: () => void;
}

function GitHubMark() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.7 7.7 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
		</svg>
	);
}

function VersionMark() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
			<circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
		</svg>
	);
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

const ACCENT_SWATCH_DARK: Record<AppAccent, string> = {
	mono: "#fff",
	blue: "#7aaaff",
	sky: "#38bdf8",
	indigo: "#818cf8",
	violet: "#a78bfa",
	cyan: "#22d3ee",
	teal: "#2dd4bf",
	green: "#4ade80",
	amber: "#fbbf24",
	orange: "#fb923c",
	rose: "#fb7185",
};

const ACCENT_SWATCH_LIGHT: Record<AppAccent, string> = {
	mono: "#1a1c1f",
	blue: "#4176e6",
	sky: "#0284c7",
	indigo: "#4f46e5",
	violet: "#6d28d9",
	cyan: "#0e7490",
	teal: "#0f766e",
	green: "#15803d",
	amber: "#b45309",
	orange: "#c2410c",
	rose: "#be123c",
};

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

export const AppSettingsModal = memo(function AppSettingsModal({
	theme,
	themeFollowsSystem,
	accent,
	notifyOnComplete,
	onChangeTheme,
	onFollowSystem,
	onChangeAccent,
	onToggleNotify,
	onClose,
}: AppSettingsModalProps) {
	const { t, language, setLanguage } = useI18n();
	const [closeQuits, setCloseQuitsState] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-close-quits") === "on",
	);
	const [cssBusy, setCssBusy] = useState(false);
	const [cssError, setCssError] = useState<string>();
	const [hasCheckedUpdate, setHasCheckedUpdate] = useState(false);
	const appUpdate = useAppUpdate();
	const downloadPercent = updatePercent(appUpdate);

	function handleToggleCloseQuits(): void {
		const next = !closeQuits;
		setCloseQuitsState(next);
		localStorage.setItem("pi-desktop-close-quits", next ? "on" : "off");
		void setCloseQuits(next);
	}

	const versionLabel = `v${__APP_VERSION__}`;
	const updateActionButton = "min-h-8 shrink-0 px-3 text-[length:var(--text-sm)] whitespace-nowrap";
	/* Repo and version sit in the title row; update check lives under Desktop app. */
	return (
		<Modal
			title={PRODUCT_NAME}
			className="w-[min(620px,100%)]"
			onClose={onClose}
			headerTrailing={
				<>
					<Button
						variant="bare"
						className="inline-flex size-8 items-center justify-center rounded-[var(--radius-xs)] border-0 bg-transparent text-[color:var(--text)] hover:bg-[var(--hover)]"
						title={t("openRepoHint")}
						aria-label={t("openRepoHint")}
						onClick={() => void openExternalUrl(`https://github.com/${REPOSITORY}`)}
					>
						<GitHubMark />
					</Button>
					<Button
						variant="bare"
						className="inline-flex h-7 items-center justify-center gap-1 rounded-[var(--radius-xs)] border-0 bg-transparent px-1.5 text-[color:var(--muted)] hover:bg-[var(--hover)]"
						title={t("chipTitle", { version: versionLabel })}
						aria-label={t("chipTitle", { version: versionLabel })}
						onClick={() => void openExternalUrl(RELEASES_URL)}
					>
						<VersionMark />
						<span className="font-[family-name:var(--font-mono)] text-[9px] leading-none">{versionLabel}</span>
					</Button>
				</>
			}
		>
			<div className="grid gap-3">
				<section className="rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
					<strong className="text-[length:var(--text-md)] font-semibold">{t("language")}</strong>
					<p className="mt-1 mb-0 text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
						{t("languageDescription")}
					</p>
					<div className="mt-2.5">
						<Segmented variant="tiles" aria-label={t("language")}>
							<Segment active={language === "zh-CN"} onClick={() => setLanguage("zh-CN")}>
								简体中文
							</Segment>
							<Segment active={language === "en"} onClick={() => setLanguage("en")}>
								English
							</Segment>
						</Segmented>
					</div>
				</section>
				<section className="rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
					<strong className="text-[length:var(--text-md)] font-semibold">{t("appearance")}</strong>
					<p className="mt-1 mb-0 text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
						{t("appearanceDescription")}
					</p>
					<div className="mt-2.5">
						<Segmented variant="tiles" aria-label={t("appearance")}>
							<Segment active={!themeFollowsSystem && theme === "light"} onClick={() => onChangeTheme("light")}>
								{t("light")}
							</Segment>
							<Segment active={!themeFollowsSystem && theme === "dark"} onClick={() => onChangeTheme("dark")}>
								{t("dark")}
							</Segment>
							<Segment active={themeFollowsSystem} className="ui-segment-static" onClick={onFollowSystem}>
								{t("followSystem")}
							</Segment>
						</Segmented>
					</div>
					<div className="mt-3 grid gap-1.5">
						<span className="flex items-baseline justify-between gap-2 text-[length:var(--text-xs)] font-semibold text-[color:var(--muted)]">
							{t("accentColor")}
							<em className="not-italic font-medium text-[color:var(--text-primary)]">
								{t(ACCENT_OPTIONS.find((option) => option.value === accent)?.label ?? "accentMono")}
							</em>
						</span>
						<div className="flex flex-wrap gap-2">
							{ACCENT_OPTIONS.map((option) => (
								<Button
									variant="bare"
									className={`inline-flex size-7 items-center justify-center rounded-full border-2 p-0 ${accent === option.value ? "border-[var(--swatch-color)]" : "border-transparent"}`}
									key={option.value}
									aria-label={t(option.label)}
									aria-pressed={accent === option.value}
									title={t(option.label)}
									style={
										{
											"--swatch-color": (theme === "light" ? ACCENT_SWATCH_LIGHT : ACCENT_SWATCH_DARK)[
												option.value
											],
										} as CSSProperties
									}
									onClick={() => onChangeAccent(option.value)}
								>
									<span
										className="size-[18px] shrink-0 rounded-full bg-[var(--swatch-color)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,var(--ds-text-primary)_18%,transparent)]"
										aria-hidden="true"
									/>
								</Button>
							))}
						</div>
						<small className="text-[length:var(--text-xs)] leading-normal text-[color:var(--ds-text-muted)]">
							{t("accentColorHint")}
						</small>
					</div>
					<div className="mt-3 flex items-center justify-between gap-3">
						<span className="grid gap-0.5">
							<strong className="text-[length:var(--text-sm)]">{t("customCss")}</strong>
							<small className="text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
								{t("customCssHint")}
							</small>
						</span>
						<Button
							variant="outline"
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
						</Button>
					</div>
					{cssError ? (
						<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">
							{cssError}
						</p>
					) : null}
				</section>
				<section className="rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
					<strong className="text-[length:var(--text-md)] font-semibold">{t("desktopApp")}</strong>
					<p className="mt-1 mb-0 text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
						{t("desktopAppDescription")}
					</p>
					<div className="mt-3 grid gap-3">
						<div className="flex items-center justify-between gap-3">
							<span className="grid gap-0.5">
								<strong className="text-[length:var(--text-sm)]">{t("notifyOnComplete")}</strong>
								<small className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
									{t("notifyHint")}
								</small>
							</span>
							<Switch checked={notifyOnComplete} onCheckedChange={onToggleNotify} />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="grid gap-0.5">
								<strong className="text-[length:var(--text-sm)]">{t("closeQuits")}</strong>
								<small className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
									{t("closeQuitsHint")}
								</small>
							</span>
							<Switch checked={closeQuits} onCheckedChange={handleToggleCloseQuits} />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="grid gap-0.5">
								<strong className="text-[length:var(--text-sm)]">{t("appUpdate")}</strong>
								<small className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
									{t("currentVersionLabel")} {versionLabel}
								</small>
							</span>
							{appUpdate.phase === "checking" && hasCheckedUpdate ? (
								<Button size="sm" variant="outline" className={updateActionButton} disabled>
									{t("checkingUpdate")}
								</Button>
							) : appUpdate.phase === "downloading" ? (
								<Button size="sm" variant="outline" className={updateActionButton} disabled>
									{t("updateDownloading", {
										percent: downloadPercent === undefined ? "…" : `${downloadPercent}%`,
									})}
								</Button>
							) : appUpdate.phase === "installing" ? (
								<Button size="sm" variant="outline" className={updateActionButton} disabled>
									{t("updateInstalling")}
								</Button>
							) : appUpdate.phase === "ready" ? (
								<Button
									size="sm"
									variant="outline"
									className={updateActionButton}
									onClick={() => appUpdate.install()}
								>
									{t("openInstaller")}
								</Button>
							) : appUpdate.phase === "failed" ? (
								<Button
									size="sm"
									variant="outline"
									className={updateActionButton}
									onClick={() => appUpdate.download()}
								>
									{t("updateRetry")}
								</Button>
							) : hasCheckedUpdate && appUpdate.phase === "available" ? (
								<Button
									size="sm"
									variant="outline"
									className={updateActionButton}
									onClick={() => appUpdate.download()}
								>
									{t("downloadNewVersion")}
								</Button>
							) : hasCheckedUpdate && appUpdate.phase === "idle" ? (
								<span className="text-[length:var(--text-sm)] text-[color:var(--success)]">
									{t("upToDate")}
								</span>
							) : (
								<Button
									size="sm"
									variant="outline"
									className={updateActionButton}
									onClick={() => {
										setHasCheckedUpdate(true);
										appUpdate.check();
									}}
								>
									{t("checkForUpdatesAction")}
								</Button>
							)}
						</div>
					</div>
				</section>
			</div>
		</Modal>
	);
});
