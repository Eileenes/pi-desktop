import { type FormEvent, memo, useEffect, useState } from "react";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";

interface ProjectEditorDialogProps {
	/** The project's own root folder: always first, always the primary folder. */
	projectRoot: string;
	initialName: string;
	initialFolders: string[];
	busy?: boolean;
	/** Opens the native folder picker; resolves to the chosen path, if any. */
	onRequestFolder: () => Promise<string | undefined>;
	onRemoveProject: () => void;
	onClose: () => void;
	onSave: (draft: { name: string; folders: string[] }) => void;
}

function folderLabel(path: string): string {
	const trimmed = path.replace(/[\\/]+$/u, "");
	return trimmed.split(/[\\/]/u).at(-1) || path;
}

/**
 * The project editor: the display name the sidebar shows, and the folders whose
 * chats are folded into this project. The root folder cannot be dropped — it is
 * what the project is keyed on — so its row carries the primary badge instead
 * of a remove control.
 */
export const ProjectEditorDialog = memo(function ProjectEditorDialog({
	projectRoot,
	initialName,
	initialFolders,
	busy = false,
	onRequestFolder,
	onRemoveProject,
	onClose,
	onSave,
}: ProjectEditorDialogProps) {
	const { t } = useI18n();
	const [name, setName] = useState(initialName);
	const [folders, setFolders] = useState<string[]>(() => (initialFolders.length > 0 ? initialFolders : [projectRoot]));
	const [picking, setPicking] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		setName(initialName);
		setFolders(initialFolders.length > 0 ? initialFolders : [projectRoot]);
	}, [initialName, initialFolders, projectRoot]);

	async function handleAddFolder(): Promise<void> {
		setError(undefined);
		setPicking(true);
		try {
			const chosen = await onRequestFolder();
			if (!chosen) return;
			if (folders.includes(chosen)) {
				setError(t("folderAlreadyInProject"));
				return;
			}
			setFolders((current) => [...current, chosen]);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPicking(false);
		}
	}

	function handleSubmit(event: FormEvent): void {
		event.preventDefault();
		onSave({ name, folders });
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭对话框是标准交互
		<div
			className="modal-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form
				className="modal-panel project-editor-dialog"
				aria-labelledby="project-editor-title"
				onSubmit={handleSubmit}
			>
				<header className="modal-header">
					<h2 className="modal-title" id="project-editor-title">
						{t("editProject")}
					</h2>
					<button className="icon-button" type="button" aria-label={t("close")} onClick={onClose}>
						×
					</button>
				</header>
				<div className="modal-body project-editor-body">
					<div className="project-editor-field">
						<span className="project-editor-field-icon" aria-hidden="true">
							<Icon name="folder" size={15} />
						</span>
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={t("projectNamePlaceholder")}
							aria-label={t("projectNameLabel")}
							maxLength={120}
						/>
					</div>
					<p className="project-editor-label">{t("sourceFolders")}</p>
					<div className="project-editor-folders">
						{folders.map((folder, index) => (
							<div className="project-editor-folder" key={folder}>
								<Icon name="folder" size={15} />
								<span className="project-editor-folder-name" title={folder}>
									{folderLabel(folder)}
								</span>
								{index === 0 ? (
									<>
										<span className="project-editor-badge">{t("primaryFolder")}</span>
										<button
											className="project-editor-folder-remove"
											type="button"
											disabled
											title={t("removePrimaryFolderHint")}
											aria-label={t("removePrimaryFolderHint")}
										>
											<Icon name="close" size={12} />
										</button>
									</>
								) : (
									<button
										className="project-editor-folder-remove"
										type="button"
										aria-label={t("removeAria", { name: folderLabel(folder) })}
										title={t("remove")}
										onClick={() => setFolders((current) => current.filter((item) => item !== folder))}
									>
										<Icon name="close" size={12} />
									</button>
								)}
							</div>
						))}
						<button
							className="project-editor-folder project-editor-add"
							type="button"
							disabled={busy || picking}
							onClick={() => void handleAddFolder()}
						>
							<Icon name="folderPlus" size={15} />
							<span>{t("addFolder")}</span>
						</button>
					</div>
					{error ? <p className="project-editor-error">{error}</p> : null}
				</div>
				<footer className="project-editor-actions">
					<button className="project-editor-remove" type="button" disabled={busy} onClick={onRemoveProject}>
						{t("removeLocalProject")}
					</button>
					<span className="project-editor-actions-spacer" />
					<button className="quiet-button" type="button" disabled={busy} onClick={onClose}>
						{t("cancel")}
					</button>
					<button className="accent-button" type="submit" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</button>
				</footer>
			</form>
		</div>
	);
});
