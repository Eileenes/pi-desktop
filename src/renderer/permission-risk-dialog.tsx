import { memo, useState } from "react";
import { useI18n } from "./i18n.ts";

interface PermissionRiskDialogProps {
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

/**
 * Full access removes the per-call confirmation step, so it is the one mode
 * change that has to be acknowledged explicitly: the dialog states what the
 * agent gains and keeps the confirm button disabled until the risk is accepted.
 */
export const PermissionRiskDialog = memo(function PermissionRiskDialog({
	busy = false,
	onCancel,
	onConfirm,
}: PermissionRiskDialogProps) {
	const { t } = useI18n();
	const [acknowledged, setAcknowledged] = useState(false);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭对话框是标准交互
		<div
			className="modal-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onCancel();
			}}
		>
			<div
				className="modal-panel permission-risk-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="permission-risk-title"
			>
				<header className="modal-header">
					<h2 className="modal-title" id="permission-risk-title">
						{t("permissionRiskTitle")}
					</h2>
					<button className="icon-button" type="button" aria-label={t("close")} onClick={onCancel}>
						×
					</button>
				</header>
				<div className="modal-body permission-risk-body">
					<div className="permission-risk-notice">
						<svg
							className="permission-risk-icon"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7.5v5" />
							<path d="M12 16.2h.01" />
						</svg>
						<p>{t("permissionRiskBody")}</p>
					</div>
					<label className="permission-risk-ack">
						<input
							type="checkbox"
							checked={acknowledged}
							onChange={(event) => setAcknowledged(event.target.checked)}
						/>
						<span>{t("permissionRiskAcknowledge")}</span>
					</label>
				</div>
				<footer className="permission-risk-actions">
					<button className="quiet-button" type="button" onClick={onCancel}>
						{t("cancel")}
					</button>
					<button className="accent-button" type="button" disabled={!acknowledged || busy} onClick={onConfirm}>
						{t("permissionRiskConfirm")}
					</button>
				</footer>
			</div>
		</div>
	);
});
