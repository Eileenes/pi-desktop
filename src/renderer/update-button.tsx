import { memo } from "react";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

function UpgradeIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 16V8" strokeLinecap="round" />
			<path d="m8.5 11.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function DownloadedIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="m8 12.5 2.5 2.5 5.5-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function SpinnerIcon() {
	return (
		<svg
			className="animate-spin"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" className="opacity-25" />
			<path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
		</svg>
	);
}

const iconButtonClass =
	"relative inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border-0 bg-transparent p-0 text-[color:var(--ds-accent)] hover:bg-[var(--hover)] hover:text-[color:var(--ds-accent)]";

/**
 * Footer/settings: icon-only states. New version starts a download; a ready
 * install icon applies it and restarts. No extra labels or cancel control.
 */
export const UpdateButton = memo(function UpdateButton(_props: { variant: "footer" | "settings" }) {
	const { t } = useI18n();
	const update = useAppUpdate();
	const percent = updatePercent(update);
	const percentLabel = percent === undefined ? "…" : `${percent}%`;

	if (update.phase === "idle" || update.phase === "checking") return null;

	if (update.phase === "downloading") {
		return (
			<output
				className={iconButtonClass}
				aria-live="polite"
				title={t("updateDownloading", { percent: percentLabel })}
			>
				<SpinnerIcon />
			</output>
		);
	}

	if (update.phase === "installing") {
		return (
			<Button size="icon" className={iconButtonClass} disabled title={t("updateInstalling")}>
				<SpinnerIcon />
			</Button>
		);
	}

	if (update.phase === "ready") {
		return (
			<Button
				size="icon"
				className={iconButtonClass}
				title={t("updateInstallHint")}
				aria-label={t("update")}
				onClick={() => update.install()}
			>
				<DownloadedIcon />
			</Button>
		);
	}

	if (update.phase === "failed") {
		const detail =
			update.message === "no-installer" ? t("noInstallerForPlatform") : (update.message ?? t("updateRetry"));
		return (
			<Button
				size="icon"
				className={iconButtonClass}
				title={detail}
				aria-label={t("updateRetry")}
				onClick={() => update.download()}
			>
				<UpgradeIcon />
			</Button>
		);
	}

	if (!update.latestVersion) return null;
	const label = t("newVersionAvailable");
	return (
		<Button
			size="icon"
			aria-label={label}
			className={iconButtonClass}
			title={t("updateToVersion", { version: update.latestVersion })}
			onClick={() => update.download()}
		>
			<UpgradeIcon />
			<span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--ds-accent)]" aria-hidden="true" />
		</Button>
	);
});
