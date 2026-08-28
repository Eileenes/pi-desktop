import { memo } from "react";
import { useI18n } from "./i18n.ts";

interface ProjectTrustDialogProps {
	workspacePath: string;
	busy: boolean;
	error?: string;
	onCancel: () => void;
	onConfirm: () => void;
}

export const ProjectTrustDialog = memo(function ProjectTrustDialog({
	workspacePath,
	busy,
	error,
	onCancel,
	onConfirm,
}: ProjectTrustDialogProps) {
	const { t } = useI18n();
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop pointer handling does not expose an interactive control
		<div
			className="trust-dialog-backdrop"
			role="presentation"
			onMouseDown={(event) => {
				if (!busy && event.target === event.currentTarget) onCancel();
			}}
		>
			<div className="trust-dialog" role="dialog" aria-modal="true" aria-labelledby="project-trust-title">
				<div className="trust-dialog-body">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--warning, #b87503)"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
						<path d="M12 8v4" />
						<path d="M12 16h.01" />
					</svg>
					<div>
						<h2 id="project-trust-title">{t("trustDialogTitle")}</h2>
						<p>{t("trustDescription")}</p>
						<code>{workspacePath}</code>
						{error ? <p className="trust-dialog-error">{error}</p> : null}
					</div>
				</div>
				<div className="trust-dialog-actions">
					<button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>
						{t("cancel")}
					</button>
					<button className="accent-button" type="button" disabled={busy} onClick={onConfirm}>
						{busy ? t("processing") : t("trustProject")}
					</button>
				</div>
			</div>
		</div>
	);
});
