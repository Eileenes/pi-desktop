import { memo } from "react";
import type { DesktopSessionStats } from "../shared/contracts.ts";

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

interface ContextUsageRingProps {
	stats: DesktopSessionStats | undefined;
	onToggle: () => void;
}

export const ContextUsageRing = memo(function ContextUsageRing({ stats, onToggle }: ContextUsageRingProps) {
	const usage = stats?.contextUsage;
	const hasUsage = usage !== undefined;
	const percent = usage?.percent ?? null;
	const tooltipParts: string[] = [];

	if (hasUsage && usage) {
		tooltipParts.push(
			percent !== null ? `${percent.toFixed(1)}% 上下文` : `— / ${formatCompact(usage.contextWindow)}`,
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
		<button
			className={`context-ring ${!hasUsage ? "is-inert" : ""}`}
			type="button"
			aria-label={tooltipParts.join(" · ") || "上下文用量"}
			title={tooltipParts.join(" · ")}
			onClick={onToggle}
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
		</button>
	);
});

interface SessionStatsPanelProps {
	stats: DesktopSessionStats | undefined;
	onClose: () => void;
}

export const SessionStatsPanel = memo(function SessionStatsPanel({ stats, onClose }: SessionStatsPanelProps) {
	const rows: Array<[string, string]> = [];
	if (stats) {
		rows.push(["用户消息", String(stats.userMessages)]);
		rows.push(["助手消息", String(stats.assistantMessages)]);
		rows.push(["工具调用", String(stats.toolCalls)]);
		rows.push(["工具结果", String(stats.toolResults)]);
		rows.push(["消息总数", String(stats.totalMessages)]);
		rows.push(["输入 token", formatToken(stats.tokens.input)]);
		rows.push(["输出 token", formatToken(stats.tokens.output)]);
		if (stats.tokens.cacheRead > 0) rows.push(["缓存读取", formatToken(stats.tokens.cacheRead)]);
		if (stats.tokens.cacheWrite > 0) rows.push(["缓存写入", formatToken(stats.tokens.cacheWrite)]);
		rows.push(["token 总数", formatToken(stats.tokens.total)]);
		if (stats.contextUsage) {
			rows.push([
				"上下文",
				`${stats.contextUsage.percent === null ? "—" : `${stats.contextUsage.percent.toFixed(1)}%`} / ${formatCompact(stats.contextUsage.contextWindow)}`,
			]);
		}
		rows.push(["成本", `$${stats.cost.toFixed(3)}`]);
	}

	return (
		<div className="stats-popover" role="dialog" aria-label="会话统计">
			<div className="stats-popover-header">
				<strong>会话统计</strong>
				<button className="icon-button compact" type="button" aria-label="关闭" onClick={onClose}>
					×
				</button>
			</div>
			{stats ? (
				<div className="stats-table">
					{rows.map(([label, value]) => (
						<div className="stats-row" key={label}>
							<span>{label}</span>
							<strong>{value}</strong>
						</div>
					))}
				</div>
			) : (
				<p className="stats-empty">暂无会话统计。</p>
			)}
		</div>
	);
});
