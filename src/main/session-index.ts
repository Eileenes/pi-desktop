import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";

/** Lists every persisted session created under this Electron app's agent directory. */
export async function listIndexedSessions(agentDir: string): Promise<SessionInfo[]> {
	const sessionsRoot = join(agentDir, "sessions");
	let sessionDirectories: string[];
	try {
		const entries = await readdir(sessionsRoot, { withFileTypes: true });
		sessionDirectories = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(sessionsRoot, entry.name));
	} catch {
		return [];
	}
	const listed = await Promise.all(sessionDirectories.map((directory) => SessionManager.listAll(directory)));
	return listed.flat().sort((left, right) => right.modified.getTime() - left.modified.getTime());
}
