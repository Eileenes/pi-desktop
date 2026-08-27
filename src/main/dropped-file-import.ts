import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface DroppedFileImportResult {
	name: string;
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
): Promise<DroppedFileImportResult[]> {
	const results: DroppedFileImportResult[] = [];
	for (const sourcePath of sourcePaths) {
		const name = basename(sourcePath) || "file";
		try {
			await copyFile(sourcePath, join(workspacePath, name), overwriteConflicts ? 0 : constants.COPYFILE_EXCL);
			results.push({ name });
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
