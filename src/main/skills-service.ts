import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type { Response as FetchResponse } from "undici-types";
import type {
	DesktopSkillInfo,
	DesktopSkillInstallInfo,
	DesktopSkillSearchResult,
	DesktopSkillUpdateResult,
} from "../shared/contracts.ts";
import { setSkillDisableModelInvocation } from "./skill-toggle.ts";

const execFileAsync = promisify(execFile);

const SKILLS_API_BASE = process.env.SKILLS_API_URL ?? "https://skills.sh";
const CHECK_TIMEOUT_MS = 15_000;
const GIT_CHECK_TIMEOUT_MS = 30_000;
const NPX_TIMEOUT_MS = 60_000;
const ANSI_RE = /\x1B\[[0-9;]*m/gu;

interface SkillLockEntry {
	source?: unknown;
	sourceType?: unknown;
	skillPath?: unknown;
	ref?: unknown;
	skillFolderHash?: unknown;
	computedHash?: unknown;
}

interface SkillLockFile {
	skills?: Record<string, SkillLockEntry>;
}

export function getGlobalSkillsLockPath(): string {
	const xdgStateHome = process.env.XDG_STATE_HOME;
	return xdgStateHome
		? join(xdgStateHome, "skills", ".skill-lock.json")
		: join(homedir(), ".agents", ".skill-lock.json");
}

/** Pi CLI 的真实数据目录（与参考项目一致，读取用户已有的技能/认证/模型）。 */
export function getPiAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function readSkillLock(path: string): Record<string, SkillLockEntry> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as SkillLockFile;
		return parsed.skills && typeof parsed.skills === "object" ? parsed.skills : {};
	} catch {
		return {};
	}
}

