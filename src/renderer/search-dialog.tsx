import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopSessionInfo } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";

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
		<Modal
			title={t("searchSessionsAria")}
			hideHeader
			align="start"
			className="w-[min(100%,620px)] max-h-[min(460px,100%)]"
			bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
			onClose={onClose}
		>
			<div className="flex shrink-0 items-center gap-2.5 px-4 pt-3.5 pb-2 text-[color:var(--ds-text-muted)]">
				<Icon name="search" size={15} />
				<Field
					ref={inputRef}
					className="min-h-0 bg-transparent p-0 text-[length:var(--text-base-plus)] shadow-none"
					value={query}
					placeholder={t("searchSessions")}
					aria-label={t("searchSessionsAria")}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={(event) => {
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
				<Button size="sm" type="button" aria-label={t("close")} onClick={onClose}>
					Esc
				</Button>
			</div>
			<div className="min-h-0 overflow-y-auto p-1.5">
				{groups.length ? (
					groups.map((group) => (
						<div key={group.project}>
							<div className="px-2.5 pt-2.5 pb-1 text-[length:var(--text-2xs)] font-medium text-[color:var(--ds-text-muted)]">
								{group.project}
							</div>
							{group.hits.map((hit) => (
								<Button
									variant="bare"
									key={hit.session.id}
									className={`flex w-full items-center gap-2.5 rounded-[var(--radius-md-plus)] px-2.5 py-2 text-left text-[length:var(--text-md-plus)] leading-[var(--leading-compact)] ${hit.index === active ? "bg-[var(--ds-bg-hover)] text-[color:var(--ds-text-primary)]" : "text-[color:var(--ds-text-secondary)]"}`}
									onMouseEnter={() => setActive(hit.index)}
									onClick={() => open(hit)}
								>
									<span className="shrink-0 text-[color:var(--ds-text-muted)]">
										<Icon name="history" size={15} />
									</span>
									<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
										{hit.title}
									</span>
									{hit.snippet && hit.snippet !== hit.title ? (
										<span className="max-w-[45%] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[length:var(--text-sm)] text-[color:var(--ds-text-muted)]">
											{hit.snippet}
										</span>
									) : null}
								</Button>
							))}
						</div>
					))
				) : (
					<p className="m-0 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)]">
						{t("noMatchingSessions")}
					</p>
				)}
			</div>
		</Modal>
	);
});
