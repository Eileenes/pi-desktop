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
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { MenuHeading } from "./ui/menu.tsx";

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
	const { t } = useI18n();
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
			setError(t("trustBeforeWorktree"));
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
			setError(t("trustBeforeBranch"));
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
		<div className="mt-0.5 grid">
			<MenuHeading>Worktrees</MenuHeading>
			{worktrees.length >= 8 ? (
				<Field
					className="box-border mx-2 mt-1 mb-1.5 w-[calc(100%-16px)] rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--text)] outline-none focus:border-[var(--accent)]"
					value={worktreeFilter}
					onChange={(event) => setWorktreeFilter(event.target.value)}
					placeholder={t("filterWorktrees")}
					aria-label={t("filterWorktrees")}
				/>
			) : null}
			<div className="grid max-h-[180px] overflow-auto py-0.5">
				{visibleWorktrees.map((tree) => (
					<div
						className={`group relative flex items-stretch hover:bg-[var(--hover)] ${tree.path === workspacePath ? "bg-[var(--hover)]" : ""}`}
						key={tree.path}
					>
						<Button
							variant="bare"
							className={`grid min-w-0 flex-1 gap-px rounded-[var(--radius-2xs)] border-0 bg-transparent px-2 py-1.5 text-left group-hover:text-[color:var(--text)] [&>span]:text-[length:var(--text-sm)] [&>span]:font-medium [&>small]:truncate [&>small]:font-[family-name:var(--font-mono)] [&>small]:text-[length:var(--text-xs)] [&>small]:text-[color:var(--muted)] ${tree.path === workspacePath ? "text-[color:var(--text)]" : "text-[color:var(--text-dim)]"}`}
							onClick={() => {
								if (tree.path !== workspacePath) onSwitch(tree.path);
							}}
						>
							<span>
								⎇ {displayBranch(tree.branch)}
								{tree.isMain ? ` · ${t("worktreeMain")}` : ""}
							</span>
							<small>{tree.path}</small>
						</Button>
						{!tree.isMain ? (
							confirmRemovePath === tree.path ? (
								<div className="flex items-center gap-[3px] pr-1">
									<Button
										size="sm"
										variant="danger"
										type="button"
										disabled={busy || !projectTrusted}
										title={!projectTrusted ? t("trustProjectFirst") : undefined}
										onClick={() => void handleRemove(tree.path, forceRemovePath === tree.path)}
									>
										{forceRemovePath === tree.path ? t("forceRemove") : t("confirm")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										type="button"
										onClick={() => {
											setConfirmRemovePath(undefined);
											setForceRemovePath(undefined);
										}}
									>
										{t("cancel")}
									</Button>
								</div>
							) : (
								<Button
									size="icon"
									className="mr-[5px] self-center border-0 bg-transparent px-[5px] py-0.5 text-[color:var(--muted)] hover:text-[color:var(--danger)] focus-visible:text-[color:var(--danger)]"
									disabled={!projectTrusted}
									title={!projectTrusted ? t("trustProjectFirst") : undefined}
									aria-label={t("removeWorktreeAria", { branch: displayBranch(tree.branch) })}
									onClick={() => {
										setConfirmRemovePath(tree.path);
										setForceRemovePath(undefined);
									}}
								>
									×
								</Button>
							)
						) : null}
					</div>
				))}
				{visibleWorktrees.length === 0 ? (
					<p className="mx-2.5 my-[7px] text-[length:var(--text-xs)] text-[color:var(--muted)]">
						{t("noMatchingWorktrees")}
					</p>
				) : null}
			</div>
			<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-2.5 py-2 [&>.ui-field]:min-w-0 [&>.ui-field]:flex-1">
				<Field
					placeholder={t("newBranchName")}
					value={branchDraft}
					onChange={(event) => setBranchDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void handleAdd();
						}
					}}
				/>
				<Button
					size="sm"
					variant="outline"
					type="button"
					disabled={!branchDraft.trim() || busy || !projectTrusted}
					title={!projectTrusted ? t("trustProjectFirst") : undefined}
					onClick={() => void handleAdd()}
				>
					{busy ? t("creating") : t("create")}
				</Button>
			</div>
			{branches.local.length || branches.remote.length ? (
				<label className="mx-2.5 mb-2 grid gap-1 text-[length:var(--text-2xs)] text-[color:var(--muted)] [&>.ui-field]:w-full">
					<span>{t("switchCurrentBranch")}</span>
					<div className="flex min-w-0 items-center gap-1 [&>.ui-field]:min-w-0 [&>.ui-field]:flex-1">
						<Field
							as="select"
							defaultValue=""
							disabled={busy || fetchingBranches || !projectTrusted}
							title={!projectTrusted ? t("trustProjectFirst") : undefined}
							onChange={(event) => void handleSwitch(event.target.value)}
						>
							<option value="">{t("chooseBranch")}</option>
							{branches.local.length ? (
								<optgroup label={t("localBranches")}>
									{branches.local.map((branch) => (
										<option key={`local-${branch}`} value={branch}>
											{branch}
										</option>
									))}
								</optgroup>
							) : null}
							{branches.remote.length ? (
								<optgroup label={t("remoteBranches")}>
									{branches.remote.map((branch) => (
										<option key={`remote-${branch}`} value={branch}>
											{displayRemoteBranch(branch)} ({branch.split("/", 1)[0] ?? "remote"})
										</option>
									))}
								</optgroup>
							) : null}
						</Field>
						<Button
							variant="outline"
							className="px-[7px] py-1 text-[length:var(--text-2xs)] whitespace-nowrap"
							type="button"
							disabled={busy || fetchingBranches || !projectTrusted}
							title={!projectTrusted ? t("trustProjectFirst") : t("fetchLatestRemoteHint")}
							onClick={() => void handleFetchBranches()}
						>
							{fetchingBranches ? t("refreshing") : t("refresh")}
						</Button>
					</div>
				</label>
			) : null}
			{error ? (
				<p className="m-0 px-3 pb-2 text-[length:var(--text-2xs)] text-[color:var(--danger)]">{error}</p>
			) : null}
		</div>
	);
});
