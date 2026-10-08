import { memo, useState } from "react";
import type { DesktopSessionStats } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";

const RING_SIZE = 14;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CTX_DANGER_PCT = 90;

function formatCompact(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(value);
}

function formatToken(value: number): string {
	return value.toLocaleString();
}

function abbreviatePath(path: string): string {
	const home = path.match(/^\/Users\/[^/]+/u);
	if (home) return `~${path.slice(home[0].length)}`;
	return path;
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Clipboard unavailable.
	}
}

interface ContextUsageRingProps {
	stats: DesktopSessionStats | undefined;
	onToggle: () => void;
}

export const ContextUsageRing = memo(function ContextUsageRing({ stats, onToggle }: ContextUsageRingProps) {
	const { t } = useI18n();
	const usage = stats?.contextUsage;
	const hasUsage = usage !== undefined;
	const percent = usage?.percent ?? null;
	const tooltipParts: string[] = [];

	if (hasUsage && usage) {
		tooltipParts.push(
			percent !== null
				? t("contextPercent", { percent: percent.toFixed(1) })
				: `— / ${formatCompact(usage.contextWindow)}`,
		);
		if (stats && stats.tokens.total > 0) {
			tooltipParts.push(`${formatCompact(stats.tokens.total)} token`);
		}
		if (stats && stats.cost > 0) {
			tooltipParts.push(`$${stats.cost.toFixed(3)}`);
		}
	}

	const pct = percent !== null ? Math.max(0, Math.min(100, percent)) : 0;
	const color = percent === null ? "var(--muted)" : pct >= CTX_DANGER_PCT ? "var(--danger)" : "var(--accent)";
	const filled = RING_CIRCUMFERENCE * (pct / 100);

	return (
		<Button
			variant="bare"
			className={`grid size-[var(--ds-control-size)] place-items-center rounded-[var(--radius-md)] border-0 bg-transparent transition-[background] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] hover:bg-[var(--hover)] disabled:cursor-default ${hasUsage ? "" : "opacity-50"}`}
			disabled={!hasUsage}
			aria-label={tooltipParts.join(" · ") || t("contextUsage")}
			title={tooltipParts.join(" · ") || undefined}
			onClick={() => {
				if (hasUsage) onToggle();
			}}
		>
			<svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
				<circle
					cx={RING_SIZE / 2}
					cy={RING_SIZE / 2}
					r={RING_RADIUS}
					fill="none"
					stroke="var(--overlay-12)"
					strokeWidth={RING_STROKE}
				/>
				<circle
					cx={RING_SIZE / 2}
					cy={RING_SIZE / 2}
					r={RING_RADIUS}
					fill="none"
					stroke={color}
					strokeWidth={RING_STROKE}
					strokeLinecap="round"
					strokeDasharray={`${filled} ${RING_CIRCUMFERENCE - filled}`}
					transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
				/>
			</svg>
		</Button>
	);
});

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);
	return (
		<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
			<span>{label}</span>
			<span
				className={`min-w-0 overflow-hidden text-right text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)] ${mono ? "font-[family-name:var(--font-mono)]" : ""}`}
				title={value}
			>
				{value}
			</span>
			<Button
				size="icon"
				className="compact"
				aria-label={t("copyAria", { label })}
				onClick={() => {
					void copyText(value);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1400);
				}}
			>
				{copied ? "✓" : "⧉"}
			</Button>
		</div>
	);
}

interface SessionStatsPanelProps {
	stats: DesktopSessionStats | undefined;
	sessionId: string | undefined;
	sessionName: string | undefined;
	sessionPath: string | undefined;
	onOpenActivity: () => void;
	onClose: () => void;
}

