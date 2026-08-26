import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopGitWorktree } from "../shared/contracts.ts";
import { addGitWorktree, listGitWorktrees, removeGitWorktree } from "./desktop-store.ts";

interface WorktreeSelectorProps {
	workspacePath: string;
	onSwitch: (path: string) => void;
}

export const WorktreeSelector = memo(function WorktreeSelector({ workspacePath, onSwitch }: WorktreeSelectorProps) {
	const [worktrees, setWorktrees] = useState<DesktopGitWorktree[]>([]);
	const [loading, setLoading] = useState(true);
	const [open, setOpen] = useState(false);
	const [branchDraft, setBranchDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			setWorktrees(await listGitWorktrees());
		} catch {
			setWorktrees([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	if (loading || worktrees.length <= 1) return null;

	const currentBranch = worktrees.find((tree) => tree.path === workspacePath)?.branch ?? worktrees[0]?.branch;

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
			setOpen(false);
			onSwitch(created.path);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="worktree-selector">
			<button className="worktree-trigger" type="button" onClick={() => setOpen((current) => !current)}>
				<span className="worktree-branch-icon">⎇</span>
				<span>{currentBranch}</span>
			</button>
			{open ? (
				<div className="worktree-popover" role="menu" aria-label="Worktree">
					<div className="worktree-list">
						{worktrees.map((tree) => (
							<div className={`worktree-row ${tree.path === workspacePath ? "is-current" : ""}`} key={tree.path}>
								<button
									className="worktree-row-main"
									type="button"
									onClick={() => {
										setOpen(false);
										if (tree.path !== workspacePath) onSwitch(tree.path);
									}}
								>
									<span>{tree.branch}</span>
									<small>{tree.path}</small>
								</button>
								{tree.path !== workspacePath ? (
									<button
										className="worktree-remove"
										type="button"
										aria-label={`移除 ${tree.branch}`}
										onClick={() => void handleRemove(tree.path)}
									>
										×
									</button>
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
			) : null}
		</div>
	);
});
