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
			className={dialog.kind === "editor" ? "w-[min(720px,100%)]" : "w-[min(420px,100%)]"}
			footer={footer}
			footerClassName="is-end"
			closeDisabled={busy}
			onClose={() => submit(dialog.kind === "confirm" ? "cancel" : "")}
		>
			{dialog.kind === "confirm" ? (
				<p className="mt-2 mb-0 text-[length:var(--text-md)] leading-[1.55] text-[color:var(--text-dim)]">
					{dialog.message}
				</p>
			) : null}
			{dialog.kind === "select" ? (
				<div className="mt-3 grid max-h-[260px] gap-1 overflow-auto">
					{dialog.options.map((option) => (
						<Button
							variant="bare"
							className={`rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] bg-transparent px-2.5 py-2 text-left text-[length:var(--text-md)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${value === option ? "border-[var(--accent-strong)] font-medium text-[color:var(--text)]" : ""}`}
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
					className="mt-2.5 w-full"
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
					className="mt-2.5 min-h-[240px] w-[min(680px,calc(100vw-96px))] max-h-[min(56vh,560px)] resize-y rounded-[var(--radius-xs)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-3.5 py-3 font-[family-name:var(--font-mono)] text-[length:var(--text-md)] leading-[var(--leading-chat)] text-[color:var(--text)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
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
