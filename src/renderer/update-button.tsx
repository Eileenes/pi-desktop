import { memo } from "react";
import { useI18n } from "./i18n.ts";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

/**
 * The update affordance, shared by the footer and the settings dialog so both
 * show the same state: nothing while up to date, the target version when one is
 * available, live progress while downloading, then the install handoff.
 */
export const UpdateButton = memo(function UpdateButton({ variant }: { variant: "footer" | "settings" }) {
	const { t } = useI18n();
	const update = useAppUpdate();
	const percent = updatePercent(update);

	if (update.phase === "idle" || update.phase === "checking") return null;

	const className = variant === "footer" ? "footer-update-button" : "outline-button settings-update-button";

	if (update.phase === "downloading") {
		return (
			<button className={className} type="button" disabled>
				{t("updateDownloading", { percent: percent === undefined ? "…" : String(percent) })}
			</button>
		);
	}
	if (update.phase === "ready") {
		return (
			<button className={className} type="button" title={t("updateInstallHint")} onClick={() => update.install()}>
				{t("updateInstallNow")}
			</button>
		);
	}
	if (update.phase === "failed") {
		// Downloads can fail for real reasons (disk, network), so this one keeps a
		// retry — with the reason in the tooltip rather than spelled out in the row.
		return (
			<button
				className={className}
				type="button"
				title={update.message ?? t("updateRetry")}
				onClick={() => update.download()}
			>
				{t("updateRetry")}
			</button>
		);
	}
	if (!update.latestVersion) return null;
	return (
		<button
			className={className}
			type="button"
			title={t("updateAvailableDetail", {
				current: update.currentVersion ?? "",
				latest: update.latestVersion,
			})}
			onClick={() => update.download()}
		>
			{t("updateToVersion", { version: update.latestVersion })}
		</button>
	);
});
