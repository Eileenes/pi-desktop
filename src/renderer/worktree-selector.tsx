import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopGitWorktree } from "../shared/contracts.ts";
import {
	addGitWorktree,
	listGitBranches,
	listGitWorktrees,
	removeGitWorktree,
	switchGitBranch,
} from "./desktop-store.ts";

interface WorktreeSectionProps {
	workspacePath: string;
	projectTrusted: boolean;
	onSwitch: (path: string) => void;
}

function displayBranch(branch: string): string {
	return branch.replace(/^refs\/(?:heads|remotes)\//u, "");
}

export const WorktreeSection = memo(function WorktreeSection({
	workspacePath,
	projectTrusted,
	onSwitch,
}: WorktreeSectionProps) {
	const [worktrees, setWorktrees] = useState<DesktopGitWorktree[]>([]);
	const [branches, setBranches] = useState<{ local: string[]; remote: string[] }>({ local: [], remote: [] });
	const [branchDraft, setBranchDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [confirmRemovePath, setConfirmRemovePath] = useState<string>();

	const load = useCallback(async () => {
		setError(undefined);
		try {
			const [nextWorktrees, nextBranches] = await Promise.all([listGitWorktrees(), listGitBranches()]);
			setWorktrees(nextWorktrees);
			setBranches(nextBranches);
		} catch {
			setWorktrees([]);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Keep the selector visible with a single worktree so users can create the
	// first additional worktree instead of discovering the feature only after
	// one already exists.
	if (worktrees.length === 0) return null;

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

	async function handleSwitch(branch: string): Promise<void> {
		if (!branch) return;
		if (!projectTrusted) {
			setError("请先信任当前项目，再切换 Git 分支。");
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			await switchGitBranch(branch);
			await load();
			onSwitch(workspacePath);
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
							<span>⎇ {displayBranch(tree.branch)}</span>
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
									aria-label={`移除 ${displayBranch(tree.branch)}`}
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
			{branches.local.length || branches.remote.length ? (
				<label className="worktree-branch-switcher">
					<span>切换当前分支</span>
					<select
						defaultValue=""
						disabled={busy || !projectTrusted}
						title={!projectTrusted ? "请先信任当前项目" : undefined}
						onChange={(event) => void handleSwitch(event.target.value)}
					>
						<option value="">选择分支…</option>
						{branches.local.length ? (
							<optgroup label="本地分支">
								{branches.local.map((branch) => (
									<option key={`local-${branch}`} value={branch}>
										{branch}
									</option>
								))}
							</optgroup>
						) : null}
						{branches.remote.length ? (
							<optgroup label="远程分支">
								{branches.remote.map((branch) => (
									<option key={`remote-${branch}`} value={branch}>
										{branch}
									</option>
								))}
							</optgroup>
						) : null}
					</select>
				</label>
			) : null}
			{error ? <p className="worktree-error">{error}</p> : null}
		</div>
	);
});
