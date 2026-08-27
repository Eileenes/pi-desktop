import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopDirectoryEntry } from "../shared/contracts.ts";
import { browseDirectories } from "./desktop-store.ts";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";

interface DirectoryPickerProps {
	onClose: () => void;
	onSelect: (path: string) => void;
	busy?: boolean;
}

export const DirectoryPicker = memo(function DirectoryPicker({
	onClose,
	onSelect,
	busy = false,
}: DirectoryPickerProps) {
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
	const displayedEntries = drives ?? directories;
	const handleClose = busy ? () => undefined : onClose;

	return (
		<Modal
			title="选择项目文件夹"
			subtitle={currentPath || "主目录"}
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
					<button
						className="outline-button directory-picker-back"
						type="button"
						disabled={loading || busy || !parentPath}
						title="返回上一级"
						onClick={() => void navigateTo(parentPath)}
					>
						↑
					</button>
					<input
						className="mono"
						value={pathInput}
						// biome-ignore lint/a11y/noAutofocus: 路径输入是目录选择器的主要操作入口。
						autoFocus
						autoComplete="off"
						spellCheck={false}
						aria-label="目录路径"
						onChange={(event) => {
							setPathInput(event.target.value);
							setError(undefined);
						}}
					/>
					<button className="outline-button" type="submit" disabled={loading || busy || !pathInput.trim()}>
						打开
					</button>
				</form>
				<div className="directory-picker-list" aria-live="polite">
					{loading ? <p className="modal-empty">正在读取目录…</p> : null}
					{!loading && error ? <p className="modal-empty is-error">{error}</p> : null}
					{!loading && !error && displayedEntries.length === 0 ? (
						<p className="modal-empty">没有可用的子目录。</p>
					) : null}
					{!loading && !error
						? displayedEntries.map((entry) => (
								<button
									className="directory-picker-entry"
									type="button"
									key={entry.path}
									title={entry.path}
									disabled={busy}
									onClick={() => void navigateTo(entry.path)}
								>
									<Icon name="folder" size={14} />
									<span>{entry.name}</span>
								</button>
							))
						: null}
				</div>
				<footer className="directory-picker-footer">
					<button className="outline-button" type="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button
						className="accent-button"
						type="button"
						disabled={!canSelect}
						title={hasUncommittedPath ? "请先打开输入的目录" : undefined}
						onClick={() => onSelect(currentPath)}
					>
						{busy ? "打开中…" : "选择此文件夹"}
					</button>
				</footer>
			</div>
		</Modal>
	);
});
