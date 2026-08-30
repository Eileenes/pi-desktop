import { type KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTokenUsage, DesktopUsageActivity, DesktopUsageActivityBucket } from "../shared/contracts.ts";
import { getUsageActivity } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";

type ActivityView = "daily" | "weekly" | "cumulative";
const WEEKDAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface UsageSummary {
	tokens: DesktopTokenUsage;
	cost: number;
	costKnownEvents: number;
	usageEvents: number;
}

interface WeekSummary extends UsageSummary {
	start: string;
	end: string;
}

interface MonthSummary extends UsageSummary {
	month: string;
}

interface HoveredDay {
	bucket: DesktopUsageActivityBucket;
	left: number;
	top: number;
	placement: "above" | "below";
}

function emptyTokens(): DesktopTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function emptySummary(): UsageSummary {
	return { tokens: emptyTokens(), cost: 0, costKnownEvents: 0, usageEvents: 0 };
}

function addBucket(target: UsageSummary, bucket: DesktopUsageActivityBucket): void {
	target.tokens.input += bucket.tokens.input;
	target.tokens.output += bucket.tokens.output;
	target.tokens.cacheRead += bucket.tokens.cacheRead;
	target.tokens.cacheWrite += bucket.tokens.cacheWrite;
	target.tokens.total += bucket.tokens.total;
	target.cost += bucket.cost;
	target.costKnownEvents += bucket.costKnownEvents;
	target.usageEvents += bucket.usageEvents;
}

function summaryOf(buckets: readonly DesktopUsageActivityBucket[]): UsageSummary {
	const summary = emptySummary();
	for (const bucket of buckets) addBucket(summary, bucket);
	return summary;
}

function dateFromKey(value: string): Date {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function dateRangeLabel(start: string, end: string, locale: string): string {
	const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
	return `${formatter.format(dateFromKey(start))} – ${formatter.format(dateFromKey(end))}`;
}

function formatToken(value: number, locale: string): string {
	return Math.round(value).toLocaleString(locale);
}

function formatCompactToken(value: number, locale: string): string {
	if (value >= 1_000_000_000)
		return `${(value / 1_000_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}B`;
	if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
	if (value >= 1_000) return `${(value / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}K`;
	return formatToken(value, locale);
}

function formatCost(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: value < 1 ? 3 : 2,
	}).format(value);
}

function intensity(value: number, ceiling: number): number {
	if (value <= 0) return 0;
	if (ceiling <= 0) return 1;
	return Math.max(1, Math.min(4, Math.ceil((Math.log1p(value) / Math.log1p(ceiling)) * 4)));
}

function p95(values: readonly number[]): number {
	const nonZero = values.filter((value) => value > 0).sort((left, right) => left - right);
	if (nonZero.length === 0) return 0;
	return nonZero[Math.min(nonZero.length - 1, Math.ceil(nonZero.length * 0.95) - 1)] ?? 0;
}

