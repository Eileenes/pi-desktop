import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopGitWorktree } from "../shared/contracts.ts";
import { addGitWorktree, listGitWorktrees, removeGitWorktree } from "./desktop-store.ts";

interface WorktreeSectionProps {
	workspacePath: string;
	onSwitch: (path: string) => void;
}

export const WorktreeSection = memo(function WorktreeSection({ workspacePath, onSwitch }: WorktreeSectionProps) {
	const [worktrees, setWorktrees] = useState<DesktopGitWorktree[]>([]);
	const [branchDraft, setBranchDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [confirmRemovePath, setConfirmRemovePath] = useState<string>();

	const load = useCallback(async () => {
		setError(undefined);
		try {
			setWorktrees(await listGitWorktrees());
		} catch {
			setWorktrees([]);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	if (worktrees.length <= 1) return null;

	async function handleRemove(path: string): Promise<void> {
		setBusy(true);
		setError(undefined);
		try {
			await removeGitWorktree(path);
			await load();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	async function handleAdd(): Promise<void> {
		const branch = branchDraft.trim();
		if (!branch) return;
		setBusy(true);
		setError(undefined);
		try {
			const created = await addGitWorktree(branch);
			await load();
			setBranchDraft("");
			onSwitch(created.path);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="worktree-section">
			<div className="project-menu-label">Worktrees</div>
			<div className="worktree-list">
				{worktrees.map((tree) => (
					<div className={`worktree-row ${tree.path === workspacePath ? "is-current" : ""}`} key={tree.path}>
						<button
							className="worktree-row-main"
							type="button"
							onClick={() => {
								if (tree.path !== workspacePath) onSwitch(tree.path);
							}}
						>
							<span>⎇ {tree.branch}</span>
							<small>{tree.path}</small>
						</button>
						{tree.path !== workspacePath ? (
							confirmRemovePath === tree.path ? (
								<div className="worktree-confirm-remove">
									<button type="button" disabled={busy} onClick={() => void handleRemove(tree.path)}>
										确认
									</button>
									<button type="button" onClick={() => setConfirmRemovePath(undefined)}>
										取消
									</button>
								</div>
							) : (
								<button
									className="worktree-remove"
									type="button"
									aria-label={`移除 ${tree.branch}`}
									onClick={() => setConfirmRemovePath(tree.path)}
								>
									×
								</button>
							)
						) : null}
					</div>
				))}
			</div>
			<div className="worktree-add">
				<input
					placeholder="新分支名"
					value={branchDraft}
					onChange={(event) => setBranchDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void handleAdd();
						}
					}}
				/>
				<button type="button" disabled={!branchDraft.trim() || busy} onClick={() => void handleAdd()}>
					{busy ? "创建中" : "新建"}
				</button>
			</div>
			{error ? <p className="worktree-error">{error}</p> : null}
		</div>
	);
});
