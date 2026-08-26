import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TrustedWorkspaceBrowser } from "../src/main/trusted-workspace-browser.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function createWorkspace(): Promise<{ workspacePath: string; outsideFilePath: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-desktop-browser-"));
	temporaryDirectories.push(directory);
	const workspacePath = join(directory, "workspace");
	const outsideFilePath = join(directory, "outside.txt");
	await mkdir(join(workspacePath, "src"), { recursive: true });
	await mkdir(join(workspacePath, ".git"), { recursive: true });
	await mkdir(join(workspacePath, "node_modules", "package"), { recursive: true });
	await writeFile(join(workspacePath, "src", "main.ts"), "export const answer = 42;\n");
	await writeFile(join(workspacePath, ".git", "config"), "private git metadata\n");
	await writeFile(join(workspacePath, "node_modules", "package", "index.js"), "ignored\n");
	await writeFile(outsideFilePath, "outside\n");
	return { workspacePath, outsideFilePath };
}

describe("TrustedWorkspaceBrowser", () => {
	it("lists regular project files while excluding protected directories and symlinks", async () => {
		const { workspacePath, outsideFilePath } = await createWorkspace();
		await symlink(outsideFilePath, join(workspacePath, "outside-link.txt"));

		const entries = await new TrustedWorkspaceBrowser(workspacePath).list();

		expect(entries).toEqual([
			{ path: "src", name: "src", type: "directory", depth: 0 },
			{ path: "src/main.ts", name: "main.ts", type: "file", depth: 1 },
		]);
	});

	it("reads a small text file but rejects paths outside the workspace", async () => {
		const { workspacePath } = await createWorkspace();
		const browser = new TrustedWorkspaceBrowser(workspacePath);

		await expect(browser.read("src/main.ts")).resolves.toEqual({
			path: "src/main.ts",
			content: "export const answer = 42;\n",
		});
		await expect(browser.read("../outside.txt")).rejects.toThrow("必须位于所选项目目录内");
		await expect(browser.read(".git/config")).rejects.toThrow("受保护项目路径");
	});
});
