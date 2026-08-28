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

function createStoredZip(name: string, content: string): Buffer {
	const nameBuffer = Buffer.from(name);
	const contentBuffer = Buffer.from(content);
	const local = Buffer.alloc(30 + nameBuffer.length + contentBuffer.length);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0, 6);
	local.writeUInt16LE(0, 8);
	local.writeUInt32LE(contentBuffer.length, 18);
	local.writeUInt32LE(contentBuffer.length, 22);
	local.writeUInt16LE(nameBuffer.length, 26);
	nameBuffer.copy(local, 30);
	contentBuffer.copy(local, 30 + nameBuffer.length);
	const central = Buffer.alloc(46 + nameBuffer.length);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0, 8);
	central.writeUInt32LE(contentBuffer.length, 20);
	central.writeUInt32LE(contentBuffer.length, 24);
	central.writeUInt16LE(nameBuffer.length, 28);
	central.writeUInt32LE(0, 42);
	nameBuffer.copy(central, 46);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(central.length, 12);
	eocd.writeUInt32LE(local.length, 16);
	return Buffer.concat([local, central, eocd]);
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

	it("returns a PDF as an isolated data URL preview", async () => {
		const { workspacePath } = await createWorkspace();
		await writeFile(join(workspacePath, "sample.pdf"), Buffer.from("%PDF-1.4\n"));

		await expect(new TrustedWorkspaceBrowser(workspacePath).read("sample.pdf")).resolves.toEqual({
			path: "sample.pdf",
			content: "",
			pdfDataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
			binaryDataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
		});
	});

	it("renders DOCX paragraphs without executing document content", async () => {
		const { workspacePath } = await createWorkspace();
		const documentXml =
			'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>';
		await writeFile(join(workspacePath, "sample.docx"), createStoredZip("word/document.xml", documentXml));

		await expect(new TrustedWorkspaceBrowser(workspacePath).read("sample.docx")).resolves.toMatchObject({
			path: "sample.docx",
			content: "",
			docxHtml: "<p>Hello</p><p>World</p>",
		});
	});

	it("searches beyond the compact file listing limit", async () => {
		const { workspacePath } = await createWorkspace();
		await writeFile(join(workspacePath, "needle-not-in-first-page.txt"), "found\n");

		await expect(new TrustedWorkspaceBrowser(workspacePath).search("needle")).resolves.toEqual([
			{ path: "needle-not-in-first-page.txt", name: "needle-not-in-first-page.txt", type: "file", depth: 0 },
		]);
	});
});
