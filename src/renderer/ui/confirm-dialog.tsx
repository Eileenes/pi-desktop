import { memo } from "react";
import { useI18n } from "../i18n.ts";
import { Button } from "./button.tsx";
import { Modal } from "./modal.tsx";

interface ConfirmDialogProps {
	title: string;
	message: string;
	detail?: string;
	confirmLabel: string;
	danger?: boolean;
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

/** In-app confirmation. Replaces system message boxes and window.confirm. */
export const ConfirmDialog = memo(function ConfirmDialog({
	title,
	message,
	detail,
	confirmLabel,
	danger = false,
	busy = false,
	onCancel,
	onConfirm,
}: ConfirmDialogProps) {
	const { t } = useI18n();
	return (
		<Modal
			title={title}
			className="w-[min(420px,100%)]"
			footerClassName="is-end"
			closeDisabled={busy}
			onClose={onCancel}
			footer={
				<>
					<Button variant="outline" type="button" disabled={busy} onClick={onCancel}>
						{t("cancel")}
					</Button>
					<Button variant={danger ? "danger" : "primary"} type="button" disabled={busy} onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</>
			}
		>
			<p className="m-0 text-[length:var(--text-sm)] leading-normal text-[color:var(--text)]">{message}</p>
			{detail ? (
				<p className="mt-2 mb-0 text-[length:var(--text-xs)] leading-normal break-all text-[color:var(--muted)]">
					{detail}
				</p>
			) : null}
		</Modal>
	);
});
