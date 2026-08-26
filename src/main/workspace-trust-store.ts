import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface WorkspaceTrustFile {
	version: 1;
	workspaceKeys: string[];
}

export function getWorkspaceKey(workspacePath: string): string {
	return createHash("sha256").update(resolve(workspacePath)).digest("hex");
}

function isWorkspaceTrustFile(value: unknown): value is WorkspaceTrustFile {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		Array.isArray(record.workspaceKeys) &&
		record.workspaceKeys.every((entry) => typeof entry === "string")
	);
}

export class WorkspaceTrustStore {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async isTrusted(workspacePath: string): Promise<boolean> {
		const trustFile = await this.read();
		return trustFile.workspaceKeys.includes(getWorkspaceKey(workspacePath));
	}

	async setTrusted(workspacePath: string, trusted: boolean): Promise<void> {
		const trustFile = await this.read();
		const key = getWorkspaceKey(workspacePath);
		const workspaceKeys = new Set(trustFile.workspaceKeys);
		if (trusted) {
			workspaceKeys.add(key);
		} else {
			workspaceKeys.delete(key);
		}

		await this.write({ version: 1, workspaceKeys: Array.from(workspaceKeys).sort() });
	}

	private async read(): Promise<WorkspaceTrustFile> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (!isWorkspaceTrustFile(parsed)) {
				throw new Error("Desktop workspace trust data has an invalid format.");
			}
			return parsed;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return { version: 1, workspaceKeys: [] };
			}
			throw error;
		}
	}

	private async write(value: WorkspaceTrustFile): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(temporaryPath, this.filePath);
	}
}
