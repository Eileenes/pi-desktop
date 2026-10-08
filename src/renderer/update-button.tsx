import { type CSSProperties, memo } from "react";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { updatePercent, useAppUpdate } from "./use-app-update.ts";

function updateStatusClass(
	phase: "available" | "downloading" | "installing" | "ready" | "failed",
	variant: "footer" | "settings",
): string {
	const size =
		variant === "settings" ? "h-8 px-3 text-[length:var(--text-sm)]" : "h-7 px-2.5 text-[length:var(--text-xs)]";
	const base = `relative inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full border-[0.5px] font-medium leading-[18px] whitespace-nowrap ${size}`;
	if (phase === "available") {
		return `${base} border-[color-mix(in_oklab,var(--ds-accent)_45%,transparent)] bg-[color-mix(in_oklab,var(--ds-accent)_14%,transparent)] text-[color:var(--ds-text-primary)]`;
	}
	if (phase === "downloading") {
		return `${base} cursor-default border-[color-mix(in_oklab,var(--ds-accent)_35%,transparent)] bg-[var(--ds-bg-hover)] text-[color:var(--ds-text-primary)]`;
	}
	if (phase === "installing") {
		return `${base} cursor-progress border-[var(--ds-border-default)] bg-[var(--ds-bg-hover)] text-[color:var(--ds-text-primary)]`;
	}
	if (phase === "ready") {
		return `${base} border-transparent bg-[var(--ds-accent)] text-[color:var(--ds-on-accent)]`;
	}
	return `${base} border-[color-mix(in_oklab,var(--ds-error)_40%,transparent)] bg-[color-mix(in_oklab,var(--ds-error)_12%,transparent)] text-[color:var(--ds-error)]`;
}

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
				className={updateStatusClass("downloading", variant)}
				style={{ "--update-progress": `${percent ?? 8}%` } as CSSProperties}
			>
				<span
					className="pointer-events-none absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--ds-accent)_28%,transparent)]"
					style={{ width: "var(--update-progress, 0%)" }}
					aria-hidden="true"
				/>
				<span className="relative z-[1]">
					<DownloadIcon />
				</span>
				<span className="relative z-[1]">{detailed ? label : percentLabel}</span>
				<Button
					size="sm"
					className="relative z-[1] border-0 border-l-[0.5px] border-[var(--ds-border-default)] bg-transparent py-0 pr-0 pl-1.5 font-[inherit] text-[color:var(--ds-text-secondary)]"
					onClick={() => update.cancel()}
				>
					{t("cancelDownload")}
				</Button>
			</output>
		);
	}

	if (update.phase === "installing") {
		return (
			<Button className={updateStatusClass("installing", variant)} disabled>
				{t("updateInstalling")}
			</Button>
		);
	}

	if (update.phase === "ready") {
		const opened = update.message === "opened";
		return (
			<Button
				variant="primary"
				className={updateStatusClass("ready", variant)}
				title={opened ? t("updateOpenedHint") : t("updateInstallHint")}
				onClick={() => update.install()}
			>
				{opened ? t("updateOpened") : t("updateInstallNow")}
			</Button>
		);
	}

	if (update.phase === "failed") {
		const detail =
			update.message === "no-installer" ? t("noInstallerForPlatform") : (update.message ?? t("updateRetry"));
		return (
			<Button className={updateStatusClass("failed", variant)} title={detail} onClick={() => update.download()}>
				{detailed ? detail : t("updateRetry")}
			</Button>
		);
	}

	if (!update.latestVersion) return null;
	const label = t("updateToVersion", { version: update.latestVersion });
	return (
		<Button
			variant="primary"
			className={updateStatusClass("available", variant)}
			title={label}
			onClick={() => update.download()}
		>
			<DownloadIcon />
			<span>{detailed ? label : t("update")}</span>
		</Button>
	);
});
