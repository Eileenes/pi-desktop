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

function statusClass(kind: "downloading" | "installing" | "ready" | "failed", variant: "footer" | "settings"): string {
	const size =
		variant === "settings" ? "h-8 px-3 text-[length:var(--text-sm)]" : "h-7 px-2.5 text-[length:var(--text-xs)]";
	const base = `inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border-[0.5px] font-medium leading-[18px] whitespace-nowrap ${size}`;
	if (kind === "downloading") {
		return `${base} cursor-default border-[color-mix(in_oklab,var(--ds-accent)_35%,transparent)] bg-[var(--ds-bg-hover)] text-[color:var(--ds-text-primary)]`;
	}
	if (kind === "installing") {
		return `${base} cursor-progress border-[var(--ds-border-default)] bg-[var(--ds-bg-hover)] text-[color:var(--ds-text-primary)]`;
	}
	if (kind === "ready") {
		return `${base} border-transparent bg-[var(--ds-accent)] text-[color:var(--ds-on-accent)]`;
	}
	return `${base} border-[color-mix(in_oklab,var(--ds-error)_40%,transparent)] bg-[color-mix(in_oklab,var(--ds-error)_12%,transparent)] text-[color:var(--ds-error)]`;
}

/**
 * Footer: a new-version icon, then download percent, then an Update button.
 * Settings uses the same states with slightly more label room.
 */
export const UpdateButton = memo(function UpdateButton({ variant }: { variant: "footer" | "settings" }) {
	const { t } = useI18n();
	const update = useAppUpdate();
	const percent = updatePercent(update);
	const percentLabel = percent === undefined ? "…" : `${percent}%`;

	if (update.phase === "idle" || update.phase === "checking") return null;

	if (update.phase === "downloading") {
		return (
			<output className={statusClass("downloading", variant)} aria-live="polite">
				{t("updateDownloading", { percent: percentLabel })}
			</output>
		);
	}

	if (update.phase === "installing") {
		return (
			<Button className={statusClass("installing", variant)} disabled>
				{t("updateInstalling")}
			</Button>
		);
	}

	if (update.phase === "ready") {
		return (
			<Button
				variant="primary"
				className={statusClass("ready", variant)}
				title={t("updateInstallHint")}
				onClick={() => update.install()}
			>
				{t("update")}
			</Button>
		);
	}

	if (update.phase === "failed") {
		const detail =
			update.message === "no-installer" ? t("noInstallerForPlatform") : (update.message ?? t("updateRetry"));
		return (
			<Button className={statusClass("failed", variant)} title={detail} onClick={() => update.download()}>
				{variant === "settings" ? detail : t("updateRetry")}
			</Button>
		);
	}

	if (!update.latestVersion) return null;
	const label = t("newVersionAvailable");
	return (
		<Button
			size="icon"
			aria-label={label}
			className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border-0 bg-transparent p-0 text-[color:var(--ds-accent)] hover:bg-[var(--hover)] hover:text-[color:var(--ds-accent)]"
			title={update.latestVersion ? t("updateToVersion", { version: update.latestVersion }) : label}
			onClick={() => update.download()}
		>
			<UpgradeIcon />
			<span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--ds-accent)]" aria-hidden="true" />
		</Button>
	);
});
