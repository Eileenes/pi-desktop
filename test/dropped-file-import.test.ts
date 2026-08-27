import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importDroppedFiles } from "../src/main/dropped-file-import.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function createFixture(): Promise<{ sourcePath: string; workspacePath: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-desktop-drop-"));
	temporaryDirectories.push(directory);
	const workspacePath = join(directory, "workspace");
	const sourcePath = join(directory, "example.txt");
	await mkdir(workspacePath);
	await writeFile(sourcePath, "incoming\n");
	return { sourcePath, workspacePath };
}

describe("importDroppedFiles", () => {
	it("copies a new file into the workspace root", async () => {
		const { sourcePath, workspacePath } = await createFixture();

		await expect(importDroppedFiles(workspacePath, [sourcePath])).resolves.toEqual([{ name: "example.txt" }]);
		await expect(readFile(join(workspacePath, "example.txt"), "utf8")).resolves.toBe("incoming\n");
	});

	it("skips a same-name file without overwriting existing contents", async () => {
		const { sourcePath, workspacePath } = await createFixture();
		await writeFile(join(workspacePath, "example.txt"), "existing\n");

		await expect(importDroppedFiles(workspacePath, [sourcePath])).resolves.toEqual([
			{ name: "example.txt", conflict: true, error: "同名文件已存在，已跳过。" },
		]);
		await expect(readFile(join(workspacePath, "example.txt"), "utf8")).resolves.toBe("existing\n");
	});

	it("replaces a same-name file only when explicitly requested", async () => {
		const { sourcePath, workspacePath } = await createFixture();
		await writeFile(join(workspacePath, "example.txt"), "existing\n");

		await expect(importDroppedFiles(workspacePath, [sourcePath], true)).resolves.toEqual([{ name: "example.txt" }]);
		await expect(readFile(join(workspacePath, "example.txt"), "utf8")).resolves.toBe("incoming\n");
	});
});