function isWithin(path: string, root: string): boolean {
	const rel = relative(resolve(root), resolve(path));
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function findLockEntry(entries: Record<string, SkillLockEntry>, skillName: string): SkillLockEntry | undefined {
	if (entries[skillName]) return entries[skillName];
	const normalizedName = skillName.toLowerCase();
	const key = Object.keys(entries).find((name) => name.toLowerCase() === normalizedName);
	return key ? entries[key] : undefined;
}

function normalizeSource(source: string, sourceType?: string): string {
	if (sourceType !== "github") return source.replace(/\/$/u, "");
	return source
		.replace(/^git\+/u, "")
		.replace(/^https?:\/\/github\.com\//u, "")
		.replace(/^git@github\.com:/u, "")
		.replace(/\.git$/u, "")
		.replace(/\/$/u, "");
}

function buildSkillsShUrl(source: string, skillName: string): string | undefined {
	if (!source || source.includes("://") || source.startsWith("git@")) return undefined;
	const sourcePath = source.split("/").filter(Boolean).map(encodeURIComponent).join("/");
	if (!sourcePath) return undefined;
	return `${SKILLS_API_BASE}/${sourcePath}/${encodeURIComponent(skillName)}`;
}

function getInstallInfo(
	entries: Record<string, SkillLockEntry>,
	skillName: string,
	scope: "global" | "project",
): DesktopSkillInstallInfo | undefined {
	const entry = findLockEntry(entries, skillName);
	if (!entry || typeof entry.source !== "string" || !entry.source.trim()) return undefined;

	const sourceType = typeof entry.sourceType === "string" ? entry.sourceType : undefined;
	const source = normalizeSource(entry.source.trim(), sourceType);
	if (!source) return undefined;
	const skillPath = typeof entry.skillPath === "string" ? entry.skillPath : undefined;
	const ref = typeof entry.ref === "string" ? entry.ref : undefined;
	const rawVersionHash = scope === "global" ? entry.skillFolderHash : entry.computedHash;
	const versionHash = typeof rawVersionHash === "string" && rawVersionHash ? rawVersionHash : undefined;
	const isGitHubSource = sourceType === "github" && /^[\w.-]+\/[\w.-]+$/u.test(source);
	const hasComparableVersion = scope === "global" || !ref;

	return {
		package: `${source}@${skillName}`,
		scope,
		source,
		...(sourceType ? { sourceType } : {}),
		...(sourceType === "local"
			? {}
			: buildSkillsShUrl(source, skillName)
				? { skillsShUrl: buildSkillsShUrl(source, skillName) }
				: {}),
		...(skillPath ? { skillPath } : {}),
		...(ref ? { ref } : {}),
		...(versionHash ? { versionHash } : {}),
		canCheckForUpdates: Boolean(isGitHubSource && skillPath && versionHash && hasComparableVersion),
	};
}

export async function listSkillsDetailed(options: {
	cwd?: string;
	projectTrusted: boolean;
}): Promise<DesktopSkillInfo[]> {
	const globalDir = join(getPiAgentDir(), "skills");
	const globalLock = readSkillLock(getGlobalSkillsLockPath());
	const projectLock = options.cwd ? readSkillLock(join(options.cwd, "skills-lock.json")) : {};
	const skills: DesktopSkillInfo[] = [];

	const groups: Array<{ scope: "global" | "project"; dir: string }> = [{ scope: "global", dir: globalDir }];
	if (options.cwd && options.projectTrusted) {
		groups.push({ scope: "project", dir: join(options.cwd, ".pi", "skills") });
	}

	for (const group of groups) {
		if (!existsSync(group.dir)) continue;
		const { skills: loaded, diagnostics } = loadSkillsFromDir({ dir: group.dir, source: group.scope });
		for (const skill of loaded) {
			const install = getInstallInfo(group.scope === "global" ? globalLock : projectLock, skill.name, group.scope);
			skills.push({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
				scope: group.scope,
				available: true,
				...(install ? { install } : {}),
			});
		}
		for (const diagnostic of diagnostics) {
			const diagnosticPath = diagnostic.path;
			if (!diagnosticPath || diagnostic.type === "collision") continue;
			const normalizedPath = diagnosticPath.replaceAll("\\", "/");
			if (skills.some((skill) => resolve(skill.filePath) === resolve(diagnosticPath))) continue;
			const segments = normalizedPath.split("/").filter(Boolean);
			const folderName = normalizedPath.toLocaleLowerCase().endsWith("skill.md")
				? (segments.at(-2) ?? segments.at(-1))
				: segments.at(-1);
			skills.push({
				name: folderName ?? diagnosticPath,
				description: "",
				filePath: diagnosticPath,
				disableModelInvocation: false,
				scope: group.scope,
				available: false,
				error: diagnostic.message,
			});
		}
	}
	return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function toggleSkillFile(
	filePath: string,
	disable: boolean,
	options: { cwd?: string; projectTrusted: boolean },
): Promise<void> {
	const allowedRoots = [join(getPiAgentDir(), "skills")];
	if (options.cwd && options.projectTrusted) allowedRoots.push(join(options.cwd, ".pi", "skills"));
	if (!allowedRoots.some((root) => isWithin(filePath, root))) {
		throw new Error("只能修改技能目录中的技能文件。");
	}
	await setSkillDisableModelInvocation(filePath, disable);
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
	const response = (await fetch(url, {
		cache: "no-store",
		...(headers ? { headers } : {}),
		signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
	})) as FetchResponse;
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}

function formatInstalls(count?: number): string {
	if (!count || count <= 0) return "";
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M installs`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/u, "")}K installs`;
	return `${count} install${count === 1 ? "" : "s"}`;
}

function parseInstallCount(installs: string): number {
	const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/u);
	if (!match) return 0;
	const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
	return Number(match[1]) * multiplier;
}

export async function searchSkills(query: string, limit = 50): Promise<DesktopSkillSearchResult[]> {
	const url = `${SKILLS_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
	const data = (await fetchJson(url)) as {
		skills?: Array<{ id?: string; name?: string; source?: string; installs?: number }>;
	};
	return (data.skills ?? [])
		.map((skill) => {
			const name = skill.name?.trim();
			const source = skill.source?.trim();
			const slug = skill.id?.trim();
			if (!name || (!source && !slug)) return undefined;
			return {
				package: `${source || slug}@${name}`,
				installs: formatInstalls(skill.installs),
				url: slug ? `${SKILLS_API_BASE}/${slug}` : "",
			};
		})
		.filter((skill): skill is DesktopSkillSearchResult => skill !== undefined)
		.sort((left, right) => parseInstallCount(right.installs) - parseInstallCount(left.installs));
}

export async function installSkill(pkg: string, scope: "global" | "project", cwd?: string): Promise<string> {
	if (!/^[\w.@/:.-]+$/u.test(pkg)) throw new Error("无效的资源包标识。");
	const args = ["skills", "add", pkg, "-y", "--agent", "pi"];
	let runCwd: string | undefined;
	if (scope === "global") args.push("-g");
	else {
		if (!cwd) throw new Error("项目范围安装需要先选择项目。");
		runCwd = cwd;
	}
	const { stdout, stderr } = await execFileAsync("npx", args, {
		timeout: NPX_TIMEOUT_MS,
		...(runCwd ? { cwd: runCwd } : {}),
		env: { ...process.env, FORCE_COLOR: "0" },
		maxBuffer: 4 * 1024 * 1024,
	});
	const output = (stdout + stderr).replace(ANSI_RE, "");
	if (!/Installation complete|Installed \d+ skill/u.test(output)) {
		throw new Error(output.slice(-300) || "安装失败。");
	}
	return output.slice(-500);
}

function skillSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[\s_]+/gu, "-")
		.replace(/[^a-z0-9-]/gu, "")
		.replace(/-+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function skillNameFromPackage(pkg: string): string {
	const at = pkg.lastIndexOf("@");
	return at >= 0 ? pkg.slice(at + 1) : pkg;
}

function skillFolder(skillPath: string): string {
	let folder = skillPath.replaceAll("\\", "/");
	if (folder.toLowerCase().endsWith("/skill.md")) folder = folder.slice(0, -9);
	else if (folder.toLowerCase().endsWith("skill.md")) folder = folder.slice(0, -8);
	return folder.replace(/\/$/u, "");
}

export function skillUpdateKey(install: Pick<DesktopSkillInstallInfo, "scope" | "package">): string {
	return `${install.scope}\0${install.package}`;
}

export function buildSkillUpdateArgs(install: DesktopSkillInstallInfo): string[] {
	const folder = skillFolder(install.skillPath ?? "");
	const source = folder ? `${install.source}/${folder}` : install.source;
	const ref = install.ref ? `#${encodeURIComponent(install.ref)}` : "";
	const args = [
		"skills",
		"add",
		`${source}${ref}`,
		"--skill",
		skillNameFromPackage(install.package),
		"-y",
		"--agent",
		"pi",
	];
	if (install.scope === "global") args.push("-g");
	return args;
}

function updateResult(
	install: DesktopSkillInstallInfo,
	state: DesktopSkillUpdateResult["state"],
	latestVersion?: string,
	message?: string,
): DesktopSkillUpdateResult {
	return {
		package: install.package,
		scope: install.scope,
		state,
		...(install.versionHash ? { currentVersion: install.versionHash } : {}),
		...(latestVersion ? { latestVersion } : {}),
		...(message ? { message } : {}),
	};
}

async function resolveGitTreeHash(install: DesktopSkillInstallInfo): Promise<string> {
	const repository = `https://github.com/${install.source}.git`;
	const ref = install.ref || "HEAD";
	const folder = skillFolder(install.skillPath ?? "");
	const gitDir = await mkdtemp(join(tmpdir(), "pi-desktop-skill-check-"));
	try {
		await execFileAsync("git", ["init", "--bare", gitDir], { timeout: GIT_CHECK_TIMEOUT_MS });
		await execFileAsync(
			"git",
			[`--git-dir=${gitDir}`, "fetch", "--depth=1", "--filter=blob:none", "--no-tags", repository, ref],
			{ timeout: GIT_CHECK_TIMEOUT_MS },
		);
		const revision = folder ? `FETCH_HEAD:${folder}` : "FETCH_HEAD^{tree}";
		const { stdout } = await execFileAsync("git", [`--git-dir=${gitDir}`, "rev-parse", revision], {
			timeout: GIT_CHECK_TIMEOUT_MS,
		});
		const hash = stdout.trim();
		if (!/^[0-9a-f]{40}$/iu.test(hash)) throw new Error("无效的 Git tree 哈希。");
		return hash;
	} finally {
		await rm(gitDir, { recursive: true, force: true });
	}
}

async function checkGlobalSkill(install: DesktopSkillInstallInfo): Promise<DesktopSkillUpdateResult> {
	const ref = install.ref || "HEAD";
	const url = `https://api.github.com/repos/${install.source}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
	const folder = skillFolder(install.skillPath ?? "");
	let latestVersion: string | undefined;
	try {
		const raw = (await fetchJson(url, {
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "pi-desktop",
		})) as { sha?: unknown; tree?: Array<{ path?: unknown; type?: unknown; sha?: unknown }> };
		latestVersion = typeof raw.sha === "string" && !folder ? raw.sha : undefined;
		if (folder && Array.isArray(raw.tree)) {
			const entry = raw.tree.find((item) => item.type === "tree" && item.path === folder);
			if (entry && typeof entry.sha === "string") latestVersion = entry.sha;
		}
	} catch {
		latestVersion = await resolveGitTreeHash(install);
	}
	if (!latestVersion) return updateResult(install, "error", undefined, "远端技能路径不存在。");
	return updateResult(
		install,
		latestVersion === install.versionHash ? "up-to-date" : "update-available",
		latestVersion,
	);
}

async function checkProjectSkill(install: DesktopSkillInstallInfo): Promise<DesktopSkillUpdateResult> {
	const [owner, repo] = install.source.split("/");
	const name = skillSlug(skillNameFromPackage(install.package));
	const url = `${SKILLS_API_BASE}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(name)}`;
	const raw = (await fetchJson(url)) as { hash?: unknown };
	const latestVersion = typeof raw.hash === "string" ? raw.hash : undefined;
	if (!latestVersion) return updateResult(install, "error", undefined, "skills.sh 没有返回版本哈希。");
	return updateResult(
		install,
		latestVersion === install.versionHash ? "up-to-date" : "update-available",
		latestVersion,
	);
}

export async function checkSkillUpdate(install: DesktopSkillInstallInfo): Promise<DesktopSkillUpdateResult> {
	if (!install.canCheckForUpdates || !install.versionHash || !install.skillPath) {
		return updateResult(install, "unsupported", undefined, "该技能无法自动检查更新。");
	}
	try {
		return install.scope === "global" ? await checkGlobalSkill(install) : await checkProjectSkill(install);
	} catch (error) {
		return updateResult(install, "error", undefined, error instanceof Error ? error.message : String(error));
	}
}

export async function updateSkillViaNpx(install: DesktopSkillInstallInfo): Promise<string> {
	const { stdout, stderr } = await execFileAsync("npx", buildSkillUpdateArgs(install), {
		timeout: NPX_TIMEOUT_MS,
		...(install.scope === "project" ? { cwd: tmpdir() } : {}),
		env: { ...process.env, FORCE_COLOR: "0" },
		maxBuffer: 4 * 1024 * 1024,
	});
	return `${stdout}${stderr}`.replace(ANSI_RE, "").slice(-500);
}
