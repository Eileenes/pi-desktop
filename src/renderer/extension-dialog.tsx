import { memo, useEffect, useState } from "react";
import type { DesktopExtensionDialog } from "../shared/contracts.ts";

interface ExtensionDialogProps {
	dialog: DesktopExtensionDialog;
	busy: boolean;
	onRespond: (id: string, value: string) => void;
}

export const ExtensionDialog = memo(function ExtensionDialog({ dialog, busy, onRespond }: ExtensionDialogProps) {
	const [value, setValue] = useState("");
	const dialogId = dialog.id;

	// biome-ignore lint/correctness/useExhaustiveDependencies: 对话框切换时重置输入
	useEffect(() => {
		setValue("");
	}, [dialogId]);

	function submit(response: string): void {
		if (busy) return;
		onRespond(dialog.id, response);
	}

	return (
		<div className="modal-backdrop">
			<div
				className="models-discard-dialog extension-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={dialog.title}
			>
				<strong>{dialog.title}</strong>
				{dialog.kind === "confirm" ? <p className="extension-dialog-message">{dialog.message}</p> : null}
				{dialog.kind === "select" ? (
					<div className="extension-dialog-options">
						{dialog.options.map((option) => (
							<button
								className={`extension-dialog-option ${value === option ? "is-active" : ""}`}
								key={option}
								type="button"
								disabled={busy}
								onClick={() => {
									setValue(option);
									submit(option);
								}}
							>
								{option}
							</button>
						))}
					</div>
				) : null}
				{dialog.kind === "input" ? (
					<input
						// biome-ignore lint/a11y/noAutofocus: 对话框打开即聚焦输入
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
				{dialog.kind !== "select" ? (
					<div className="extension-dialog-actions">
						{dialog.kind === "confirm" ? (
							<>
								<button
									className="outline-button"
									type="button"
									disabled={busy}
									onClick={() => submit("cancel")}
								>
									取消
								</button>
								<button
									className="accent-button"
									type="button"
									disabled={busy}
									onClick={() => submit("confirm")}
								>
									确认
								</button>
							</>
						) : (
							<>
								<button className="outline-button" type="button" disabled={busy} onClick={() => submit("")}>
									取消
								</button>
								<button
									className="accent-button"
									type="button"
									disabled={busy || !value.trim()}
									onClick={() => submit(value)}
								>
									确定
								</button>
							</>
						)}
					</div>
				) : null}
			</div>
		</div>
	);
});
