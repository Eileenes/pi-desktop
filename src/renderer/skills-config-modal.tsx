import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopSkillInfo, DesktopSkillSearchResult, DesktopSkillUpdateResult } from "../shared/contracts.ts";
import {
	checkSkillUpdates,
	installSkill as installSkillPackage,
	listSkillsDetailed,
	openExternalUrl,
	searchSkills,
	toggleSkill,
	updateSkill as updateSkillPackage,
} from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface SkillsConfigModalProps {
	workspacePath?: string;
	projectTrusted: boolean;
	onClose: () => void;
}

type GroupLabel = "project / skills.sh" | "project" | "global / skills.sh" | "global" | "path";

function shortenPath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+/u, "~");
}

function sourceLabel(skill: DesktopSkillInfo): Exclude<GroupLabel, `${string} / skills.sh`> {
	if (skill.scope === "project") return "project";
	if (skill.scope === "global") return "global";
	return "path";
}

function skillGroupLabel(skill: DesktopSkillInfo): GroupLabel {
	const source = sourceLabel(skill);
	if (source === "path") return "path";
	return skill.install?.skillsShUrl ? `${source} / skills.sh` : source;
}

function updateKeyOf(skill: DesktopSkillInfo): string | null {
	return skill.install ? `${skill.install.scope}\0${skill.install.package}` : null;
}

function shortVersion(version?: string): string {
	return version ? version.slice(0, 8) : "unknown";
}

const GROUP_ORDER: GroupLabel[] = ["project / skills.sh", "project", "global / skills.sh", "global", "path"];

function Toggle({ enabled, loading, onToggle }: { enabled: boolean; loading: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className={`toggle-switch ${enabled ? "is-on" : ""}`}
			disabled={loading}
			title={enabled ? "在提示词中显示" : "在提示词中隐藏"}
			onClick={onToggle}
		>
			<span className="toggle-knob" />
		</button>
	);
}

async function _copyClipboard(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Clipboard unavailable.
	}
}