export const SessionStatsPanel = memo(function SessionStatsPanel({
	stats,
	sessionId,
	sessionName,
	sessionPath,
	onOpenActivity,
	onClose,
}: SessionStatsPanelProps) {
	const { t } = useI18n();
	return (
		<div
			className="absolute top-[calc(100%+6px)] right-0 z-[60] max-h-[min(420px,60vh)] w-[min(680px,calc(100vw-80px))] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 shadow-[var(--shadow-float)]"
			role="dialog"
			aria-label={t("sessionStats")}
		>
			<div className="mb-2 flex items-center justify-between [&>strong]:text-[length:var(--text-md)] [&>strong]:font-semibold [&>strong]:text-[color:var(--text)]">
				<strong>{t("sessionStats")}</strong>
				<Button size="icon" className="compact" type="button" aria-label={t("close")} onClick={onClose}>
					×
				</Button>
			</div>
			{!stats ? (
				<p className="m-0 px-3 py-1 text-[length:var(--text-xs)] text-[color:var(--muted)]">
					{t("loadingSessionStats")}
				</p>
			) : (
				<div className="grid grid-cols-[minmax(200px,1.6fr)_minmax(130px,0.7fr)_minmax(170px,0.9fr)] gap-5">
					<section className="grid min-w-0 content-start gap-1 [&>h4]:mt-0 [&>h4]:mb-[3px] [&>h4]:text-[length:var(--text-xs)] [&>h4]:font-semibold [&>h4]:tracking-[0.06em] [&>h4]:text-[color:var(--muted)] [&>h4]:uppercase">
						<h4>{t("sessionInfo")}</h4>
						{sessionName ? <CopyRow label={t("name")} value={sessionName} mono={false} /> : null}
						{sessionPath ? <CopyRow label={t("file")} value={abbreviatePath(sessionPath)} /> : null}
						{sessionId ? <CopyRow label="ID" value={sessionId} /> : null}
					</section>
					<section className="grid min-w-0 content-start gap-1 [&>h4]:mt-0 [&>h4]:mb-[3px] [&>h4]:text-[length:var(--text-xs)] [&>h4]:font-semibold [&>h4]:tracking-[0.06em] [&>h4]:text-[color:var(--muted)] [&>h4]:uppercase">
						<h4>{t("messages")}</h4>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("user")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.userMessages)}
							</span>
						</div>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("assistant")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.assistantMessages)}
							</span>
						</div>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("toolCalls")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.toolCalls)}
							</span>
						</div>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("toolResults")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.toolResults)}
							</span>
						</div>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("total")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.totalMessages)}
							</span>
						</div>
					</section>
					<section className="grid min-w-0 content-start gap-1 [&>h4]:mt-0 [&>h4]:mb-[3px] [&>h4]:text-[length:var(--text-xs)] [&>h4]:font-semibold [&>h4]:tracking-[0.06em] [&>h4]:text-[color:var(--muted)] [&>h4]:uppercase">
						<h4>Token</h4>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("tokenInput")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.tokens.input)}
							</span>
						</div>
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("tokenOutput")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.tokens.output)}
							</span>
						</div>
						{stats.tokens.cacheRead > 0 ? (
							<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
								<span>{t("cacheRead")}</span>
								<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
									{formatToken(stats.tokens.cacheRead)}
								</span>
							</div>
						) : null}
						{stats.tokens.cacheWrite > 0 ? (
							<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
								<span>{t("cacheWrite")}</span>
								<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
									{formatToken(stats.tokens.cacheWrite)}
								</span>
							</div>
						) : null}
						<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
							<span>{t("total")}</span>
							<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
								{formatToken(stats.tokens.total)}
							</span>
						</div>
						{stats.cost > 0 ? (
							<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
								<span>{t("cost")}</span>
								<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
									${stats.cost.toFixed(4)}
								</span>
							</div>
						) : null}
						{stats.contextUsage ? (
							<div className="grid min-h-[22px] grid-cols-[minmax(0,auto)_minmax(0,1fr)_20px] items-center gap-2 [&>span:first-child]:text-[length:var(--text-sm)] [&>span:first-child]:text-[color:var(--muted)]">
								<span>{t("context")}</span>
								<span className="min-w-0 overflow-hidden text-right font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
									{stats.contextUsage.percent === null ? "—" : `${stats.contextUsage.percent.toFixed(1)}%`} /{" "}
									{formatCompact(stats.contextUsage.contextWindow)}
								</span>
							</div>
						) : null}
					</section>
				</div>
			)}
			<Button
				size="sm"
				className="mt-3.5 w-full rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--hover)] px-2.5 py-[7px] text-left text-[length:var(--text-sm)] font-medium text-[color:var(--text-dim)] transition-[color,background,border-color] duration-150 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border-subtle))] hover:bg-[color-mix(in_srgb,var(--accent)_10%,var(--hover))] hover:text-[color:var(--text)]"
				type="button"
				onClick={onOpenActivity}
			>
				{t("viewTokenActivity")}
			</Button>
		</div>
	);
});
