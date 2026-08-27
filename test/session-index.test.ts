import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listIndexedSessions } from "../src/main/session-index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("listIndexedSessions", () => {
	it("discovers persisted sessions across project directories", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "pi-desktop-session-index-"));
		temporaryDirectories.push(agentDir);
		const firstDirectory = join(agentDir, "sessions", "project-a");
		const secondDirectory = join(agentDir, "sessions", "project-b");
		await mkdir(firstDirectory, { recursive: true });
		await mkdir(secondDirectory, { recursive: true });
		await writeFile(
			join(firstDirectory, "first.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: "first", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/projects/a" })}\n`,
		);
		await writeFile(
			join(secondDirectory, "second.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: "second", timestamp: "2026-01-02T00:00:00.000Z", cwd: "/projects/b" })}\n`,
		);

		const sessions = await listIndexedSessions(agentDir);

		expect(sessions.map((session) => session.id).sort()).toEqual(["first", "second"]);
		expect(sessions.map((session) => session.cwd).sort()).toEqual(["/projects/a", "/projects/b"]);
	});

	it("returns an empty index before the sessions directory exists", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "pi-desktop-session-index-"));
		temporaryDirectories.push(agentDir);

		await expect(listIndexedSessions(agentDir)).resolves.toEqual([]);
	});
});
