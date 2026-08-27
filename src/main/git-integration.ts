import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitChangeStatus = "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";

export interface GitChange {
	path: string;
	status: GitChangeStatus;
}

function parseStatusLine(line: string): GitChange | undefined {
	if (line.length < 4) return undefined;
	const indexStatus = line[0];
	const worktreeStatus = line[1];
	const rawPath = line.slice(3).trim();
	if (!rawPath) return undefined;

	const path = rawPath.includes(" -> ") ? (rawPath.split(" -> ")[1] ?? rawPath) : rawPath;
	const status: GitChangeStatus =
		indexStatus === "R" || worktreeStatus === "R"
			? "renamed"
			: worktreeStatus === "M" || indexStatus === "M"
				? "modified"
				: worktreeStatus === "A" || indexStatus === "A"
					? "added"
					: worktreeStatus === "D" || indexStatus === "D"
						? "deleted"
						: indexStatus === "?" || worktreeStatus === "?"
							? "untracked"
							: indexStatus === "U" ||
									worktreeStatus === "U" ||
									(indexStatus === "A" && worktreeStatus === "A") ||
									(indexStatus === "D" && worktreeStatus === "D")
								? "conflict"
								: "modified";
	return { path, status };
}

export async function listGitChanges(cwd: string): Promise<GitChange[]> {
	const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
	return stdout
		.split("\n")
		.map(parseStatusLine)
		.filter((change): change is GitChange => change !== undefined);
}

export async function getGitDiff(cwd: string, path: string, untracked: boolean): Promise<string> {
	if (untracked) {
		try {
			const { stdout } = await execFileAsync("git", ["diff", "--no-index", "--", "/dev/null", path], { cwd });
			return stdout;
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === 1 &&
				"stdout" in error &&
				typeof error.stdout === "string"
			) {
				return error.stdout;
			}
			throw error;
		}
	}
	const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--", path], { cwd });
	return stdout;
}

export interface GitWorktree {
	path: string;
	branch: string;
}

export async function listGitWorktrees(cwd: string): Promise<GitWorktree[]> {
	const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
	const worktrees: GitWorktree[] = [];
	let currentPath: string | undefined;
	let currentBranch: string | undefined;

	for (const line of stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (currentPath) worktrees.push({ path: currentPath, branch: currentBranch ?? "(detached)" });
			currentPath = line.slice("worktree ".length).trim();
			currentBranch = undefined;
		} else if (line.startsWith("branch ")) {
			currentBranch = line.slice("branch ".length).trim();
		}
	}
	if (currentPath) worktrees.push({ path: currentPath, branch: currentBranch ?? "(detached)" });
	return worktrees;
}

export async function addGitWorktree(cwd: string, branch: string): Promise<GitWorktree> {
	const targetPath = `${cwd}-worktrees/${branch.replaceAll("/", "-")}`;
	await execFileAsync("git", ["worktree", "add", "-b", branch, targetPath], { cwd });
	return { path: targetPath, branch };
}

export async function removeGitWorktree(cwd: string, path: string): Promise<void> {
	const worktrees = await listGitWorktrees(cwd);
	if (!worktrees.some((worktree) => worktree.path === path) || path === cwd) {
		throw new Error("只能移除当前仓库中的非活动 Worktree。");
	}
	await execFileAsync("git", ["worktree", "remove", "--", path], { cwd });
}
