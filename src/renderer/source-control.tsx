import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopGitChange } from "../shared/contracts.ts";
import { getGitDiff, listGitChanges } from "./desktop-store.ts";

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

export const SourceControl = memo(function SourceControl() {
	const [changes, setChanges] = useState<DesktopGitChange[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [selectedPath, setSelectedPath] = useState<string>();
	const [diff, setDiff] = useState<string>();
	const [diffLoading, setDiffLoading] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			setChanges(await listGitChanges());
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
		setSelectedPath(path);
		setDiffLoading(true);
		setError(undefined);
		try {
			const content = await getGitDiff(path);
			setDiff(content || "（未跟踪的新文件，暂无差异内容）");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
			setDiff(undefined);
		} finally {
			setDiffLoading(false);
		}
	}, []);

	return (
		<div className="source-control">
			<div className="sidebar-section-title">
				<span>更改</span>
				<button className="icon-button compact" type="button" aria-label="刷新更改" onClick={() => void load()}>
					↻
				</button>
			</div>
			{error ? <p className="sidebar-error">{error}</p> : null}
			{loading ? <p className="sidebar-loading">正在读取 Git 状态…</p> : null}
			<div className="change-list">
				{changes.map((change) => (
					<button
						key={change.path}
						className={`change-row ${selectedPath === change.path ? "is-selected" : ""}`}
						type="button"
						onClick={() => void openDiff(change.path)}
					>
						<span className={`change-status ${statusClass(change.status)}`}>{STATUS_LABELS[change.status]}</span>
						<span>{change.path}</span>
					</button>
				))}
				{!loading && !error && changes.length === 0 ? <p className="sidebar-loading">没有未提交的更改。</p> : null}
			</div>
			{selectedPath ? (
				<div className="diff-panel">
					<div className="diff-panel-header">
						<strong>{selectedPath}</strong>
					</div>
					{diffLoading ? (
						<p className="sidebar-loading">正在读取差异…</p>
					) : diff ? (
						<pre className="diff-view">
							<code>
								{diff.split("\n").map((line, index) => (
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
