import { memo } from "react";
import { useI18n } from "./i18n.ts";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

function DownloadIcon() {
	return (
		<svg
			width="13"
			height="13"
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
 * A small download icon beside the version. Clicking starts the download; while
 * it runs the same icon shows progress and cannot be clicked again.
 */
export const UpdateButton = memo(function UpdateButton({ variant }: { variant: "footer" | "settings" }) {
	const { t } = useI18n();
	const update = useAppUpdate();
	const percent = updatePercent(update);
	const className = variant === "footer" ? "footer-update-button" : "settings-update-button";

	if (update.phase === "idle" || update.phase === "checking") return null;

	if (update.phase === "downloading") {
		const label =
			percent === undefined
				? t("updateDownloading", { percent: "…" })
				: t("updateDownloading", { percent: String(percent) });
		return (
			<button className={`${className} is-busy`} type="button" disabled aria-label={label} title={label}>
				<DownloadIcon />
			</button>
		);
	}

	if (update.phase === "ready") {
		return (
			<button
				className={className}
				type="button"
				aria-label={t("updateInstallNow")}
				title={t("updateInstallHint")}
				onClick={() => update.install()}
			>
				<DownloadIcon />
			</button>
		);
	}

	if (update.phase === "failed") {
		return (
			<button
				className={className}
				type="button"
				aria-label={t("updateRetry")}
				title={update.message ?? t("updateRetry")}
				onClick={() => update.download()}
			>
				<DownloadIcon />
			</button>
		);
	}

	if (!update.latestVersion) return null;
	const label = t("updateToVersion", { version: update.latestVersion });
	return (
		<button className={className} type="button" aria-label={label} title={label} onClick={() => update.download()}>
			<DownloadIcon />
		</button>
	);
});
