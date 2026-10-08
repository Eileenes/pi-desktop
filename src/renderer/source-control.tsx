import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopGitChange } from "../shared/contracts.ts";
import { getGitDiff, listGitChanges } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";

const STATUS_LABELS: Record<DesktopGitChange["status"], string> = {
	added: "A",
	conflict: "C",
	deleted: "D",
	modified: "M",
	renamed: "R",
	untracked: "U",
};

function statusClass(status: DesktopGitChange["status"]): string {
	if (status === "deleted" || status === "conflict") return "text-[color:var(--danger)]";
	if (status === "added" || status === "untracked") return "text-[color:var(--success)]";
	return "text-[color:var(--accent)]";
}

function diffLineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return "font-semibold text-[color:var(--muted)]";
	if (line.startsWith("@@")) return "text-[color:var(--accent)]";
	if (line.startsWith("+")) return "text-[color:var(--success)]";
	if (line.startsWith("-")) return "text-[color:var(--danger)]";
	return "";
}

interface DiffTab {
	path: string;
	content?: string;
	loading: boolean;
	error?: string;
}

export const SourceControl = memo(function SourceControl() {
	const { t } = useI18n();
	const [changes, setChanges] = useState<DesktopGitChange[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [tabs, setTabs] = useState<DiffTab[]>([]);
	const [activePath, setActivePath] = useState<string>();
	const activeTab = useMemo(() => tabs.find((tab) => tab.path === activePath), [tabs, activePath]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const nextChanges = await listGitChanges();
			setChanges(nextChanges);
			const paths = new Set(nextChanges.map((change) => change.path));
			setTabs((current) => current.filter((tab) => paths.has(tab.path)));
			setActivePath((current) => (current && paths.has(current) ? current : undefined));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const openDiff = useCallback(async (path: string) => {
		setActivePath(path);
		let needsLoad = false;
		setTabs((current) => {
			if (current.some((tab) => tab.path === path)) return current;
			needsLoad = true;
			return [...current, { path, loading: true }];
		});
		if (!needsLoad) return;
		try {
			const content = await getGitDiff(path);
			setTabs((current) => current.map((tab) => (tab.path === path ? { path, content, loading: false } : tab)));
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			setTabs((current) =>
				current.map((tab) => (tab.path === path ? { path, loading: false, error: message } : tab)),
			);
		}
	}, []);

	const closeTab = useCallback((path: string) => {
		setTabs((current) => {
			const index = current.findIndex((tab) => tab.path === path);
			const next = current.filter((tab) => tab.path !== path);
			setActivePath((active) => {
				if (active !== path) return active;
				return next[Math.min(index, next.length - 1)]?.path;
			});
			return next;
		});
	}, []);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="mt-3.5 flex min-h-[34px] items-center justify-between py-1 pr-2 pl-1.5 text-[length:var(--text-md)] font-semibold tracking-[0.12em] text-[color:var(--muted)]">
				<span>{t("changesWithCount", { count: changes.length })}</span>
				<Button
					size="icon"
					className="compact"
					type="button"
					aria-label={t("refreshChanges")}
					onClick={() => void load()}
				>
					↻
				</Button>
			</div>
			{error ? (
				<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">{error}</p>
			) : null}
			{loading ? (
				<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]">
					{t("loadingGitStatus")}
				</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
				{changes.map((change) => (
					<Button
						variant="bare"
						key={change.path}
						className={`flex w-full items-center gap-2 rounded-[var(--radius-s)] border-0 bg-transparent px-2 py-[5px] text-left font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[color:var(--text)] [&>span:last-child]:truncate ${activePath === change.path ? "bg-[color-mix(in_oklab,var(--ds-accent)_14%,transparent)] text-[color:var(--text)]" : ""}`}
						onClick={() => void openDiff(change.path)}
					>
						<span className={`w-3.5 shrink-0 text-center font-semibold ${statusClass(change.status)}`}>
							{STATUS_LABELS[change.status]}
						</span>
						<span>{change.path}</span>
					</Button>
				))}
				{!loading && !error && changes.length === 0 ? (
					<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]">
						{t("noUncommittedChanges")}
					</p>
				) : null}
			</div>
			{tabs.length ? (
				<div className="flex max-h-[45%] shrink-0 flex-col border-t border-[var(--border-subtle)]">
					<div
						className="flex overflow-x-auto border-b border-[var(--border-subtle)]"
						role="tablist"
						aria-label={t("diffFiles")}
					>
						{tabs.map((tab) => (
							<div
								className={`flex shrink-0 items-center border-r border-[var(--border-subtle)] ${activePath === tab.path ? "bg-[var(--bg)] text-[color:var(--text)]" : "bg-[var(--surface-recessed)] text-[color:var(--muted)]"}`}
								key={tab.path}
							>
								<Button
									variant="bare"
									role="tab"
									aria-selected={activePath === tab.path}
									onClick={() => setActivePath(tab.path)}
								>
									{tab.path.split("/").at(-1)}
								</Button>
								<Button
									size="icon"
									className="compact"
									aria-label={t("closeDiffAria", { path: tab.path })}
									onClick={() => closeTab(tab.path)}
								>
									×
								</Button>
							</div>
						))}
					</div>
					<div className="px-4 py-2">
						<strong className="block truncate font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] font-medium text-[color:var(--text-dim)]">
							{activePath}
						</strong>
					</div>
					{activeTab?.loading ? (
						<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--muted)]">
							{t("loadingDiff")}
						</p>
					) : null}
					{activeTab?.error ? (
						<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">
							{activeTab.error}
						</p>
					) : null}
					{activeTab && !activeTab.loading && !activeTab.error ? (
						<pre className="m-0 flex-1 overflow-auto pb-3 font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] leading-[1.55] whitespace-pre text-[color:var(--text-dim)] [&>code]:whitespace-pre">
							<code>
								{(activeTab.content || t("noTextDiff")).split("\n").map((line, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: diff 行顺序固定、不可重排
									<span className={diffLineClass(line)} key={index}>
										{line || " "}
										{"\n"}
									</span>
								))}
							</code>
						</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
});
