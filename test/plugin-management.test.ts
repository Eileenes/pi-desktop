import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopAgentHost } from "../src/main/desktop-agent-host.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DesktopAgentHost plugin management", () => {
	it("resolves the plugin inventory without an active session", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "pi-plugin-management-test-"));
		temporaryDirectories.push(agentDir);
		const host = new DesktopAgentHost(agentDir);

		await expect(host.getPluginPackages()).resolves.toEqual({
			packages: [],
			diagnostics: [],
			hasActiveSession: false,
			projectResourcesLoaded: false,
		});
	});

	it("preserves configured package fields when disabling and flushes the change", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "pi-plugin-management-test-"));
		temporaryDirectories.push(agentDir);
		const source = "/tmp/example-pi-plugin";
		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({
				packages: [
					{
						source,
						autoload: true,
						extensions: ["src/*.ts"],
						skills: ["skills/*"],
						prompts: ["prompts/*"],
						themes: ["themes/*"],
					},
				],
			}),
			"utf8",
		);
		const host = new DesktopAgentHost(agentDir);
		try {
			await host.initialize();
			await host.togglePlugin(source, false, false);
		} finally {
			await host.dispose();
		}

		const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
			packages?: Array<Record<string, unknown>>;
		};
		expect(settings.packages?.[0]).toMatchObject({
			source,
			autoload: true,
			extensions: [],
			skills: [],
			prompts: [],
			themes: [],
		});
	});
});
