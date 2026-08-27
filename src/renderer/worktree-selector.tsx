import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopGitWorktree } from "../shared/contracts.ts";
import {
	addGitWorktree,
	fetchGitBranches,
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

function displayRemoteBranch(branch: string): string {
	const normalized = displayBranch(branch);
	const slash = normalized.indexOf("/");
	return slash > 0 ? normalized.slice(slash + 1) : normalized;
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
	const [forceRemovePath, setForceRemovePath] = useState<string>();
	const [fetchingBranches, setFetchingBranches] = useState(false);
	const [worktreeFilter, setWorktreeFilter] = useState("");

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

	useEffect(() => {
		const refreshWhenVisible = () => {
			if (document.visibilityState === "visible") void load();
		};
		const interval = window.setInterval(refreshWhenVisible, 10_000);
		window.addEventListener("focus", refreshWhenVisible);
		document.addEventListener("visibilitychange", refreshWhenVisible);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refreshWhenVisible);
			document.removeEventListener("visibilitychange", refreshWhenVisible);
		};
	}, [load]);

	// Keep the selector visible with a single worktree so users can create the
	// first additional worktree instead of discovering the feature only after
	// one already exists.
	if (worktrees.length === 0) return null;

	async function handleRemove(path: string, force = false): Promise<void> {
		setBusy(true);
		setError(undefined);
		try {
			const result = await removeGitWorktree(path, force);
			if (result.dirty && !force) {
				setForceRemovePath(path);
				return;
			}
			setConfirmRemovePath(undefined);
			setForceRemovePath(undefined);
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
		if (!projectTrusted) {
			setError("请先信任当前项目，再创建 Worktree。");
			return;
		}
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

	async function handleFetchBranches(): Promise<void> {
		if (!projectTrusted || fetchingBranches) return;
		setFetchingBranches(true);
		setError(undefined);
		try {
			await fetchGitBranches();
			await load();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setFetchingBranches(false);
		}
	}

	async function handleSwitch(branch: string): Promise<void> {
		if (!branch) return;
		if (!projectTrusted) {
			setError("请先信任当前项目，再切换 Git 分支。");
			return;
		}
		const normalized = branches.remote.includes(branch) ? displayRemoteBranch(branch) : displayBranch(branch);
		const holder = worktrees.find((tree) => tree.path !== workspacePath && displayBranch(tree.branch) === normalized);
		if (holder) {
			onSwitch(holder.path);
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

	const normalizedWorktreeFilter = worktreeFilter.trim().toLocaleLowerCase();
	const visibleWorktrees = normalizedWorktreeFilter
		? worktrees.filter(
				(tree) =>
					displayBranch(tree.branch).toLocaleLowerCase().includes(normalizedWorktreeFilter) ||
					tree.path.toLocaleLowerCase().includes(normalizedWorktreeFilter),
			)
		: worktrees;

	return (
		<div className="worktree-section">
			<div className="project-menu-label">Worktrees</div>
			{worktrees.length >= 8 ? (
				<input
					className="worktree-filter"
					value={worktreeFilter}
					onChange={(event) => setWorktreeFilter(event.target.value)}
					placeholder="筛选 Worktree…"
					aria-label="筛选 Worktree"
				/>
			) : null}
			<div className="worktree-list">
				{visibleWorktrees.map((tree) => (
					<div className={`worktree-row ${tree.path === workspacePath ? "is-current" : ""}`} key={tree.path}>
						<button
							className="worktree-row-main"
							type="button"
							onClick={() => {
								if (tree.path !== workspacePath) onSwitch(tree.path);
							}}
						>
							<span>
								⎇ {displayBranch(tree.branch)}
								{tree.isMain ? " · 主目录" : ""}
							</span>
							<small>{tree.path}</small>
						</button>
						{!tree.isMain ? (
							confirmRemovePath === tree.path ? (
								<div className="worktree-confirm-remove">
									<button
										type="button"
										disabled={busy || !projectTrusted}
										title={!projectTrusted ? "请先信任当前项目" : undefined}
										onClick={() => void handleRemove(tree.path, forceRemovePath === tree.path)}
									>
										{forceRemovePath === tree.path ? "强制移除" : "确认"}
									</button>
									<button
										type="button"
										onClick={() => {
											setConfirmRemovePath(undefined);
											setForceRemovePath(undefined);
										}}
									>
										取消
									</button>
								</div>
							) : (
								<button
									className="worktree-remove"
									type="button"
									disabled={!projectTrusted}
									title={!projectTrusted ? "请先信任当前项目" : undefined}
									aria-label={`移除 ${displayBranch(tree.branch)}`}
									onClick={() => {
										setConfirmRemovePath(tree.path);
										setForceRemovePath(undefined);
									}}
								>
									×
								</button>
							)
						) : null}
					</div>
				))}
				{visibleWorktrees.length === 0 ? <p className="worktree-empty">没有匹配的 Worktree。</p> : null}
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
				<button
					type="button"
					disabled={!branchDraft.trim() || busy || !projectTrusted}
					title={!projectTrusted ? "请先信任当前项目" : undefined}
					onClick={() => void handleAdd()}
				>
					{busy ? "创建中" : "新建"}
				</button>
			</div>
			{branches.local.length || branches.remote.length ? (
				<label className="worktree-branch-switcher">
					<span>切换当前分支</span>
					<div className="worktree-branch-controls">
						<select
							defaultValue=""
							disabled={busy || fetchingBranches || !projectTrusted}
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
											{displayRemoteBranch(branch)} ({branch.split("/", 1)[0] ?? "remote"})
										</option>
									))}
								</optgroup>
							) : null}
						</select>
						<button
							className="outline-button worktree-fetch"
							type="button"
							disabled={busy || fetchingBranches || !projectTrusted}
							title={!projectTrusted ? "请先信任当前项目" : "获取最新远程分支"}
							onClick={() => void handleFetchBranches()}
						>
							{fetchingBranches ? "刷新中…" : "刷新"}
						</button>
					</div>
				</label>
			) : null}
			{error ? <p className="worktree-error">{error}</p> : null}
		</div>
	);
});
