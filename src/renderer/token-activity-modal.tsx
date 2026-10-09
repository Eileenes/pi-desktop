import { type KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopTokenUsage, DesktopUsageActivity, DesktopUsageActivityBucket } from "../shared/contracts.ts";
import { getUsageActivity } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";

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

const HEATMAP_LEVELS = [
	"bg-[var(--ds-heatmap-empty)]",
	"bg-[color-mix(in_srgb,var(--accent)_22%,var(--ds-heatmap-empty))]",
	"bg-[color-mix(in_srgb,var(--accent)_43%,var(--ds-heatmap-empty))]",
	"bg-[color-mix(in_srgb,var(--accent)_66%,var(--ds-heatmap-empty))]",
	"bg-[var(--accent)]",
] as const;

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
			className="is-wide max-h-[min(82vh,820px)]"
			bodyClassName="grid gap-[var(--space-4)] px-[var(--space-5)] pt-[var(--space-4)] pb-[var(--space-5)]"
			onClose={onClose}
		>
			<div className="flex items-center justify-between gap-[var(--space-3)]">
				<Segmented aria-label={t("tokenActivityViewAria")}>
					{tabs.map((item) => (
						<Segment key={item.id} role="tab" active={view === item.id} onClick={() => setView(item.id)}>
							{item.label}
						</Segment>
					))}
				</Segmented>
				<Button
					size="sm"
					variant="outline"
					disabled={!activity && !error}
					onClick={() => setReloadToken((value) => value + 1)}
				>
					{activity || error ? t("refresh") : t("tokenActivityLoading")}
				</Button>
			</div>
			{error ? (
				<p className="m-0 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--error-text)]">
					{t("tokenActivityLoadError", { error })}
				</p>
			) : null}
			{!activity && !error ? (
				<p className="m-0 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
					{t("tokenActivityLoading")}
				</p>
			) : null}
			{activity ? (
				<>
					<div className="grid grid-cols-4 gap-[var(--space-2)]">
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
						<section className="grid min-w-0 gap-[var(--space-3)] overflow-x-auto pb-0.5" role="tabpanel">
							<div className="relative min-w-[700px] overflow-hidden p-[5px]" ref={heatmapSurfaceRef}>
								<div
									className="grid h-4 min-w-0 gap-[3px] px-px text-[length:var(--text-2xs)] leading-none text-[color:var(--muted)] [&>span]:whitespace-nowrap"
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
									className="grid min-w-0 grid-flow-col grid-rows-[repeat(7,minmax(12px,1fr))] gap-[3px]"
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
														className="aspect-square min-h-3 min-w-0 w-full rounded-[var(--radius-3xs)] border-0 bg-transparent p-0"
														key={`empty-${columnIdentity}-${WEEKDAY_IDS[rowIndex]}`}
													/>
												);
											const isSelected = selected?.date === bucket.date;
											const tokenText = formatToken(bucket.tokens.total, locale);
											return (
												<Button
													variant="bare"
													id={cellId(bucket.date)}
													key={bucket.date}
													tabIndex={isSelected ? 0 : -1}
													className={`aspect-square min-h-3 min-w-0 w-full rounded-[var(--radius-3xs)] border-0 p-0 transition-[outline-color,background] duration-150 ${HEATMAP_LEVELS[intensity(bucket.tokens.total, ceiling)] ?? HEATMAP_LEVELS[0]} ${isSelected ? "relative z-[1] outline outline-2 outline-offset-1 outline-[var(--text)]" : "focus-visible:relative focus-visible:z-[1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--text)]"}`}
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
							<div
								className="flex min-w-[700px] items-center justify-end gap-1 text-[length:var(--text-2xs)] text-[color:var(--muted)] [&>span:first-child]:mr-[3px] [&>span:last-child]:ml-[3px]"
								aria-hidden="true"
							>
								<span>{t("tokenActivityLess")}</span>
								{[0, 1, 2, 3, 4].map((level) => (
									<i key={level} className={`size-3 rounded-[var(--radius-3xs)] ${HEATMAP_LEVELS[level]}`} />
								))}
								<span>{t("tokenActivityMore")}</span>
							</div>
							{displayedDay ? <DayDetails bucket={displayedDay} locale={locale} /> : null}
						</section>
					) : null}
					{view === "weekly" ? (
						<section className="grid min-w-0 gap-[var(--space-3)]" role="tabpanel">
							<div className="flex h-[190px] items-end gap-[3px] border-b border-[var(--border-subtle)] px-0.5 pt-3">
								{weekly.map((week) => {
									const height = weeklyCeiling ? Math.max(3, (week.tokens.total / weeklyCeiling) * 100) : 0;
									return (
										<Button
											variant="bare"
											key={week.start}
											className="max-w-[18px] min-w-[5px] flex-1 cursor-default rounded-t-[var(--radius-3xs)] border-0 bg-[color-mix(in_srgb,var(--accent)_70%,var(--surface-2))] p-0 transition-[background,transform] duration-150 hover:scale-y-[1.03] hover:bg-[var(--accent)] hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-[var(--text)] focus-visible:scale-y-[1.03] focus-visible:bg-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text)]"
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
							<div className="flex justify-between text-[length:var(--text-xs)] text-[color:var(--muted)]">
								<span>{t("tokenActivityWeeklyHint")}</span>
								<strong className="font-[family-name:var(--font-mono)] font-medium text-[color:var(--text-dim)]">
									{formatCompactToken(weeklyCeiling, locale)}
								</strong>
							</div>
						</section>
					) : null}
					{view === "cumulative" ? (
						<section className="grid min-w-0 gap-[var(--space-3)]" role="tabpanel">
							<div className="grid gap-[9px]">
								{monthly.map((month) => {
									const width = monthlyCeiling ? (month.tokens.total / monthlyCeiling) * 100 : 0;
									return (
										<div
											className="grid grid-cols-[74px_minmax(0,1fr)_70px] items-center gap-[var(--space-3)]"
											key={month.month}
										>
											<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
												{new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(
													dateFromKey(`${month.month}-01`),
												)}
											</span>
											<div className="h-2.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--surface-2)]">
												<i
													className="block h-full rounded-[inherit] bg-[color-mix(in_srgb,var(--accent)_70%,var(--surface-2))]"
													style={{ width: `${width}%` }}
												/>
											</div>
											<strong className="text-right font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] font-medium text-[color:var(--text-dim)]">
												{formatCompactToken(month.tokens.total, locale)}
											</strong>
										</div>
									);
								})}
							</div>
							<div className="grid grid-cols-4 gap-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-2)]">
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
					<p className="m-0 text-[length:var(--text-xs)] leading-[1.55] text-[color:var(--muted)]">
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
			className={`absolute z-[2] grid w-[236px] pointer-events-none gap-0.5 whitespace-nowrap rounded-[var(--radius-s)] border border-[color-mix(in_srgb,var(--border-strong)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_94%,black)] px-2.5 py-2 text-[color:var(--text)] shadow-[var(--shadow-float)] ${hoveredDay.placement === "above" ? "-translate-x-1/2 -translate-y-full" : "-translate-x-1/2"}`}
			style={{ left: hoveredDay.left, top: hoveredDay.top }}
		>
			<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
				{formatDay(hoveredDay.bucket.date, locale)}
			</span>
			<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-md)] font-semibold">
				{formatToken(hoveredDay.bucket.tokens.total, locale)} Token
			</strong>
		</output>
	);
}

function ActivityCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid min-w-0 gap-px rounded-[var(--radius-m)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_88%,var(--surface-recessed))] px-3 py-2.5">
			<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">{label}</span>
			<strong className="overflow-hidden font-[family-name:var(--font-mono)] text-[length:var(--text-xl)] font-semibold text-ellipsis whitespace-nowrap text-[color:var(--text)]">
				{value}
			</strong>
			<small className="text-[length:var(--text-xs)] text-[color:var(--muted)]">Token</small>
		</div>
	);
}

function DayDetails({ bucket, locale }: { bucket: DesktopUsageActivityBucket; locale: string }) {
	const { t } = useI18n();
	return (
		<aside
			className="grid min-w-[700px] grid-cols-[minmax(180px,0.8fr)_minmax(0,2fr)] gap-[var(--space-4)] rounded-[var(--radius-m)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] p-3"
			aria-live="polite"
		>
			<div className="grid content-center gap-[3px]">
				<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
					{formatDay(bucket.date, locale)}
				</span>
				<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-lg)] text-[color:var(--text)]">
					{formatToken(bucket.tokens.total, locale)} Token
				</strong>
			</div>
			<dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-[9px]">
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
		<div className="grid gap-px">
			<dt className="text-[length:var(--text-xs)] text-[color:var(--muted)]">{label}</dt>
			<dd className="m-0 font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[color:var(--text-dim)]">
				{value}
			</dd>
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
		<div className="grid gap-px">
			<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">{label}</span>
			<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-md)] font-medium text-[color:var(--text-dim)]">
				{formatCompactToken(value, locale)}
			</strong>
			<small className="text-[length:var(--text-xs)] text-[color:var(--muted)]">{percentage.toFixed(1)}%</small>
		</div>
	);
}
