import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { DesktopTokenUsage, DesktopUsageActivity, DesktopUsageActivityBucket } from "../shared/contracts.ts";
import { listIndexedSessions } from "./session-index.ts";

const ACTIVITY_DAYS = 365;

interface UsageSource {
	sessionPath: string;
	cwd: string;
	entries: readonly SessionEntry[];
}

interface MutableUsageBucket {
	date: string;
	tokens: DesktopTokenUsage;
	cost: number;
	costKnownEvents: number;
	usageEvents: number;
	sessionPaths: Set<string>;
}

interface NormalizedUsage {
	tokens: DesktopTokenUsage;
	cost: number;
	costKnown: boolean;
}

function emptyTokens(): DesktopTokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addTokens(target: DesktopTokenUsage, source: DesktopTokenUsage): void {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.total += source.total;
}

function normalizeUsage(value: unknown): NormalizedUsage | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const usage = value as Record<string, unknown>;
	const input = numberOrZero(usage.input);
	const output = numberOrZero(usage.output);
	const cacheRead = numberOrZero(usage.cacheRead);
	const cacheWrite = numberOrZero(usage.cacheWrite);
	const rawCost =
		typeof usage.cost === "object" && usage.cost !== null && !Array.isArray(usage.cost)
			? (usage.cost as Record<string, unknown>).total
			: undefined;
	const costKnown = typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0;
	const tokens = {
		input,
		output,
		cacheRead,
		cacheWrite,
		total: input + output + cacheRead + cacheWrite,
	};
	return { tokens, cost: costKnown ? rawCost : 0, costKnown };
}

function usageForEntry(entry: SessionEntry): NormalizedUsage | undefined {
	if (entry.type === "compaction" || entry.type === "branch_summary") return normalizeUsage(entry.usage);
	if (entry.type !== "message") return undefined;
	if (entry.message.role !== "assistant" && entry.message.role !== "toolResult") return undefined;
	return "usage" in entry.message ? normalizeUsage(entry.message.usage) : undefined;
}

function activityRange(now: Date, days: number): Array<{ date: string; startAt: number }> {
	const date = new Date(now);
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() - (days - 1));
	return Array.from({ length: days }, () => {
		const value = { date: localDateKey(date), startAt: date.getTime() };
		date.setDate(date.getDate() + 1);
		return value;
	});
}

function toPublicBucket(bucket: MutableUsageBucket): DesktopUsageActivityBucket {
	return {
		date: bucket.date,
		tokens: bucket.tokens,
		cost: bucket.cost,
		costKnownEvents: bucket.costKnownEvents,
		usageEvents: bucket.usageEvents,
		sessionCount: bucket.sessionPaths.size,
	};
}

/**
 * Builds a 365-day local-calendar activity report. Usage is deduplicated by
 * Pi's immutable entry id plus timestamp so a copied fork does not inflate
 * historical usage, while distinct work on separate branches is retained.
 */
export function buildUsageActivity(
	sources: readonly UsageSource[],
	now = new Date(),
	days = ACTIVITY_DAYS,
	unreadableSessions = 0,
): DesktopUsageActivity {
	const range = activityRange(now, days);
	const buckets = new Map<string, MutableUsageBucket>(
		range.map(({ date }) => [
			date,
			{ date, tokens: emptyTokens(), cost: 0, costKnownEvents: 0, usageEvents: 0, sessionPaths: new Set<string>() },
		]),
	);
	const seenEvents = new Set<string>();
	const sessionPathsWithUsage = new Set<string>();
	const projectsWithUsage = new Set<string>();
	const totals = emptyTokens();
	let cost = 0;
	let costKnownEvents = 0;
	let usageEvents = 0;

	for (const source of sources) {
		for (const entry of source.entries) {
			const usage = usageForEntry(entry);
			if (!usage) continue;
			const timestamp = new Date(entry.timestamp);
			if (Number.isNaN(timestamp.getTime())) continue;
			const bucket = buckets.get(localDateKey(timestamp));
			if (!bucket) continue;
			const eventKey = `${entry.id}\u0000${entry.timestamp}`;
			if (seenEvents.has(eventKey)) continue;
			seenEvents.add(eventKey);
			addTokens(bucket.tokens, usage.tokens);
			bucket.cost += usage.cost;
			bucket.costKnownEvents += Number(usage.costKnown);
			bucket.usageEvents += 1;
			bucket.sessionPaths.add(source.sessionPath);
			addTokens(totals, usage.tokens);
			cost += usage.cost;
			costKnownEvents += Number(usage.costKnown);
			usageEvents += 1;
			sessionPathsWithUsage.add(source.sessionPath);
			projectsWithUsage.add(source.cwd);
		}
	}

	return {
		from: range[0]?.date ?? localDateKey(now),
		to: range.at(-1)?.date ?? localDateKey(now),
		generatedAt: now.getTime(),
		buckets: range.map(({ date }) => toPublicBucket(buckets.get(date)!)),
		tokens: totals,
		cost,
		costKnownEvents,
		usageEvents,
		sessionsScanned: sources.length,
		sessionsWithUsage: sessionPathsWithUsage.size,
		projectsWithUsage: projectsWithUsage.size,
		unreadableSessions,
	};
}

/** Reads persisted Pi sessions only when the usage view is requested. */
export async function getUsageActivity(agentDir: string): Promise<DesktopUsageActivity> {
	let sessions: Awaited<ReturnType<typeof listIndexedSessions>>;
	try {
		sessions = await listIndexedSessions(agentDir);
	} catch {
		return buildUsageActivity([], new Date(), ACTIVITY_DAYS, 1);
	}

	const sources: UsageSource[] = [];
	let unreadableSessions = 0;
	for (const session of sessions) {
		try {
			sources.push({
				sessionPath: session.path,
				cwd: session.cwd,
				entries: SessionManager.open(session.path).getEntries(),
			});
		} catch {
			unreadableSessions += 1;
		}
	}
	return buildUsageActivity(sources, new Date(), ACTIVITY_DAYS, unreadableSessions);
}
