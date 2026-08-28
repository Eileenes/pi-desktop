import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { shell } from "electron";
import mammoth from "mammoth";
import type {
	DesktopWorkspaceDirectoryListing,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFilePreview,
} from "../shared/contracts.ts";

const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const MAX_DIRECTORY_DEPTH = 4;
const MAX_ENTRIES = 600;
const MAX_SEARCH_ENTRIES = 5_000;
const MAX_SEARCH_DEPTH = 8;
const MAX_DIRECTORY_LISTING_ENTRIES = 2_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

const AUDIO_MIME_TYPES: Record<string, string> = {
	aac: "audio/aac",
	flac: "audio/flac",
	m4a: "audio/mp4",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/opus",
	wav: "audio/wav",
	weba: "audio/webm",
	webm: "audio/webm",
};

const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const PDF_MAX_BYTES = 20 * 1024 * 1024;
const DOCX_MAX_BYTES = 10 * 1024 * 1024;

function imageMimeType(path: string): string | undefined {
	const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
	return IMAGE_MIME_TYPES[extension];
}

function audioMimeType(path: string): string | undefined {
	const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
	return AUDIO_MIME_TYPES[extension];
}

function isWithinWorkspace(workspacePath: string, candidatePath: string): boolean {
	const pathFromWorkspace = relative(workspacePath, candidatePath);
	return pathFromWorkspace !== "" && !pathFromWorkspace.startsWith("..") && !isAbsolute(pathFromWorkspace);
}