function heatmapColumns(
	buckets: readonly DesktopUsageActivityBucket[],
): Array<Array<DesktopUsageActivityBucket | undefined>> {
	if (buckets.length === 0) return [];
	const cells: Array<DesktopUsageActivityBucket | undefined> = Array.from(
		{ length: dateFromKey(buckets[0]?.date ?? "1970-01-01").getDay() },
		() => undefined,
	);
	cells.push(...buckets);
	while (cells.length % 7 !== 0) cells.push(undefined);
	return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

function weekSummaries(columns: ReturnType<typeof heatmapColumns>): WeekSummary[] {
	return columns.flatMap((column) => {
		const dates = column.filter((bucket): bucket is DesktopUsageActivityBucket => bucket !== undefined);
		if (dates.length === 0) return [];
		const summary = summaryOf(dates);
		return [{ ...summary, start: dates[0]?.date ?? "", end: dates.at(-1)?.date ?? "" }];
	});
}

function monthSummaries(buckets: readonly DesktopUsageActivityBucket[]): MonthSummary[] {
	const byMonth = new Map<string, MonthSummary>();
	for (const bucket of buckets) {
		const month = bucket.date.slice(0, 7);
		let summary = byMonth.get(month);
		if (!summary) {
			summary = { ...emptySummary(), month };
			byMonth.set(month, summary);
		}
		addBucket(summary, bucket);
	}
	return [...byMonth.values()].slice(-12);
}

function cellId(date: string): string {
	return `token-activity-day-${date}`;
}

function formatDay(date: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(
		dateFromKey(date),
	);
}

interface TokenActivityModalProps {
	onClose: () => void;
}

export const TokenActivityModal = memo(function TokenActivityModal({ onClose }: TokenActivityModalProps) {
	const { language, t } = useI18n();
	const locale = language === "zh-CN" ? "zh-CN" : "en";
	const [view, setView] = useState<ActivityView>("daily");
	const [activity, setActivity] = useState<DesktopUsageActivity>();
	const [error, setError] = useState<string>();
	const [reloadToken, setReloadToken] = useState(0);
	const [selectedDate, setSelectedDate] = useState<string>();
	const [hoveredDay, setHoveredDay] = useState<HoveredDay>();
	const heatmapSurfaceRef = useRef<HTMLDivElement>(null);
	const tabs: Array<{ id: ActivityView; label: string }> = [
		{ id: "daily", label: t("tokenActivityDaily") },
		{ id: "weekly", label: t("tokenActivityWeekly") },
		{ id: "cumulative", label: t("tokenActivityCumulative") },
	];

	useEffect(() => {
		let cancelled = false;
		const refreshGeneration = reloadToken;
		setError(undefined);
		setActivity(undefined);
		void getUsageActivity()
			.then((next) => {
				if (cancelled || refreshGeneration !== reloadToken) return;
				setActivity(next);
				setSelectedDate((current) => current ?? next.to);
			})
			.catch((reason: unknown) => {
				if (cancelled || refreshGeneration !== reloadToken) return;
				setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			cancelled = true;
		};
	}, [reloadToken]);

	const columns = useMemo(() => heatmapColumns(activity?.buckets ?? []), [activity?.buckets]);
	const weekly = useMemo(() => weekSummaries(columns), [columns]);
	const monthly = useMemo(() => monthSummaries(activity?.buckets ?? []), [activity?.buckets]);
	const selected = activity?.buckets.find((bucket) => bucket.date === selectedDate) ?? activity?.buckets.at(-1);
	const displayedDay = hoveredDay?.bucket ?? selected;
	const ceiling = useMemo(
		() => p95((activity?.buckets ?? []).map((bucket) => bucket.tokens.total)),
		[activity?.buckets],
	);
	const weeklyCeiling = useMemo(() => Math.max(...weekly.map((week) => week.tokens.total), 0), [weekly]);
	const monthlyCeiling = useMemo(() => Math.max(...monthly.map((month) => month.tokens.total), 0), [monthly]);
	const today = activity?.buckets.at(-1);
	const sevenDays = activity ? summaryOf(activity.buckets.slice(-7)) : undefined;
	const thirtyDays = activity ? summaryOf(activity.buckets.slice(-30)) : undefined;

	const selectByOffset = (currentDate: string, offset: number): void => {
		const index = activity?.buckets.findIndex((bucket) => bucket.date === currentDate) ?? -1;
		if (!activity || index < 0) return;
		const next = activity.buckets[Math.min(activity.buckets.length - 1, Math.max(0, index + offset))];
		if (!next) return;
		setSelectedDate(next.date);
		window.requestAnimationFrame(() => document.getElementById(cellId(next.date))?.focus());
	};

	const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string): void => {
		const offsets: Partial<Record<string, number>> = {
			ArrowDown: 1,
			ArrowLeft: -7,
			ArrowRight: 7,
			ArrowUp: -1,
		};
		const offset = offsets[event.key];
		if (offset === undefined) return;
		event.preventDefault();
		selectByOffset(date, offset);
	};

	const showHoveredDay = (target: HTMLButtonElement, bucket: DesktopUsageActivityBucket): void => {
		const surface = heatmapSurfaceRef.current;
		if (!surface) return;
		const surfaceBounds = surface.getBoundingClientRect();
		const cellBounds = target.getBoundingClientRect();
		const tooltipHalfWidth = 118;
		const center = cellBounds.left - surfaceBounds.left + cellBounds.width / 2;
		const left = Math.min(surfaceBounds.width - tooltipHalfWidth - 8, Math.max(tooltipHalfWidth + 8, center));
		const top = cellBounds.top - surfaceBounds.top;
		const placement = top < 66 ? "below" : "above";
		setHoveredDay({
			bucket,
			left,
			top: placement === "below" ? cellBounds.bottom - surfaceBounds.top + 8 : top - 8,
			placement,
		});
	};

	return (
		<Modal
			title={t("tokenActivity")}
			subtitle={activity ? t("tokenActivityRange", { from: activity.from, to: activity.to }) : undefined}
			className="token-activity-modal"
			onClose={onClose}
		>
			<div className="token-activity-toolbar">
				<div className="token-activity-tabs" role="tablist" aria-label={t("tokenActivityViewAria")}>
					{tabs.map((item) => (
						<button
							key={item.id}
							type="button"
							role="tab"
							aria-selected={view === item.id}
							className={view === item.id ? "is-active" : ""}
							onClick={() => setView(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
				<button
					className="token-activity-refresh"
					type="button"
					disabled={!activity && !error}
					onClick={() => setReloadToken((value) => value + 1)}
				>
					{activity || error ? t("refresh") : t("tokenActivityLoading")}
				</button>
			</div>
			{error ? <p className="token-activity-state is-error">{t("tokenActivityLoadError", { error })}</p> : null}
			{!activity && !error ? <p className="token-activity-state">{t("tokenActivityLoading")}</p> : null}
			{activity ? (
				<>
					<div className="token-activity-cards">
						<ActivityCard
							label={t("tokenActivityToday")}
							value={formatCompactToken(today?.tokens.total ?? 0, locale)}
						/>
						<ActivityCard
							label={t("tokenActivityLast7Days")}
							value={formatCompactToken(sevenDays?.tokens.total ?? 0, locale)}
						/>
						<ActivityCard
							label={t("tokenActivityLast30Days")}
							value={formatCompactToken(thirtyDays?.tokens.total ?? 0, locale)}
						/>
						<ActivityCard
							label={t("tokenActivityTotal")}
							value={formatCompactToken(activity.tokens.total, locale)}
						/>
					</div>
					{view === "daily" ? (
						<section className="token-activity-daily" role="tabpanel">
							<div className="token-heatmap-surface" ref={heatmapSurfaceRef}>
								<div
									className="token-heatmap-months"
									style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(12px, 1fr))` }}
								>
									{columns.flatMap((column, columnIndex) => {
										const first = column.find(
											(bucket): bucket is DesktopUsageActivityBucket => bucket !== undefined,
										);
										const prior = columns
											.slice(0, columnIndex)
											.flat()
											.findLast((bucket): bucket is DesktopUsageActivityBucket => bucket !== undefined);
										if (!first || first.date.slice(0, 7) === prior?.date.slice(0, 7)) return [];
										return [
											<span key={first.date} style={{ gridColumn: columnIndex + 1 }}>
												{new Intl.DateTimeFormat(locale, { month: "short" }).format(
													dateFromKey(first.date),
												)}
											</span>,
										];
									})}
								</div>
								<div
									className="token-heatmap-grid"
									style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(12px, 1fr))` }}
								>
									{columns.flatMap((column) =>
										column.map((bucket, rowIndex) => {
											const columnIdentity = column
												.filter((item): item is DesktopUsageActivityBucket => item !== undefined)
												.map((item) => item.date)
												.join("-");
											if (!bucket)
												return (
													<span
														className="token-heatmap-spacer"
														key={`empty-${columnIdentity}-${WEEKDAY_IDS[rowIndex]}`}
													/>
												);
											const isSelected = selected?.date === bucket.date;
											const tokenText = formatToken(bucket.tokens.total, locale);
											return (
												<button
													id={cellId(bucket.date)}
													key={bucket.date}
													type="button"
													tabIndex={isSelected ? 0 : -1}
													className={`token-heatmap-cell level-${intensity(bucket.tokens.total, ceiling)}${isSelected ? " is-selected" : ""}`}
													aria-label={t("tokenActivityDayAria", {
														date: formatDay(bucket.date, locale),
														tokens: tokenText,
													})}
													onClick={() => setSelectedDate(bucket.date)}
													onFocus={(event) => showHoveredDay(event.currentTarget, bucket)}
													onBlur={() => setHoveredDay(undefined)}
													onPointerEnter={(event) => showHoveredDay(event.currentTarget, bucket)}
													onPointerLeave={() => setHoveredDay(undefined)}
													onKeyDown={(event) => handleDayKeyDown(event, bucket.date)}
												/>
											);
										}),
									)}
								</div>
								{hoveredDay ? <HoverTooltip hoveredDay={hoveredDay} locale={locale} /> : null}
							</div>
							<div className="token-activity-legend" aria-hidden="true">
								<span>{t("tokenActivityLess")}</span>
								{[0, 1, 2, 3, 4].map((level) => (
									<i key={level} className={`level-${level}`} />
								))}
								<span>{t("tokenActivityMore")}</span>
							</div>
							{displayedDay ? <DayDetails bucket={displayedDay} locale={locale} /> : null}
						</section>
					) : null}
					{view === "weekly" ? (
						<section className="token-activity-weekly" role="tabpanel">
							<div className="token-weekly-chart">
								{weekly.map((week) => {
									const height = weeklyCeiling ? Math.max(3, (week.tokens.total / weeklyCeiling) * 100) : 0;
									return (
										<button
											key={week.start}
											type="button"
											className="token-weekly-bar"
											style={{ height: `${height}%` }}
											aria-label={t("tokenActivityWeekAria", {
												range: dateRangeLabel(week.start, week.end, locale),
												tokens: formatToken(week.tokens.total, locale),
											})}
											title={`${dateRangeLabel(week.start, week.end, locale)} · ${formatToken(week.tokens.total, locale)} Token`}
										/>
									);
								})}
							</div>
							<div className="token-weekly-scale">
								<span>{t("tokenActivityWeeklyHint")}</span>
								<strong>{formatCompactToken(weeklyCeiling, locale)}</strong>
							</div>
						</section>
					) : null}
					{view === "cumulative" ? (
						<section className="token-activity-cumulative" role="tabpanel">
							<div className="token-cumulative-list">
								{monthly.map((month) => {
									const width = monthlyCeiling ? (month.tokens.total / monthlyCeiling) * 100 : 0;
									return (
										<div className="token-cumulative-row" key={month.month}>
											<span>
												{new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(
													dateFromKey(`${month.month}-01`),
												)}
											</span>
											<div className="token-cumulative-track">
												<i style={{ width: `${width}%` }} />
											</div>
											<strong>{formatCompactToken(month.tokens.total, locale)}</strong>
										</div>
									);
								})}
							</div>
							<div className="token-cumulative-breakdown">
								<BreakdownItem
									label={t("tokenInput")}
									value={activity.tokens.input}
									total={activity.tokens.total}
									locale={locale}
								/>
								<BreakdownItem
									label={t("cacheRead")}
									value={activity.tokens.cacheRead}
									total={activity.tokens.total}
									locale={locale}
								/>
								<BreakdownItem
									label={t("tokenOutput")}
									value={activity.tokens.output}
									total={activity.tokens.total}
									locale={locale}
								/>
								<BreakdownItem
									label={t("cacheWrite")}
									value={activity.tokens.cacheWrite}
									total={activity.tokens.total}
									locale={locale}
								/>
							</div>
						</section>
					) : null}
					<p className="token-activity-footnote">
						{t("tokenActivityPrivacy", {
							sessions: activity.sessionsScanned,
							projects: activity.projectsWithUsage,
						})}
						{activity.unreadableSessions > 0
							? ` ${t("tokenActivityUnreadable", { count: activity.unreadableSessions })}`
							: ""}
					</p>
				</>
			) : null}
		</Modal>
	);
});

function HoverTooltip({ hoveredDay, locale }: { hoveredDay: HoveredDay; locale: string }) {
	return (
		<output
			className={`token-heatmap-tooltip is-${hoveredDay.placement}`}
			style={{ left: hoveredDay.left, top: hoveredDay.top }}
		>
			<span>{formatDay(hoveredDay.bucket.date, locale)}</span>
			<strong>{formatToken(hoveredDay.bucket.tokens.total, locale)} Token</strong>
		</output>
	);
}

function ActivityCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="token-activity-card">
			<span>{label}</span>
			<strong>{value}</strong>
			<small>Token</small>
		</div>
	);
}

function DayDetails({ bucket, locale }: { bucket: DesktopUsageActivityBucket; locale: string }) {
	const { t } = useI18n();
	return (
		<aside className="token-day-details" aria-live="polite">
			<div>
				<span>{formatDay(bucket.date, locale)}</span>
				<strong>{formatToken(bucket.tokens.total, locale)} Token</strong>
			</div>
			<dl>
				<DetailItem label={t("tokenInput")} value={formatToken(bucket.tokens.input, locale)} />
				<DetailItem label={t("cacheRead")} value={formatToken(bucket.tokens.cacheRead, locale)} />
				<DetailItem label={t("tokenOutput")} value={formatToken(bucket.tokens.output, locale)} />
				<DetailItem label={t("cacheWrite")} value={formatToken(bucket.tokens.cacheWrite, locale)} />
				{bucket.costKnownEvents > 0 ? (
					<DetailItem label={t("cost")} value={formatCost(bucket.cost, locale)} />
				) : null}
				<DetailItem label={t("tokenActivitySessions")} value={String(bucket.sessionCount)} />
			</dl>
		</aside>
	);
}

function DetailItem({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function BreakdownItem({
	label,
	value,
	total,
	locale,
}: {
	label: string;
	value: number;
	total: number;
	locale: string;
}) {
	const percentage = total ? (value / total) * 100 : 0;
	return (
		<div>
			<span>{label}</span>
			<strong>{formatCompactToken(value, locale)}</strong>
			<small>{percentage.toFixed(1)}%</small>
		</div>
	);
}
