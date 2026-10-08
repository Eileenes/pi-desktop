import { type CSSProperties, memo, useCallback, useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "../shared/contracts.ts";
import { checkForUpdates, openCustomCss, openExternalUrl, quitApp, setCloseQuits } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";
import { Switch } from "./ui/switch.tsx";
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
	/* Version chip plus the shared update control (icon / percent / install). */
	return (
		<Modal title={PRODUCT_NAME} subtitle={t("localAiAgent")} className="w-[min(620px,100%)]" onClose={onClose}>
			<div className="mb-3.5 flex flex-wrap items-center gap-2">
				<Button
					variant="bare"
					className="inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[color:var(--muted)]"
					title={t("openRepoHint")}
					onClick={() => void openExternalUrl(`https://github.com/${REPOSITORY}`)}
				>
					<span className="font-medium opacity-70">{t("repository")}</span>
					<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{REPOSITORY}</span>
					<span aria-hidden="true">↗</span>
				</Button>
				<Button
					variant="bare"
					className={`inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-xs)] border px-2.5 py-1.5 ${updateAvailable ? "border-[var(--accent-strong)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] font-bold text-[color:var(--accent-strong)]" : "border-[var(--border-subtle)] text-[color:var(--muted)]"}`}
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
				</Button>
				{updateAvailable ? <UpdateButton variant="settings" /> : null}
				{!updateAvailable && !checkingUpdate ? (
					<span className="text-[length:var(--text-sm)] text-[color:var(--success)]">{t("upToDate")}</span>
				) : null}
			</div>
			{updateError ? (
				<p
					className="-mt-1.5 mb-3 flex items-center justify-between gap-2 rounded-[var(--radius-s)] border border-[var(--danger-border)] px-2.5 py-1.5 text-[color:var(--error-text)]"
					aria-live="polite"
				>
					{updateError}
					<Button size="sm" variant="outline" onClick={() => void runUpdateCheck()}>
						{t("retry")}
					</Button>
				</p>
			) : null}
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
							<Segment active={theme === "light"} onClick={() => onChangeTheme("light")}>
								{t("light")}
							</Segment>
							<Segment active={theme === "dark"} onClick={() => onChangeTheme("dark")}>
								{t("dark")}
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
								<small className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[color:var(--muted)]">
									<UpdateButton variant="settings" />
									{t("currentVersionLabel")} v{__APP_VERSION__}
								</small>
							</span>
						</div>
						<Button variant="outline" className="justify-self-start" type="button" onClick={() => void quitApp()}>
							{t("quitPi")}
						</Button>
					</div>
				</section>
			</div>
		</Modal>
	);
});
