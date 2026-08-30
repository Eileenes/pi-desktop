import { memo, useState } from "react";
import type { DesktopSessionStats } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";

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
		<button
			className={`context-ring ${!hasUsage ? "is-inert" : ""}`}
			type="button"
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
		</button>
	);
});

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);
	return (
		<div className="stats-info-row">
			<span>{label}</span>
			<span className={`stats-info-value ${mono ? "is-mono" : ""}`} title={value}>
				{value}
			</span>
			<button
				aria-label={t("copyAria", { label })}
				className="stats-copy-button"
				type="button"
				onClick={() => {
					void copyText(value);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1400);
				}}
			>
				{copied ? "✓" : "⧉"}
			</button>
		</div>
	);
}

interface SessionStatsPanelProps {
	stats: DesktopSessionStats | undefined;
	sessionId: string | undefined;
	sessionName: string | undefined;
	sessionPath: string | undefined;
	onClose: () => void;
}

export const SessionStatsPanel = memo(function SessionStatsPanel({
	stats,
	sessionId,
	sessionName,
	sessionPath,
	onClose,
}: SessionStatsPanelProps) {
	const { t } = useI18n();
	return (
		<div className="session-info-popover" role="dialog" aria-label={t("sessionStats")}>
			<div className="session-info-header">
				<strong>{t("sessionStats")}</strong>
				<button className="icon-button compact" type="button" aria-label={t("close")} onClick={onClose}>
					×
				</button>
			</div>
			{!stats ? (
				<p className="stats-empty">{t("loadingSessionStats")}</p>
			) : (
				<div className="session-info-grid">
					<section className="session-info-section">
						<h4>{t("sessionInfo")}</h4>
						{sessionName ? <CopyRow label={t("name")} value={sessionName} mono={false} /> : null}
						{sessionPath ? <CopyRow label={t("file")} value={abbreviatePath(sessionPath)} /> : null}
						{sessionId ? <CopyRow label="ID" value={sessionId} /> : null}
					</section>
					<section className="session-info-section">
						<h4>{t("messages")}</h4>
						<div className="stats-info-row">
							<span>{t("user")}</span>
							<span className="stats-info-value">{formatToken(stats.userMessages)}</span>
						</div>
						<div className="stats-info-row">
							<span>{t("assistant")}</span>
							<span className="stats-info-value">{formatToken(stats.assistantMessages)}</span>
						</div>
						<div className="stats-info-row">
							<span>{t("toolCalls")}</span>
							<span className="stats-info-value">{formatToken(stats.toolCalls)}</span>
						</div>
						<div className="stats-info-row">
							<span>{t("toolResults")}</span>
							<span className="stats-info-value">{formatToken(stats.toolResults)}</span>
						</div>
						<div className="stats-info-row">
							<span>{t("total")}</span>
							<span className="stats-info-value">{formatToken(stats.totalMessages)}</span>
						</div>
					</section>
					<section className="session-info-section">
						<h4>Token</h4>
						<div className="stats-info-row">
							<span>{t("tokenInput")}</span>
							<span className="stats-info-value">{formatToken(stats.tokens.input)}</span>
						</div>
						<div className="stats-info-row">
							<span>{t("tokenOutput")}</span>
							<span className="stats-info-value">{formatToken(stats.tokens.output)}</span>
						</div>
						{stats.tokens.cacheRead > 0 ? (
							<div className="stats-info-row">
								<span>{t("cacheRead")}</span>
								<span className="stats-info-value">{formatToken(stats.tokens.cacheRead)}</span>
							</div>
						) : null}
						{stats.tokens.cacheWrite > 0 ? (
							<div className="stats-info-row">
								<span>{t("cacheWrite")}</span>
								<span className="stats-info-value">{formatToken(stats.tokens.cacheWrite)}</span>
							</div>
						) : null}
						<div className="stats-info-row">
							<span>{t("total")}</span>
							<span className="stats-info-value">{formatToken(stats.tokens.total)}</span>
						</div>
						{stats.cost > 0 ? (
							<div className="stats-info-row">
								<span>{t("cost")}</span>
								<span className="stats-info-value">${stats.cost.toFixed(4)}</span>
							</div>
						) : null}
						{stats.contextUsage ? (
							<div className="stats-info-row">
								<span>{t("context")}</span>
								<span className="stats-info-value">
									{stats.contextUsage.percent === null ? "—" : `${stats.contextUsage.percent.toFixed(1)}%`} /{" "}
									{formatCompact(stats.contextUsage.contextWindow)}
								</span>
							</div>
						) : null}
					</section>
				</div>
			)}
		</div>
	);
});
