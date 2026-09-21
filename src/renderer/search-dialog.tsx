import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopSessionInfo } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";

/*
 * Session search, as a dialog rather than a field in the sidebar.
 *
 * The reference keeps its sidebar header a single 46px strip and owns search
 * with a floating dialog, so the sidebar never carries a second row of chrome.
 * Results are grouped by project, which is the grouping the sidebar list uses,
 * and the whole surface is keyboard driven from the field: arrows walk the
 * hits, Enter opens one, Escape closes.
 */

interface SearchHit {
	session: DesktopSessionInfo;
	title: string;
	snippet: string;
	index: number;
}

interface SearchGroup {
	project: string;
	hits: SearchHit[];
}

/** Trailing path segment: what a project is called in the sidebar. */
function projectLabel(session: DesktopSessionInfo): string {
	const root = (session.projectRoot ?? session.cwd ?? "").replace(/[\\/]+$/u, "");
	const segments = root.split(/[\\/]+/u).filter(Boolean);
	return segments[segments.length - 1] ?? root;
}

export const SearchDialog = memo(function SearchDialog({
	sessions,
	onOpenSession,
	onClose,
}: {
	sessions: DesktopSessionInfo[];
	onOpenSession: (session: DesktopSessionInfo) => void;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const { groups, hits } = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		const byProject = new Map<string, SearchHit[]>();
		const ordered: SearchHit[] = [];
		for (const session of sessions) {
			const haystack = `${session.name ?? ""} ${session.firstMessage}`.toLocaleLowerCase();
			if (needle && !haystack.includes(needle)) continue;
			const project = projectLabel(session);
			const hit: SearchHit = {
				session,
				title: session.name?.trim() || session.firstMessage.trim() || session.id,
				snippet: session.firstMessage.trim(),
				index: ordered.length,
			};
			ordered.push(hit);
			const bucket = byProject.get(project);
			if (bucket) bucket.push(hit);
			else byProject.set(project, [hit]);
		}
		const grouped: SearchGroup[] = [...byProject.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([project, projectHits]) => ({ project, hits: projectHits }));
		return { groups: grouped, hits: ordered };
	}, [query, sessions]);

	const open = (hit: SearchHit | undefined) => {
		if (!hit) return;
		onOpenSession(hit.session);
		onClose();
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭搜索对话框是标准交互
		<div
			className="search-overlay"
			role="presentation"
			onClick={(event) => {
				// Only a click on the scrim dismisses; the dialog owns the rest.
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="search-dialog" role="dialog" aria-modal="true" aria-label={t("searchSessionsAria")}>
				<div className="search-input-row">
					<Icon name="search" size={15} />
					<input
						ref={inputRef}
						className="search-input"
						value={query}
						placeholder={t("searchSessions")}
						aria-label={t("searchSessionsAria")}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								onClose();
								return;
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActive((current) => Math.min(current + 1, Math.max(hits.length - 1, 0)));
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setActive((current) => Math.max(current - 1, 0));
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								open(hits[active]);
							}
						}}
					/>
					<button className="search-close" type="button" aria-label={t("close")} onClick={onClose}>
						Esc
					</button>
				</div>
				<div className="search-results">
					{groups.length ? (
						groups.map((group) => (
							<div key={group.project}>
								<div className="search-group-label">{group.project}</div>
								{group.hits.map((hit) => (
									<button
										key={hit.session.id}
										className={`search-item${hit.index === active ? " is-active" : ""}`}
										type="button"
										onMouseEnter={() => setActive(hit.index)}
										onClick={() => open(hit)}
									>
										<Icon name="history" size={15} />
										<span className="search-item-title">{hit.title}</span>
										{hit.snippet && hit.snippet !== hit.title ? (
											<span className="search-item-meta">{hit.snippet}</span>
										) : null}
									</button>
								))}
							</div>
						))
					) : (
						<p className="search-empty">{t("noMatchingSessions")}</p>
					)}
				</div>
			</div>
		</div>
	);
});