function isIgnoredPath(path: string): boolean {
	return path.split("/").some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

function toWorkspacePath(path: string): string {
	return path.replaceAll("\\", "/");
}

export class TrustedWorkspaceBrowser {
	private readonly workspacePath: string;

	constructor(workspacePath: string) {
		this.workspacePath = workspacePath;
	}

	async list(): Promise<DesktopWorkspaceEntry[]> {
		const workspacePath = await realpath(this.workspacePath);
		const entries: DesktopWorkspaceEntry[] = [];

		const walk = async (directoryPath: string, relativeDirectoryPath: string, depth: number): Promise<void> => {
			if (entries.length >= MAX_ENTRIES || depth > MAX_DIRECTORY_DEPTH) return;
			const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
			directoryEntries.sort((left, right) => {
				if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
				return left.name.localeCompare(right.name);
			});

			for (const entry of directoryEntries) {
				if (entries.length >= MAX_ENTRIES) break;
				if (entry.isSymbolicLink()) continue;
				const entryPath = relativeDirectoryPath ? `${relativeDirectoryPath}/${entry.name}` : entry.name;
				if (isIgnoredPath(entryPath)) continue;

				if (entry.isDirectory()) {
					entries.push({ path: entryPath, name: entry.name, type: "directory", depth });
					await walk(join(directoryPath, entry.name), entryPath, depth + 1);
					continue;
				}

				if (entry.isFile()) {
					entries.push({ path: entryPath, name: entry.name, type: "file", depth });
				}
			}
		};

		await walk(workspacePath, "", 0);
		return entries;
	}

	/** Search the trusted workspace with a larger bounded index for composer mentions. */
	async search(query: string): Promise<DesktopWorkspaceEntry[]> {
		const workspacePath = await realpath(this.workspacePath);
		const normalizedQuery = query.trim().toLocaleLowerCase();
		const entries: DesktopWorkspaceEntry[] = [];
		const walk = async (directoryPath: string, relativeDirectoryPath: string, depth: number): Promise<void> => {
			if (entries.length >= MAX_SEARCH_ENTRIES || depth > MAX_SEARCH_DEPTH) return;
			const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
			directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
			for (const entry of directoryEntries) {
				if (entries.length >= MAX_SEARCH_ENTRIES || entry.isSymbolicLink()) break;
				const entryPath = relativeDirectoryPath ? `${relativeDirectoryPath}/${entry.name}` : entry.name;
				if (isIgnoredPath(entryPath)) continue;
				if (entry.isDirectory()) {
					if (!normalizedQuery || entryPath.toLocaleLowerCase().includes(normalizedQuery)) {
						entries.push({ path: entryPath, name: entry.name, type: "directory", depth });
					}
					await walk(join(directoryPath, entry.name), entryPath, depth + 1);
				} else if (
					entry.isFile() &&
					(!normalizedQuery || entryPath.toLocaleLowerCase().includes(normalizedQuery))
				) {
					entries.push({ path: entryPath, name: entry.name, type: "file", depth });
				}
			}
		};
		await walk(workspacePath, "", 0);
		return entries;
	}

	/** List a single directory of the trusted workspace for lazy tree browsing. */
	async listDirectory(directoryPath = ""): Promise<DesktopWorkspaceDirectoryListing> {
		const normalized = directoryPath.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
		if (normalized.split("/").includes("..") || isIgnoredPath(normalized)) {
			throw new Error("Pi 桌面端无法浏览该受保护项目路径。");
		}
		const workspacePath = await realpath(this.workspacePath);
		const candidatePath = resolve(workspacePath, normalized);
		if (normalized && !isWithinWorkspace(workspacePath, candidatePath)) {
			throw new Error("目录路径必须位于所选项目目录内。");
		}
		const directoryStats = await lstat(candidatePath);
		if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
			throw new Error("Pi 桌面端只能浏览项目内的普通目录。");
		}
		const resolvedDirectory = await realpath(candidatePath);
		if (resolvedDirectory !== workspacePath && !isWithinWorkspace(workspacePath, resolvedDirectory)) {
			throw new Error("解析后的目录路径位于所选项目目录外。");
		}

		const entries = await readdir(resolvedDirectory, { withFileTypes: true });
		const depth = normalized ? normalized.split("/").length : 0;
		const directories: DesktopWorkspaceEntry[] = [];
		const files: DesktopWorkspaceEntry[] = [];
		entries.sort((left, right) => {
			if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
			return left.name.localeCompare(right.name);
		});
		let truncated = false;
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			const entryPath = normalized ? `${normalized}/${entry.name}` : entry.name;
			if (isIgnoredPath(entryPath)) continue;
			if (directories.length + files.length >= MAX_DIRECTORY_LISTING_ENTRIES) {
				truncated = true;
				break;
			}
			if (entry.isDirectory()) {
				directories.push({ path: entryPath, name: entry.name, type: "directory", depth });
			} else if (entry.isFile()) {
				files.push({ path: entryPath, name: entry.name, type: "file", depth });
			}
		}
		return { path: normalized, directories, files, ...(truncated ? { truncated: true } : {}) };
	}

	async read(path: string): Promise<DesktopWorkspaceFilePreview> {
		const { resolvedFilePath, workspacePath } = await this.resolveValidatedFile(path);

		const mimeType = imageMimeType(path);
		if (mimeType) {
			const fileStats = await lstat(resolvedFilePath);
			if (fileStats.size > MAX_IMAGE_BYTES) {
				throw new Error("该图片超过了 10 MB 的预览上限。");
			}
			const imageContent = await readFile(resolvedFilePath);
			return {
				path: toWorkspacePath(relative(workspacePath, resolvedFilePath)),
				content: "",
				imageDataUrl: `data:${mimeType};base64,${imageContent.toString("base64")}`,
				binaryDataUrl: `data:${mimeType};base64,${imageContent.toString("base64")}`,
			};
		}

		const audioMime = audioMimeType(path);
		if (audioMime) {
			const fileStats = await lstat(resolvedFilePath);
			if (fileStats.size > AUDIO_MAX_BYTES) {
				throw new Error("该音频超过了 20 MB 的预览上限。");
			}
			const audioContent = await readFile(resolvedFilePath);
			return {
				path: toWorkspacePath(relative(workspacePath, resolvedFilePath)),
				content: "",
				audioDataUrl: `data:${audioMime};base64,${audioContent.toString("base64")}`,
				binaryDataUrl: `data:${audioMime};base64,${audioContent.toString("base64")}`,
			};
		}

		if (path.toLocaleLowerCase().endsWith(".pdf")) {
			const fileStats = await lstat(resolvedFilePath);
			if (fileStats.size > PDF_MAX_BYTES) throw new Error("该 PDF 超过了 20 MB 的预览上限。");
			const pdfContent = await readFile(resolvedFilePath);
			return {
				path: toWorkspacePath(relative(workspacePath, resolvedFilePath)),
				content: "",
				pdfDataUrl: `data:application/pdf;base64,${pdfContent.toString("base64")}`,
				binaryDataUrl: `data:application/pdf;base64,${pdfContent.toString("base64")}`,
			};
		}

		if (path.toLocaleLowerCase().endsWith(".docx")) {
			const fileStats = await lstat(resolvedFilePath);
			if (fileStats.size > DOCX_MAX_BYTES) throw new Error("该 DOCX 超过了 10 MB 的预览上限。");
			const docxContent = await readFile(resolvedFilePath);
			const converted = await mammoth.convertToHtml(
				{ buffer: docxContent },
				{
					convertImage: mammoth.images.imgElement(async (image) => ({
						src: `data:${image.contentType};base64,${await image.read("base64")}`,
					})),
				},
			);
			return {
				path: toWorkspacePath(relative(workspacePath, resolvedFilePath)),
				content: "",
				docxHtml: converted.value || "<p>（DOCX 中没有可显示的文字。）</p>",
				binaryDataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docxContent.toString("base64")}`,
			};
		}

		const fileStats = await lstat(resolvedFilePath);
		if (fileStats.size > MAX_FILE_BYTES) {
			throw new Error("该文件超过了 256 KB 的预览上限。");
		}

		const content = await readFile(resolvedFilePath);
		if (content.includes(0)) {
			throw new Error("Pi 桌面端无法预览二进制文件。");
		}

		return { path: toWorkspacePath(relative(workspacePath, resolvedFilePath)), content: content.toString("utf8") };
	}

	async open(path: string): Promise<void> {
		const { resolvedFilePath } = await this.resolveValidatedFile(path);
		const errorMessage = await shell.openPath(resolvedFilePath);
		if (errorMessage) {
			throw new Error(errorMessage);
		}
	}

	async reveal(path: string): Promise<void> {
		const { resolvedFilePath } = await this.resolveValidatedFile(path);
		shell.showItemInFolder(resolvedFilePath);
	}

	private async resolveValidatedFile(path: string): Promise<{
		resolvedFilePath: string;
		workspacePath: string;
	}> {
		if (isIgnoredPath(path)) {
			throw new Error("Pi 桌面端无法打开该受保护项目路径。");
		}

		const workspacePath = await realpath(this.workspacePath);
		const candidatePath = resolve(workspacePath, path);
		if (!isWithinWorkspace(workspacePath, candidatePath)) {
			throw new Error("项目文件路径必须位于所选项目目录内。");
		}

		const fileStats = await lstat(candidatePath);
		if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
			throw new Error("Pi 桌面端只能操作普通文件。");
		}

		const resolvedFilePath = await realpath(candidatePath);
		if (!isWithinWorkspace(workspacePath, resolvedFilePath)) {
			throw new Error("解析后的文件路径位于所选项目目录外。");
		}
		return { resolvedFilePath, workspacePath };
	}
}
