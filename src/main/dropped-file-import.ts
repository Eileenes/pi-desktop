import { constants } from "node:fs";
import { copyFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export interface DroppedFileImportResult {
	name: string;
	path?: string;
	conflict?: boolean;
	error?: string;
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

/** Copies user-selected files into a workspace without replacing existing data. */
export async function importDroppedFiles(
	workspacePath: string,
	sourcePaths: string[],
	overwriteConflicts = false,
	targetDirectory = "",
): Promise<DroppedFileImportResult[]> {
	if (isAbsolute(targetDirectory) || targetDirectory.split(/[\\/]/u).some((part) => part === "..")) {
		throw new Error("上传目录必须是项目内的相对路径。");
	}
	const resolvedWorkspace = await realpath(workspacePath);
	const destination = await realpath(resolve(resolvedWorkspace, targetDirectory || "."));
	const destinationRelative = relative(resolvedWorkspace, destination);
	if (destinationRelative.startsWith("..") || isAbsolute(destinationRelative)) {
		throw new Error("上传目录必须位于当前受信任项目内。");
	}
	const results: DroppedFileImportResult[] = [];
	for (const sourcePath of sourcePaths) {
		const name = basename(sourcePath) || "file";
		const targetPath = join(destination, name);
		const projectPath = destinationRelative ? join(destinationRelative, name).replaceAll("\\", "/") : name;
		try {
			await copyFile(sourcePath, targetPath, overwriteConflicts ? 0 : constants.COPYFILE_EXCL);
			results.push({ name, path: projectPath });
		} catch (error) {
			results.push({
				name,
				...(errorCode(error) === "EEXIST" ? { conflict: true } : {}),
				error:
					errorCode(error) === "EEXIST"
						? "同名文件已存在，已跳过。"
						: error instanceof Error
							? error.message
							: String(error),
			});
		}
	}
	return results;
}
