import { type FormEvent, memo, useEffect, useState } from "react";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";

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
		<Modal
			title={t("editProject")}
			className="w-[min(520px,100%)]"
			bodyClassName="grid gap-3 overflow-visible"
			onClose={onClose}
			onSubmit={handleSubmit}
			footer={
				<>
					<Button variant="danger" type="button" disabled={busy} onClick={onRemoveProject}>
						{t("removeLocalProject")}
					</Button>
					<span className="flex-1" />
					<Button variant="outline" type="button" disabled={busy} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button variant="primary" type="submit" disabled={busy}>
						{busy ? t("saving") : t("save")}
					</Button>
				</>
			}
		>
			<div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--ds-border-strong)] bg-[var(--ds-field-inset-bg)] py-1 pr-1.5 pl-1 transition-[border-color] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] focus-within:border-[var(--ds-accent)]">
				<span
					className="inline-grid size-[30px] w-8 shrink-0 place-items-center border-r border-[var(--ds-border-subtle)] text-[color:var(--ds-text-secondary)]"
					aria-hidden="true"
				>
					<Icon name="folder" size={15} />
				</span>
				<Field
					className="min-h-0 min-w-0 flex-1 bg-transparent px-0.5 py-[5px] text-[length:var(--text-base)] font-[var(--font-weight-medium)] shadow-none"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={t("projectNamePlaceholder")}
					aria-label={t("projectNameLabel")}
					maxLength={120}
				/>
			</div>
			<p className="-mb-1 mt-0.5 text-[length:var(--text-sm)] font-[var(--font-weight-medium)] text-[color:var(--ds-text-secondary)]">
				{t("sourceFolders")}
			</p>
			<div className="grid overflow-hidden rounded-[var(--radius-md)] border border-[var(--ds-border-subtle)]">
				{folders.map((folder, index) => (
					<div
						className="flex min-h-[42px] items-center gap-2.5 border-t border-[var(--ds-border-subtle)] bg-transparent px-3 py-1.5 text-left text-[length:var(--text-sm-plus)] text-[color:var(--ds-text-primary)] first:border-t-0 [&>svg]:shrink-0 [&>svg]:text-[color:var(--ds-text-secondary)]"
						key={folder}
					>
						<Icon name="folder" size={15} />
						<span className="min-w-0 truncate" title={folder}>
							{folderLabel(folder)}
						</span>
						{index === 0 ? (
							<>
								<span className="ml-auto rounded-[var(--radius-2xs)] border border-[var(--ds-border-strong)] px-2 py-px text-[length:var(--text-xs)] text-[color:var(--ds-text-secondary)]">
									{t("primaryFolder")}
								</span>
								<Button
									size="icon"
									className="ml-auto inline-grid size-[22px] place-items-center rounded-[var(--radius-2xs)] border-0 bg-transparent text-[color:var(--ds-text-muted)] hover:bg-[var(--ds-bg-hover)] hover:text-[color:var(--ds-text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--ds-text-faint)]"
									disabled
									title={t("removePrimaryFolderHint")}
									aria-label={t("removePrimaryFolderHint")}
								>
									<Icon name="close" size={12} />
								</Button>
							</>
						) : (
							<Button
								size="icon"
								className="ml-auto inline-grid size-[22px] place-items-center rounded-[var(--radius-2xs)] border-0 bg-transparent text-[color:var(--ds-text-muted)] hover:bg-[var(--ds-bg-hover)] hover:text-[color:var(--ds-text-primary)]"
								aria-label={t("removeAria", { name: folderLabel(folder) })}
								title={t("remove")}
								onClick={() => setFolders((current) => current.filter((item) => item !== folder))}
							>
								<Icon name="close" size={12} />
							</Button>
						)}
					</div>
				))}
				<Button
					className="flex min-h-[42px] cursor-pointer items-center gap-2.5 border-t border-[var(--ds-border-subtle)] bg-transparent px-3 py-1.5 text-left text-[length:var(--text-sm-plus)] text-[color:var(--ds-text-secondary)] hover:bg-[var(--ds-bg-hover)] hover:text-[color:var(--ds-text-primary)] disabled:cursor-not-allowed [&>svg]:shrink-0"
					disabled={busy || picking}
					onClick={() => void handleAddFolder()}
				>
					<Icon name="folderPlus" size={15} />
					<span>{t("addFolder")}</span>
				</Button>
			</div>
			{error ? <p className="m-0 text-[length:var(--text-xs)] text-[color:var(--ds-error)]">{error}</p> : null}
		</Modal>
	);
});
