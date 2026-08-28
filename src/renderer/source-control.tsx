import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopGitChange } from "../shared/contracts.ts";
import { getGitDiff, listGitChanges } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";

const STATUS_LABELS: Record<DesktopGitChange["status"], string> = {
	added: "A",
	conflict: "C",
	deleted: "D",
	modified: "M",
	renamed: "R",
	untracked: "U",
};

function statusClass(status: DesktopGitChange["status"]): string {
	if (status === "deleted" || status === "conflict") return "is-danger";
	if (status === "added" || status === "untracked") return "is-success";
	return "is-accent";
}

function diffLineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return "diff-head";
	if (line.startsWith("@@")) return "diff-hunk";
	if (line.startsWith("+")) return "diff-add";
	if (line.startsWith("-")) return "diff-del";
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
		<div className="source-control">
			<div className="sidebar-section-title">
				<span>{t("changesWithCount", { count: changes.length })}</span>
				<button
					className="icon-button compact"
					type="button"
					aria-label={t("refreshChanges")}
					onClick={() => void load()}
				>
					↻
				</button>
			</div>
			{error ? <p className="sidebar-error">{error}</p> : null}
			{loading ? <p className="sidebar-loading">{t("loadingGitStatus")}</p> : null}
			<div className="change-list">
				{changes.map((change) => (
					<button
						key={change.path}
						className={`change-row ${activePath === change.path ? "is-selected" : ""}`}
						type="button"
						onClick={() => void openDiff(change.path)}
					>
						<span className={`change-status ${statusClass(change.status)}`}>{STATUS_LABELS[change.status]}</span>
						<span>{change.path}</span>
					</button>
				))}
				{!loading && !error && changes.length === 0 ? (
					<p className="sidebar-loading">{t("noUncommittedChanges")}</p>
				) : null}
			</div>
			{tabs.length ? (
				<div className="diff-panel">
					<div className="diff-tabs" role="tablist" aria-label={t("diffFiles")}>
						{tabs.map((tab) => (
							<div className={`diff-tab ${activePath === tab.path ? "is-active" : ""}`} key={tab.path}>
								<button
									type="button"
									role="tab"
									aria-selected={activePath === tab.path}
									onClick={() => setActivePath(tab.path)}
								>
									{tab.path.split("/").at(-1)}
								</button>
								<button
									type="button"
									aria-label={t("closeDiffAria", { path: tab.path })}
									onClick={() => closeTab(tab.path)}
								>
									×
								</button>
							</div>
						))}
					</div>
					<div className="diff-panel-header">
						<strong>{activePath}</strong>
					</div>
					{activeTab?.loading ? <p className="sidebar-loading">{t("loadingDiff")}</p> : null}
					{activeTab?.error ? <p className="sidebar-error">{activeTab.error}</p> : null}
					{activeTab && !activeTab.loading && !activeTab.error ? (
						<pre className="diff-view">
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
