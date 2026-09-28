import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopDirectoryEntry } from "../shared/contracts.ts";
import { browseDirectories } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";

interface DirectoryPickerProps {
	onClose: () => void;
	onSelect: (path: string) => void;
	busy?: boolean;
	error?: string;
}

function isWindowsDriveRoot(path: string): boolean {
	return /^[A-Za-z]:[\\/]?$/u.test(path);
}

function DriveIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeWidth="1.3"
			viewBox="0 0 16 16"
			width="14"
		>
			<rect height="10" rx="1.5" width="12" x="2" y="3" />
			<path d="M2 9h12" />
			<circle cx="11.5" cy="11" fill="currentColor" r="0.6" stroke="none" />
		</svg>
	);
}

export const DirectoryPicker = memo(function DirectoryPicker({
	onClose,
	onSelect,
	busy = false,
	error: selectionError,
}: DirectoryPickerProps) {
	const { t } = useI18n();
	const [currentPath, setCurrentPath] = useState("");
	const [parentPath, setParentPath] = useState<string>();
	const [pathInput, setPathInput] = useState("");
	const [directories, setDirectories] = useState<DesktopDirectoryEntry[]>([]);
	const [drives, setDrives] = useState<DesktopDirectoryEntry[]>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const navigateTo = useCallback(async (path?: string) => {
		setLoading(true);
		setError(undefined);
		try {
			const listing = await browseDirectories(path);
			setCurrentPath(listing.path);
			setParentPath(listing.parentPath);
			setPathInput(listing.path);
			setDirectories(listing.directories);
			setDrives(listing.drives);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void navigateTo();
	}, [navigateTo]);

	const hasUncommittedPath = pathInput.trim() !== currentPath;
	const canSelect = Boolean(currentPath) && !hasUncommittedPath && !loading && !busy;
	const canNavigateUp = Boolean(parentPath) || isWindowsDriveRoot(currentPath);
	const displayedEntries = drives ?? directories;
	const handleClose = busy ? () => undefined : onClose;

	return (
		<Modal
			title={t("pickProjectFolder")}
			subtitle={currentPath || t("homeDirectory")}
			className="directory-picker-modal"
			onClose={handleClose}
		>
			<div className="directory-picker-content">
				<form
					className="directory-picker-path-row"
					onSubmit={(event) => {
						event.preventDefault();
						if (pathInput.trim()) void navigateTo(pathInput.trim());
					}}
				>
					<Button
						variant="outline"
						className="directory-picker-back"
						type="button"
						disabled={loading || busy || !canNavigateUp}
						title={t("goUp")}
						onClick={() => void navigateTo(parentPath ?? undefined)}
					>
						↑
					</Button>
					<Field
						className="mono"
						value={pathInput}
						autoFocus
						autoComplete="off"
						spellCheck={false}
						aria-label={t("directoryPath")}
						onChange={(event) => {
							setPathInput(event.target.value);
							setError(undefined);
						}}
					/>
					<Button variant="outline" type="submit" disabled={loading || busy || !pathInput.trim()}>
						{t("open")}
					</Button>
				</form>
				<div className="directory-picker-list" aria-live="polite">
					{loading ? <p className="modal-empty">{t("loadingDirectories")}</p> : null}
					{!loading && (error || selectionError) ? (
						<p className="modal-empty is-error">{error ?? selectionError}</p>
					) : null}
					{!loading && !error && !selectionError && displayedEntries.length === 0 ? (
						<p className="modal-empty">{t("noSubdirectories")}</p>
					) : null}
					{!loading && !error && !selectionError
						? displayedEntries.map((entry) => (
								<Button
									variant="bare"
									className="directory-picker-entry"
									key={entry.path}
									title={entry.path}
									disabled={busy}
									onClick={() => void navigateTo(entry.path)}
								>
									{drives ? <DriveIcon /> : <Icon name="folder" size={14} />}
									<span>{entry.name}</span>
								</Button>
							))
						: null}
				</div>
				<footer className="directory-picker-footer">
					<Button variant="outline" type="button" disabled={busy} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button
						variant="primary"
						type="button"
						disabled={!canSelect}
						title={hasUncommittedPath ? t("openFirstHint") : undefined}
						onClick={() => onSelect(currentPath)}
					>
						{busy ? t("opening") : t("selectThisFolder")}
					</Button>
				</footer>
			</div>
		</Modal>
	);
});
