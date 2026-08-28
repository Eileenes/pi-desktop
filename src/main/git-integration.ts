import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
	isMain: boolean;
}

export interface GitProjectInfo {
	projectRoot: string;
	branch?: string;
	isWorktree: boolean;
	isTopLevel: boolean;
}

export interface GitBranches {
	local: string[];
	remote: string[];
}

function branchName(value: string): string {
	return value.trim().replace(/^\*\s*/u, "");
}

export async function listGitBranches(cwd: string): Promise<GitBranches> {
	const [{ stdout: localOutput }, { stdout: remoteOutput }] = await Promise.all([
		execFileAsync("git", ["branch", "--format=%(refname:short)"], { cwd }),
		execFileAsync("git", ["branch", "--remotes", "--format=%(refname:short)"], { cwd }),
	]);
	const local = [...new Set(localOutput.split("\n").map(branchName).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
	const remote = [
		...new Set(
			remoteOutput
				.split("\n")
				.map(branchName)
				.filter((branch) => branch && !branch.endsWith("/HEAD")),
		),
	].sort((a, b) => a.localeCompare(b));
	return { local, remote };
}

export async function fetchGitBranches(cwd: string): Promise<void> {
	await execFileAsync("git", ["fetch", "--prune"], {
		cwd,
		timeout: 90_000,
		maxBuffer: 1024 * 1024,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
	});
}

export async function switchGitBranch(cwd: string, branch: string): Promise<void> {
	const trimmed = branch.trim();
	if (!/^[A-Za-z0-9._/-]+$/u.test(trimmed)) throw new Error("无效的 Git 分支名。");
	const branches = await listGitBranches(cwd);
	if (!branches.local.includes(trimmed) && !branches.remote.includes(trimmed)) {
		throw new Error("该分支不存在，请刷新分支列表后重试。");
	}
	if (branches.remote.includes(trimmed) && !branches.local.includes(trimmed)) {
		await execFileAsync("git", ["switch", "--track", trimmed], { cwd });
		return;
	}
	await execFileAsync("git", ["switch", trimmed], { cwd });
}

export async function listGitWorktrees(cwd: string): Promise<GitWorktree[]> {
	const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd });
	const worktrees: GitWorktree[] = [];
	let currentPath: string | undefined;
	let currentBranch: string | undefined;
	let currentPrunable = false;

	for (const line of stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (currentPath && !currentPrunable && existsSync(currentPath)) {
				worktrees.push({
					path: currentPath,
					branch: currentBranch ?? "(detached)",
					isMain: worktrees.length === 0,
				});
			}
			currentPath = line.slice("worktree ".length).trim();
			currentBranch = undefined;
			currentPrunable = false;
		} else if (line.startsWith("branch ")) {
			currentBranch = line.slice("branch ".length).trim();
		} else if (line.startsWith("prunable")) {
			currentPrunable = true;
		}
	}
	if (currentPath && !currentPrunable && existsSync(currentPath)) {
		worktrees.push({
			path: currentPath,
			branch: currentBranch ?? "(detached)",
			isMain: worktrees.length === 0,
		});
	}
	return worktrees;
}

/** Resolves the shared repository root for a linked worktree without changing the caller's cwd. */
export async function resolveGitProject(cwd: string): Promise<GitProjectInfo> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			[
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
				"--git-dir",
				"--show-toplevel",
				"--abbrev-ref",
				"HEAD",
			],
			{ cwd },
		);
		const [commonDir, gitDir, topLevel, branch] = stdout.split("\n").map((value) => value.trim());
		if (!commonDir || !gitDir || !topLevel) throw new Error("Git project metadata is incomplete.");
		const isTopLevel = resolve(topLevel) === resolve(cwd);
		const isWorktree = isTopLevel && resolve(gitDir) !== resolve(commonDir);
		return {
			projectRoot: isWorktree ? dirname(commonDir) : cwd,
			...(branch && branch !== "HEAD" ? { branch } : {}),
			isWorktree,
			isTopLevel,
		};
	} catch {
		return { projectRoot: cwd, isWorktree: false, isTopLevel: false };
	}
}

export async function addGitWorktree(cwd: string, branch: string): Promise<GitWorktree> {
	const trimmed = branch.trim();
	if (!trimmed || trimmed.startsWith("-") || !/^[A-Za-z0-9._/-]+$/u.test(trimmed)) {
		throw new Error("无效的 Git 分支名。");
	}
	const directoryName = trimmed.replace(/[/\\:*?"<>|\s]+/gu, "-").replace(/^-+|-+$/gu, "");
	if (!directoryName || directoryName === "." || directoryName === "..") {
		throw new Error("无效的 Worktree 目录名。");
	}
	const worktrees = await listGitWorktrees(cwd);
	const mainWorktree = worktrees.find((worktree) => worktree.isMain);
	if (!mainWorktree) throw new Error("无法确定主 Worktree。");
	const targetPath = join(`${mainWorktree.path}-worktrees`, directoryName);
	const branches = await listGitBranches(cwd);
	if (branches.local.includes(trimmed)) {
		await execFileAsync("git", ["worktree", "add", "--", targetPath, trimmed], { cwd });
	} else if (branches.remote.includes(trimmed)) {
		await execFileAsync("git", ["worktree", "add", "--track", "--", targetPath, trimmed], { cwd });
	} else {
		await execFileAsync("git", ["worktree", "add", "-b", trimmed, "--", targetPath], { cwd });
	}
	return { path: targetPath, branch: trimmed, isMain: false };
}

export async function removeGitWorktree(cwd: string, path: string, force = false): Promise<{ dirty?: boolean }> {
	const worktrees = await listGitWorktrees(cwd);
	const target = worktrees.find((worktree) => resolve(worktree.path) === resolve(path));
	if (!target || target.isMain) {
		throw new Error("只能移除当前仓库中的非活动 Worktree。");
	}
	try {
		await execFileAsync("git", ["worktree", "remove", ...(force ? ["--force"] : []), "--", path], { cwd });
	} catch (error) {
		const stderr =
			typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
				? error.stderr
				: "";
		if (!force && /modified|untracked|local changes|contains changes/iu.test(stderr)) return { dirty: true };
		throw error;
	}
	return {};
}
