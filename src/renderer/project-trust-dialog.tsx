import { memo } from "react";
import { useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";
import { Button } from "./ui/button.tsx";

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
		<Modal
			title={t("trustDialogTitle")}
			className="trust-dialog"
			closeDisabled={busy}
			footerClassName="is-end"
			onClose={onCancel}
			footer={
				<>
					<Button variant="outline" type="button" disabled={busy} onClick={onCancel}>
						{t("cancel")}
					</Button>
					<Button variant="primary" type="button" disabled={busy} onClick={onConfirm}>
						{busy ? t("processing") : t("trustProject")}
					</Button>
				</>
			}
		>
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
					<p>{t("trustDescription")}</p>
					<code>{workspacePath}</code>
					{error ? <p className="trust-dialog-error">{error}</p> : null}
				</div>
			</div>
		</Modal>
	);
});
