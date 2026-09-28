import { memo, useEffect, useState } from "react";
import type { DesktopExtensionDialog } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";

interface ExtensionDialogProps {
	dialog: DesktopExtensionDialog;
	busy: boolean;
	onRespond: (id: string, value: string) => void;
}

export const ExtensionDialog = memo(function ExtensionDialog({ dialog, busy, onRespond }: ExtensionDialogProps) {
	const { t } = useI18n();
	const [value, setValue] = useState("");
	const dialogId = dialog.id;

	// biome-ignore lint/correctness/useExhaustiveDependencies: 对话框切换时重置输入
	useEffect(() => {
		setValue(dialog.kind === "editor" ? (dialog.prefill ?? "") : "");
	}, [dialogId, dialog]);

	function submit(response: string): void {
		if (busy) return;
		onRespond(dialog.id, response);
	}

	const footer =
		dialog.kind === "select" ? undefined : dialog.kind === "confirm" ? (
			<>
				<Button variant="outline" type="button" disabled={busy} onClick={() => submit("cancel")}>
					{t("cancel")}
				</Button>
				<Button variant="primary" type="button" disabled={busy} onClick={() => submit("confirm")}>
					{t("confirm")}
				</Button>
			</>
		) : (
			<>
				<Button variant="outline" type="button" disabled={busy} onClick={() => submit("")}>
					{t("cancel")}
				</Button>
				<Button variant="primary" type="button" disabled={busy || !value.trim()} onClick={() => submit(value)}>
					{t("ok")}
				</Button>
			</>
		);

	return (
		<Modal
			title={dialog.title}
			className={`extension-dialog${dialog.kind === "editor" ? " is-editor" : ""}`}
			footer={footer}
			footerClassName="is-end"
			closeDisabled={busy}
			onClose={() => submit(dialog.kind === "confirm" ? "cancel" : "")}
		>
			{dialog.kind === "confirm" ? <p className="extension-dialog-message">{dialog.message}</p> : null}
			{dialog.kind === "select" ? (
				<div className="extension-dialog-options">
					{dialog.options.map((option) => (
						<Button
							variant="bare"
							className={`extension-dialog-option ${value === option ? "is-active" : ""}`}
							key={option}
							disabled={busy}
							onClick={() => {
								setValue(option);
								submit(option);
							}}
						>
							{option}
						</Button>
					))}
				</div>
			) : null}
			{dialog.kind === "input" ? (
				<Field
					autoFocus
					placeholder={dialog.placeholder}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") submit(value);
						if (event.key === "Escape") submit("");
					}}
				/>
			) : null}
			{dialog.kind === "editor" ? (
				<Field
					as="textarea"
					autoFocus
					className="extension-dialog-editor"
					value={value}
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") submit("");
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit(value);
						}
					}}
				/>
			) : null}
		</Modal>
	);
});
