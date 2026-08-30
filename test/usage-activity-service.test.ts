import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildUsageActivity } from "../src/main/usage-activity-service.ts";

function entry(value: unknown): SessionEntry {
	return value as SessionEntry;
}

function usage(input: number, output: number, cacheRead: number, cacheWrite: number, cost?: number) {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		...(cost === undefined ? {} : { cost: { total: cost } }),
	};
}

describe("buildUsageActivity", () => {
	it("counts assistant, tool-result, compaction, and branch-summary usage once", () => {
		const day = new Date(2026, 0, 10, 12);
		const timestamp = day.toISOString();
		const result = buildUsageActivity(
			[
				{
					sessionPath: "/sessions/project-a/first.jsonl",
					cwd: "/projects/a",
					entries: [
						entry({
							type: "message",
							id: "assistant-1",
							parentId: null,
							timestamp,
							message: { role: "assistant", usage: usage(10, 4, 3, 2, 0.25) },
						}),
						entry({
							type: "message",
							id: "tool-1",
							parentId: "assistant-1",
							timestamp,
							message: { role: "toolResult", usage: usage(5, 1, 0, 0, 0.05) },
						}),
						entry({
							type: "compaction",
							id: "compact-1",
							parentId: "tool-1",
							timestamp,
							summary: "summary",
							firstKeptEntryId: "assistant-1",
							tokensBefore: 100,
							usage: usage(8, 2, 1, 0, 0.1),
						}),
						entry({
							type: "branch_summary",
							id: "branch-1",
							parentId: "compact-1",
							timestamp,
							fromId: "assistant-1",
							summary: "branch summary",
							usage: usage(2, 1, 4, 0),
						}),
					],
				},
			],
			new Date(2026, 0, 10, 18),
		);

		const bucket = result.buckets.find((item) => item.date === "2026-01-10");
		expect(bucket?.tokens).toEqual({ input: 25, output: 8, cacheRead: 8, cacheWrite: 2, total: 43 });
		expect(bucket?.cost).toBeCloseTo(0.4);
		expect(bucket?.costKnownEvents).toBe(3);
		expect(bucket?.usageEvents).toBe(4);
		expect(result.sessionsWithUsage).toBe(1);
		expect(result.projectsWithUsage).toBe(1);
	});

	it("deduplicates copied fork entries without discarding distinct branch work", () => {
		const timestamp = new Date(2026, 5, 4, 12).toISOString();
		const copied = entry({
			type: "message",
			id: "copied-assistant",
			parentId: null,
			timestamp,
			message: { role: "assistant", usage: usage(100, 20, 0, 0, 1) },
		});
		const result = buildUsageActivity(
			[
				{ sessionPath: "/sessions/a.jsonl", cwd: "/projects/a", entries: [copied] },
				{
					sessionPath: "/sessions/b.jsonl",
					cwd: "/projects/b",
					entries: [
						copied,
						entry({
							type: "message",
							id: "fork-new-work",
							parentId: "copied-assistant",
							timestamp,
							message: { role: "assistant", usage: usage(30, 10, 5, 0, 0.4) },
						}),
					],
				},
			],
			new Date(2026, 5, 4, 18),
		);

		expect(result.tokens).toEqual({ input: 130, output: 30, cacheRead: 5, cacheWrite: 0, total: 165 });
		expect(result.cost).toBeCloseTo(1.4);
		expect(result.usageEvents).toBe(2);
		expect(result.sessionsWithUsage).toBe(2);
		expect(result.projectsWithUsage).toBe(2);
	});

	it("ignores entries outside the selected year and invalid timestamps", () => {
		const result = buildUsageActivity(
			[
				{
					sessionPath: "/sessions/a.jsonl",
					cwd: "/projects/a",
					entries: [
						entry({
							type: "message",
							id: "old",
							parentId: null,
							timestamp: new Date(2024, 0, 1, 12).toISOString(),
							message: { role: "assistant", usage: usage(99, 99, 99, 99, 9) },
						}),
						entry({
							type: "message",
							id: "invalid",
							parentId: "old",
							timestamp: "not-a-timestamp",
							message: { role: "assistant", usage: usage(99, 99, 99, 99, 9) },
						}),
					],
				},
			],
			new Date(2026, 0, 10, 18),
		);

		expect(result.tokens.total).toBe(0);
		expect(result.usageEvents).toBe(0);
		expect(result.buckets).toHaveLength(365);
	});
});
