import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceTrustStore } from "../src/main/workspace-trust-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("WorkspaceTrustStore", () => {
	it("persists trust by workspace hash without storing the raw path", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-desktop-trust-"));
		temporaryDirectories.push(directory);
		const workspacePath = join(directory, "project-a");
		const trustPath = join(directory, "agent", "trusted-workspaces.json");
		const store = new WorkspaceTrustStore(trustPath);

		await store.setTrusted(workspacePath, true);

		expect(await store.isTrusted(workspacePath)).toBe(true);
		expect(await store.isTrusted(join(directory, "project-b"))).toBe(false);
		await expect(readFile(trustPath, "utf8")).resolves.not.toContain(workspacePath);
	});

	it("removes a workspace when trust is revoked", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-desktop-trust-"));
		temporaryDirectories.push(directory);
		const store = new WorkspaceTrustStore(join(directory, "trusted-workspaces.json"));
		const workspacePath = join(directory, "project");

		await store.setTrusted(workspacePath, true);
		await store.setTrusted(workspacePath, false);

		expect(await store.isTrusted(workspacePath)).toBe(false);
	});
});
