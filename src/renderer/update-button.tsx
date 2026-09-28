import { type CSSProperties, memo } from "react";
import { useI18n } from "./i18n.ts";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

function DownloadIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<path d="M12 4v11" strokeLinecap="round" />
			<path d="m7 11 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M5 20h14" strokeLinecap="round" />
		</svg>
	);
}

/**
 * Visible update status. The footer used to be an 18px icon whose only progress
 * lived in a tooltip, so a click looked like nothing was downloading or installing.
 */
export const UpdateButton = memo(function UpdateButton({ variant }: { variant: "footer" | "settings" }) {
	const { t } = useI18n();
	const update = useAppUpdate();
	const percent = updatePercent(update);
	const detailed = variant === "settings";
	const percentLabel = percent === undefined ? "…" : `${percent}%`;

	if (update.phase === "idle" || update.phase === "checking") return null;

	if (update.phase === "downloading") {
		const label = t("updateDownloading", { percent: percentLabel });
		return (
			<output
				className={`update-status is-downloading is-${variant}`}
				style={{ "--update-progress": `${percent ?? 8}%` } as CSSProperties}
			>
				<span className="update-status-fill" aria-hidden="true" />
				<DownloadIcon />
				<span>{detailed ? label : percentLabel}</span>
				<button className="update-status-cancel" type="button" onClick={() => update.cancel()}>
					{t("cancelDownload")}
				</button>
			</output>
		);
	}

	if (update.phase === "installing") {
		return (
			<button className={`update-status is-installing is-${variant}`} type="button" disabled>
				{t("updateInstalling")}
			</button>
		);
	}

	if (update.phase === "ready") {
		const opened = update.message === "opened";
		return (
			<button
				className={`update-status is-ready is-${variant}`}
				type="button"
				title={opened ? t("updateOpenedHint") : t("updateInstallHint")}
				onClick={() => update.install()}
			>
				{opened ? t("updateOpened") : t("updateInstallNow")}
			</button>
		);
	}

	if (update.phase === "failed") {
		const detail =
			update.message === "no-installer" ? t("noInstallerForPlatform") : (update.message ?? t("updateRetry"));
		return (
			<button
				className={`update-status is-failed is-${variant}`}
				type="button"
				title={detail}
				onClick={() => update.download()}
			>
				{detailed ? detail : t("updateRetry")}
			</button>
		);
	}

	if (!update.latestVersion) return null;
	const label = t("updateToVersion", { version: update.latestVersion });
	return (
		<button
			className={`update-status is-available is-${variant}`}
			type="button"
			title={label}
			onClick={() => update.download()}
		>
			<DownloadIcon />
			<span>{detailed ? label : t("update")}</span>
		</button>
	);
});
