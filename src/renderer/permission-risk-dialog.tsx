import { memo, useState } from "react";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Modal } from "./ui/modal.tsx";

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
		<Modal
			title={t("permissionRiskTitle")}
			className="w-[min(460px,100%)]"
			bodyClassName="grid gap-3.5 overflow-visible"
			footerClassName="is-end"
			onClose={onCancel}
			footer={
				<>
					<Button variant="outline" type="button" onClick={onCancel}>
						{t("cancel")}
					</Button>
					<Button variant="primary" type="button" disabled={!acknowledged || busy} onClick={onConfirm}>
						{t("permissionRiskConfirm")}
					</Button>
				</>
			}
		>
			<div className="flex items-start gap-2.5">
				<svg
					className="mt-px shrink-0 text-[color:var(--ds-error)]"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.9"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
					<path d="M12 8v5" />
					<circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
				</svg>
				<p className="m-0 text-[length:var(--text-sm-plus)] leading-[1.6] text-[color:var(--ds-text-secondary)]">
					{t("permissionRiskBody")}
				</p>
			</div>
			<label className="flex cursor-pointer items-center gap-2 text-[length:var(--text-sm-plus)] text-[color:var(--ds-text-primary)]">
				<input
					className="size-[15px] shrink-0 accent-[var(--ds-accent)]"
					type="checkbox"
					checked={acknowledged}
					onChange={(event) => setAcknowledged(event.target.checked)}
				/>
				<span>{t("permissionRiskAcknowledge")}</span>
			</label>
		</Modal>
	);
});
