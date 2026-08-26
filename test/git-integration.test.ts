import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getGitDiff, listGitChanges } from "../src/main/git-integration.ts";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function createRepository(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-desktop-git-"));
	cleanup.push(directory);
	await execFileAsync("git", ["init", "-q"], { cwd: directory });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
	await execFileAsync("git", ["config", "user.name", "Test"], { cwd: directory });
	await writeFile(join(directory, "tracked.txt"), "before\n");
	await execFileAsync("git", ["add", "tracked.txt"], { cwd: directory });
	await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: directory });
	return directory;
}

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("git integration", () => {
	it("includes staged and unstaged changes against HEAD", async () => {
		const directory = await createRepository();
		await writeFile(join(directory, "tracked.txt"), "staged\n");
		await execFileAsync("git", ["add", "tracked.txt"], { cwd: directory });
		await writeFile(join(directory, "tracked.txt"), "staged\nunstaged\n");
		const changes = await listGitChanges(directory);
		expect(changes).toContainEqual({ path: "tracked.txt", status: "modified" });
		const diff = await getGitDiff(directory, "tracked.txt", false);
		expect(diff).toContain("+staged");
		expect(diff).toContain("+unstaged");
	});

	it("renders an untracked file as a new-file diff", async () => {
		const directory = await createRepository();
		await writeFile(join(directory, "new.txt"), "new content\n");
		const diff = await getGitDiff(directory, "new.txt", true);
		expect(diff).toContain("new file mode");
		expect(diff).toContain("+new content");
		expect(await readFile(join(directory, "new.txt"), "utf8")).toBe("new content\n");
	});
});