function SkillDetail({
	skill,
	workspacePath,
	onToggle,
	toggling,
	saveError,
	updateStatus,
	checkingUpdate,
	updating,
	updateError,
	onCheckUpdate,
	onUpdate,
}: {
	skill: DesktopSkillInfo;
	workspacePath?: string;
	onToggle: (skill: DesktopSkillInfo) => void;
	toggling: boolean;
	saveError?: string;
	updateStatus?: DesktopSkillUpdateResult;
	checkingUpdate: boolean;
	updating: boolean;
	updateError?: string;
	onCheckUpdate: () => void;
	onUpdate: () => void;
}) {
	const label = sourceLabel(skill);
	const enabled = !skill.disableModelInvocation;

	function displayPath(path: string): string {
		if (label === "project" && workspacePath && path.startsWith(workspacePath)) {
			const rel = path.slice(workspacePath.length).replace(/^[/\\]/u, "");
			return `./${rel}`;
		}
		return shortenPath(path);
	}

	return (
		<div className="skill-detail">
			<div className="skill-detail-head">
				<div className="skill-detail-path-row">
					<span className={`resource-scope-tag ${label === "project" ? "is-project" : ""}`}>{label}</span>
					<span className="resource-detail-path" title={skill.filePath}>
						{displayPath(skill.filePath)}
					</span>
					<Toggle enabled={enabled} loading={toggling} onToggle={() => onToggle(skill)} />
				</div>
				<div className="skill-detail-status">
					{!enabled ? <span>已隐藏，但仍可通过 /skill:{skill.name} 调用</span> : null}
					{saveError ? <span className="is-error">{saveError}</span> : null}
				</div>
			</div>

			{skill.install?.skillsShUrl ? (
				<div className="skill-detail-section">
					<span className="skill-detail-label">Source</span>
					<button
						type="button"
						className="skill-source-link"
						title={skill.install.skillsShUrl}
						onClick={() => void openExternalUrl(skill.install?.skillsShUrl ?? "")}
					>
						{skill.install.skillsShUrl.replace(/^https?:\/\//u, "")} ↗
					</button>
				</div>
			) : null}

			{skill.install ? (
				<div className="skill-detail-section">
					<span className="skill-detail-label">Version</span>
					<div className="skill-version-row">
						<span className="skill-version-hash">
							{shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
						</span>
						{skill.install.canCheckForUpdates ? (
							<button
								className="skill-version-button"
								type="button"
								disabled={checkingUpdate || updating}
								onClick={onCheckUpdate}
							>
								检查
							</button>
						) : null}
						{updateStatus?.state === "update-available" ? (
							<span className="skill-version-latest">{shortVersion(updateStatus.latestVersion)}</span>
						) : null}
						{checkingUpdate || (updateStatus && updateStatus.state !== "update-available") ? (
							<span
								className={`skill-version-status is-${checkingUpdate ? "checking" : (updateStatus?.state ?? "dim")}`}
							>
								{checkingUpdate
									? "正在检查…"
									: updateStatus?.state === "up-to-date"
										? "已是最新"
										: updateStatus?.state === "unsupported"
											? "无法自动检查"
											: (updateStatus?.message ?? "检查失败")}
							</span>
						) : null}
						{updateStatus?.state === "update-available" ? (
							<button
								className="skill-version-button is-primary"
								type="button"
								disabled={updating || checkingUpdate}
								onClick={onUpdate}
							>
								{updating ? "更新中" : "更新"}
							</button>
						) : null}
					</div>
					{updateError ? <span className="skill-detail-status is-error">{updateError}</span> : null}
				</div>
			) : null}

			<div className="skill-detail-section">
				<span className="skill-detail-label">Name</span>
				<span className="skill-detail-name">{skill.name}</span>
			</div>

			<div className="skill-detail-section">
				<span className="skill-detail-label">Description</span>
				<span className="skill-detail-description">{skill.description || "该技能没有提供说明。"}</span>
			</div>
		</div>
	);
}

function AddSkillPanel({
	workspacePath,
	projectTrusted,
	installedPackages,
	onInstalled,
}: {
	workspacePath?: string;
	projectTrusted: boolean;
	installedPackages: Record<"global" | "project", ReadonlySet<string>>;
	onInstalled: () => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<DesktopSkillSearchResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState<string>();
	const [installing, setInstalling] = useState<string>();
	const [installError, setInstallError] = useState<string>();
	const [newlyInstalled, setNewlyInstalled] = useState<Set<string>>(new Set());
	const [scope, setScope] = useState<"global" | "project">("global");

	const search = useCallback(async (value: string) => {
		if (!value.trim()) return;
		setSearching(true);
		setSearchError(undefined);
		setResults([]);
		try {
			const found = await searchSkills(value.trim());
			setResults(found);
			if (found.length === 0) setSearchError("没有找到匹配的技能。");
		} catch (error) {
			setSearchError(error instanceof Error ? error.message : String(error));
		} finally {
			setSearching(false);
		}
	}, []);

	const install = useCallback(
		async (pkg: string) => {
			setInstalling(pkg);
			setInstallError(undefined);
			try {
				await installSkillPackage(pkg, scope);
				setNewlyInstalled((current) => new Set(current).add(`${scope}:${pkg}`));
				onInstalled();
			} catch (error) {
				setInstallError(error instanceof Error ? error.message : String(error));
			} finally {
				setInstalling(undefined);
			}
		},
		[onInstalled, scope],
	);

	const installPath = scope === "global" ? "~/.pi/agent/skills/" : `${shortenPath(workspacePath ?? "")}/.pi/skills/`;

	return (
		<div className="skill-add-panel">
			<div className="skill-add-header">
				<strong>添加技能</strong>
				<div className="skill-add-search">
					<input
						value={query}
						placeholder="搜索 skills.sh 上的技能，例如 pdf 或 code review"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void search(query);
						}}
					/>
					<button
						className="accent-button"
						type="button"
						disabled={searching || !query.trim()}
						onClick={() => void search(query)}
					>
						{searching ? "搜索中" : "搜索"}
					</button>
				</div>
				<div className="skill-add-scope-row">
					<div className="skill-add-scope" role="tablist" aria-label="安装范围">
						<button
							type="button"
							className={scope === "global" ? "is-active" : ""}
							onClick={() => setScope("global")}
						>
							全局
						</button>
						<button
							type="button"
							className={scope === "project" ? "is-active" : ""}
							disabled={!workspacePath || !projectTrusted}
							title={!projectTrusted ? "项目资源未信任，不可用" : undefined}
							onClick={() => setScope("project")}
						>
							项目
						</button>
					</div>
					<span className="skill-add-path">→ {installPath}</span>
				</div>
				{searchError ? <p className="skill-add-error">{searchError}</p> : null}
				{installError ? <p className="skill-add-error">{installError}</p> : null}
			</div>
			{results.length > 0 ? (
				<div className="skill-add-results">
					{results.map((result) => {
						const isInstalled =
							installedPackages[scope].has(result.package) || newlyInstalled.has(`${scope}:${result.package}`);
						const isInstalling = installing === result.package;
						const atIdx = result.package.indexOf("@");
						const repoPart = atIdx > -1 ? result.package.slice(0, atIdx) : result.package;
						const skillPart = atIdx > -1 ? result.package.slice(atIdx + 1) : undefined;
						return (
							<div className="skill-add-result-row" key={result.package}>
								<div className="skill-add-result-info">
									<div className="skill-add-result-name">{skillPart ?? repoPart}</div>
									<div className="skill-add-result-meta">
										<span className="is-mono">{repoPart}</span>
										{result.installs ? <span>{result.installs}</span> : null}
										{result.url ? (
											<button
												type="button"
												className="skill-source-link"
												onClick={() => void openExternalUrl(result.url)}
											>
												skills.sh ↗
											</button>
										) : null}
									</div>
								</div>
								<button
									className={`skill-install-button ${isInstalled ? "is-success" : ""}`}
									type="button"
									disabled={isInstalled || installing !== undefined}
									onClick={() => void install(result.package)}
								>
									{isInstalled ? "✓ 已安装" : isInstalling ? "安装中" : "安装"}
								</button>
							</div>
						);
					})}
				</div>
			) : !searchError && !searching ? (
				<p className="skill-add-hint">
					搜索{" "}
					<button
						type="button"
						className="skill-source-link"
						onClick={() => void openExternalUrl("https://skills.sh")}
					>
						skills.sh
					</button>{" "}
					发现并安装适用于你的智能体的技能。
				</p>
			) : null}
		</div>
	);
}

export const SkillsConfigModal = memo(function SkillsConfigModal({
	workspacePath,
	projectTrusted,
	onClose,
}: SkillsConfigModalProps) {
	const [skills, setSkills] = useState<DesktopSkillInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string>();
	const [selected, setSelected] = useState<string>();
	const [addMode, setAddMode] = useState(false);
	const [togglingPaths, setTogglingPaths] = useState<Set<string>>(new Set());
	const [saveError, setSaveError] = useState<string>();
	const [dormantOpenGroups, setDormantOpenGroups] = useState<Record<string, boolean>>({});
	const [updateStatuses, setUpdateStatuses] = useState<Record<string, DesktopSkillUpdateResult>>({});
	const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
	const [checkingAll, setCheckingAll] = useState(false);
	const [updatingKey, setUpdatingKey] = useState<string>();
	const [updateError, setUpdateError] = useState<string>();

	const loadSkills = useCallback(async () => {
		setLoading(true);
		setLoadError(undefined);
		try {
			const list = await listSkillsDetailed();
			setSkills(list);
			setSelected((current) => {
				if (current && list.some((skill) => skill.filePath === current)) return current;
				const initial = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
				return initial?.filePath;
			});
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSkills();
	}, [loadSkills]);

	useEffect(() => {
		if (!loading && skills.length === 0) setAddMode(true);
	}, [loading, skills.length]);

	const checkForUpdates = useCallback(
		async (skill?: DesktopSkillInfo) => {
			const targets = skill ? [skill] : skills.filter((item) => item.install);
			const keys = targets.map(updateKeyOf).filter((key): key is string => key !== null);
			if (keys.length === 0) return;
			setUpdateError(undefined);
			setCheckingKeys((current) => new Set([...current, ...keys]));
			if (!skill) setCheckingAll(true);
			try {
				const updates = skill
					? await checkSkillUpdates({ pkg: skill.install!.package, scope: skill.install!.scope })
					: await checkSkillUpdates();
				setUpdateStatuses((current) => {
					const next = { ...current };
					for (const update of updates) next[`${update.scope}\0${update.package}`] = update;
					return next;
				});
			} catch (error) {
				setUpdateError(error instanceof Error ? error.message : String(error));
			} finally {
				setCheckingKeys((current) => {
					const next = new Set(current);
					for (const key of keys) next.delete(key);
					return next;
				});
				if (!skill) setCheckingAll(false);
			}
		},
		[skills],
	);

	const updateInstalledSkill = useCallback(
		async (skill: DesktopSkillInfo) => {
			if (!skill.install) return;
			const key = `${skill.install.scope}\0${skill.install.package}`;
			setUpdatingKey(key);
			setUpdateError(undefined);
			try {
				await updateSkillPackage(skill.install.package, skill.install.scope);
				await loadSkills();
				setUpdateStatuses((current) => ({
					...current,
					[key]: {
						package: skill.install!.package,
						scope: skill.install!.scope,
						state: "up-to-date",
						currentVersion: current[key]?.latestVersion,
						latestVersion: current[key]?.latestVersion,
					},
				}));
			} catch (error) {
				setUpdateError(error instanceof Error ? error.message : String(error));
			} finally {
				setUpdatingKey(undefined);
			}
		},
		[loadSkills],
	);

	async function handleToggle(skill: DesktopSkillInfo): Promise<void> {
		const next = !skill.disableModelInvocation;
		setTogglingPaths((current) => new Set(current).add(skill.filePath));
		setSaveError(undefined);
		try {
			await toggleSkill(skill.filePath, next);
			setSkills((current) =>
				current.map((item) =>
					item.filePath === skill.filePath ? { ...item, disableModelInvocation: next } : item,
				),
			);
			if (next) {
				setDormantOpenGroups((current) => ({ ...current, [skillGroupLabel(skill)]: true }));
			}
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		} finally {
			setTogglingPaths((current) => {
				const nextSet = new Set(current);
				nextSet.delete(skill.filePath);
				return nextSet;
			});
		}
	}

	const selectedSkill = useMemo(() => skills.find((skill) => skill.filePath === selected), [skills, selected]);
	const groups = useMemo(
		() =>
			GROUP_ORDER.map((label) => ({
				label,
				skills: skills.filter((skill) => skillGroupLabel(skill) === label),
			})).filter((group) => group.skills.length > 0),
		[skills],
	);
	const installedPackages = useMemo(
		() => ({
			global: new Set(
				skills.filter((skill) => skill.install?.scope === "global").map((skill) => skill.install!.package),
			),
			project: new Set(
				skills.filter((skill) => skill.install?.scope === "project").map((skill) => skill.install!.package),
			),
		}),
		[skills],
	);
	const availableUpdateCount = useMemo(
		() => Object.values(updateStatuses).filter((status) => status.state === "update-available").length,
		[updateStatuses],
	);

	function renderSkillRow(skill: DesktopSkillInfo) {
		const isSelected = !addMode && selected === skill.filePath;
		const disabled = skill.disableModelInvocation;
		const key = updateKeyOf(skill);
		const hasUpdate = key !== null && updateStatuses[key]?.state === "update-available";
		return (
			<button
				key={skill.filePath}
				className={`resource-config-row ${isSelected ? "is-active" : ""} ${disabled ? "is-dimmed" : ""}`}
				type="button"
				title={skill.filePath}
				onClick={() => {
					setSelected(skill.filePath);
					setAddMode(false);
				}}
			>
				<span className={`resource-status-dot ${disabled ? "" : "is-on"}`} />
				<span>{skill.name}</span>
				{hasUpdate ? (
					<span className="skill-update-arrow" title="有可用更新">
						↑
					</span>
				) : null}
			</button>
		);
	}

	return (
		<Modal
			title="技能"
			subtitle={workspacePath ? shortenPath(workspacePath) : "~"}
			className="resource-config-modal"
			onClose={onClose}
		>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? (
							<p className="modal-empty">正在加载技能…</p>
						) : loadError ? (
							<p className="modal-empty is-error">{loadError}</p>
						) : skills.length === 0 ? (
							<p className="modal-empty">未安装技能。</p>
						) : (
							groups.map((group) => {
								const activeSkills = group.skills.filter((skill) => !skill.disableModelInvocation);
								const dormantSkills = group.skills.filter((skill) => skill.disableModelInvocation);
								const dormantOpen = dormantOpenGroups[group.label] ?? false;
								return (
									<div key={group.label}>
										<div className="settings-group-label">{group.label}</div>
										{activeSkills.map(renderSkillRow)}
										{dormantSkills.length > 0 ? (
											<>
												<button
													className="settings-dormant-toggle"
													type="button"
													aria-expanded={dormantOpen}
													onClick={() =>
														setDormantOpenGroups((current) => ({
															...current,
															[group.label]: !dormantOpen,
														}))
													}
												>
													<span className="settings-dormant-arrow">{dormantOpen ? "▾" : "▸"}</span>
													DORMANT ({dormantSkills.length})
												</button>
												{dormantOpen ? dormantSkills.map(renderSkillRow) : null}
											</>
										) : null}
									</div>
								);
							})
						)}
					</div>
					<div className="resource-config-sidebar-footer">
						<button
							className={`resource-config-add ${addMode ? "is-active" : ""}`}
							type="button"
							onClick={() => setAddMode(true)}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M12 5v14M5 12h14" />
							</svg>
							添加技能
						</button>
					</div>
				</aside>
				<section className="resource-config-detail">
					{workspacePath && !projectTrusted ? (
						<div className="resource-trust-banner">
							<strong>项目尚未信任</strong>
							<span>项目级技能不会被加载；请先在主窗口确认信任后再安装或启用。</span>
						</div>
					) : null}
					{addMode ? (
						<AddSkillPanel
							workspacePath={workspacePath}
							projectTrusted={projectTrusted}
							installedPackages={installedPackages}
							onInstalled={() => void loadSkills()}
						/>
					) : loading ? null : selectedSkill ? (
						<SkillDetail
							key={selectedSkill.filePath}
							skill={selectedSkill}
							workspacePath={workspacePath}
							onToggle={(skill) => void handleToggle(skill)}
							toggling={togglingPaths.has(selectedSkill.filePath)}
							saveError={saveError}
							updateStatus={updateKeyOf(selectedSkill) ? updateStatuses[updateKeyOf(selectedSkill)!] : undefined}
							checkingUpdate={updateKeyOf(selectedSkill) ? checkingKeys.has(updateKeyOf(selectedSkill)!) : false}
							updating={updatingKey === updateKeyOf(selectedSkill)}
							updateError={updateError}
							onCheckUpdate={() => void checkForUpdates(selectedSkill)}
							onUpdate={() => void updateInstalledSkill(selectedSkill)}
						/>
					) : (
						<div className="settings-empty-state">选择一个技能查看详情</div>
					)}
				</section>
			</div>
			<footer className="models-footer">
				<div className="models-footer-left">
					{skills.some((skill) => skill.install) ? (
						<button
							className="outline-button"
							type="button"
							disabled={checkingAll || updatingKey !== undefined}
							onClick={() => void checkForUpdates()}
						>
							{checkingAll ? "正在检查…" : "检查更新"}
						</button>
					) : null}
					{availableUpdateCount > 0 ? (
						<span className="skill-updates-count">{availableUpdateCount} 个可用更新</span>
					) : null}
				</div>
				<button className="outline-button" type="button" onClick={onClose}>
					关闭
				</button>
			</footer>
		</Modal>
	);
});
