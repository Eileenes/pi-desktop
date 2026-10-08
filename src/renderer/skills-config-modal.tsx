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
import { useI18n } from "./i18n.ts";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";
import { Switch } from "./ui/switch.tsx";

interface SkillsConfigModalProps {
	workspacePath?: string;
	projectTrusted: boolean;
	/** Opens the project trust confirmation, so the banner is actionable. */
	onTrustProject?: () => void;
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

function Toggle({
	enabled,
	loading,
	disabled,
	onToggle,
}: {
	enabled: boolean;
	loading: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	const { t } = useI18n();
	return (
		<Switch
			checked={enabled}
			disabled={loading || disabled === true}
			title={disabled ? t("dormantToggleHint") : enabled ? t("showInPrompt") : t("hideFromPrompt")}
			onCheckedChange={onToggle}
		/>
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
	const { t } = useI18n();
	const label = sourceLabel(skill);
	const enabled = !skill.disableModelInvocation;
	const dormant = skill.available === false;

	function displayPath(path: string): string {
		if (label === "project" && workspacePath && path.startsWith(workspacePath)) {
			const rel = path.slice(workspacePath.length).replace(/^[/\\]/u, "");
			return `./${rel}`;
		}
		return shortenPath(path);
	}

	return (
		<div className="grid content-start gap-5">
			<div className="grid gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className={`rounded-[var(--radius-3xs)] px-1.5 py-px text-[length:var(--text-2xs)] font-semibold tracking-wide ${label === "project" ? "bg-[color-mix(in_oklab,var(--ds-purple)_12%,transparent)] text-[color-mix(in_oklab,var(--ds-purple)_85%,transparent)]" : "bg-[var(--overlay-7)] text-[color:var(--text-dim)]"}`}
					>
						{label}
					</span>
					<span
						className="min-w-0 flex-1 overflow-hidden font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-ellipsis whitespace-nowrap text-[color:var(--muted)]"
						title={skill.filePath}
					>
						{displayPath(skill.filePath)}
					</span>
					<Toggle
						enabled={enabled && !dormant}
						loading={toggling}
						disabled={dormant}
						onToggle={() => onToggle(skill)}
					/>
				</div>
				<div className="flex min-h-4 items-center justify-end gap-2">
					{dormant ? (
						<span>{t("dormantSkill")}</span>
					) : !enabled ? (
						<span>{t("hiddenButCallable", { name: skill.name })}</span>
					) : (
						<span>{t("visibleToModel")}</span>
					)}
					{skill.error ? <span className="is-error">{skill.error}</span> : null}
					{saveError ? <span className="is-error">{saveError}</span> : null}
				</div>
			</div>

			{skill.install?.skillsShUrl ? (
				<div className="grid gap-1.5">
					<span className="text-[length:var(--text-sm)] font-medium text-[color:var(--muted)]">Source</span>
					<Button
						variant="bare"
						className="inline-flex w-fit max-w-full items-center gap-2 border-0 bg-transparent p-0 text-[color:var(--accent-strong)] hover:underline"
						title={skill.install.skillsShUrl}
						onClick={() => void openExternalUrl(skill.install?.skillsShUrl ?? "")}
					>
						{skill.install.skillsShUrl.replace(/^https?:\/\//u, "")} ↗
					</Button>
				</div>
			) : null}

			{skill.install ? (
				<div className="grid gap-1.5">
					<span className="text-[length:var(--text-sm)] font-medium text-[color:var(--muted)]">Version</span>
					<div className="flex flex-wrap items-center gap-2.5">
						<span className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[color:var(--muted)]">
							{shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
						</span>
						{skill.install.canCheckForUpdates ? (
							<Button size="sm" variant="outline" disabled={checkingUpdate || updating} onClick={onCheckUpdate}>
								{t("check")}
							</Button>
						) : null}
						{updateStatus?.state === "update-available" ? (
							<span className="text-[length:var(--text-sm)]">{shortVersion(updateStatus.latestVersion)}</span>
						) : null}
						{checkingUpdate || (updateStatus && updateStatus.state !== "update-available") ? (
							<span
								className={`text-[length:var(--text-sm)] ${checkingUpdate ? "text-[color:var(--accent-strong)]" : updateStatus?.state === "up-to-date" ? "text-[color:var(--success)]" : updateStatus?.state === "error" ? "text-[color:var(--danger)]" : "text-[color:var(--text-dim)]"}`}
							>
								{checkingUpdate
									? t("checking")
									: updateStatus?.state === "up-to-date"
										? t("statusUpToDate")
										: updateStatus?.state === "unsupported"
											? t("statusUnsupported")
											: (updateStatus?.message ?? t("statusCheckFailed"))}
							</span>
						) : null}
						{updateStatus?.state === "update-available" ? (
							<Button size="sm" variant="primary" disabled={updating || checkingUpdate} onClick={onUpdate}>
								{updating ? t("updatingLabel") : t("update")}
							</Button>
						) : null}
					</div>
					{updateError ? (
						<span className="text-[length:var(--text-sm)] text-[color:var(--danger)] [overflow-wrap:anywhere]">
							{updateError}
						</span>
					) : null}
				</div>
			) : null}

			<div className="grid gap-1.5">
				<span className="text-[length:var(--text-sm)] font-medium text-[color:var(--muted)]">Name</span>
				<span className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text)]">{skill.name}</span>
			</div>

			<div className="grid gap-1.5">
				<span className="text-[length:var(--text-sm)] font-medium text-[color:var(--muted)]">Description</span>
				<span className="max-w-[560px] text-[length:var(--text-base)] leading-[1.6] text-[color:var(--text-dim)]">
					{skill.description || t("noSkillDescription")}
				</span>
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
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<DesktopSkillSearchResult[]>([]);
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState<string>();
	const [installing, setInstalling] = useState<string>();
	const [installError, setInstallError] = useState<string>();
	const [newlyInstalled, setNewlyInstalled] = useState<Set<string>>(new Set());
	const [scope, setScope] = useState<"global" | "project">("global");

	const search = useCallback(
		async (value: string) => {
			if (!value.trim()) return;
			setSearching(true);
			setSearchError(undefined);
			setResults([]);
			try {
				const found = await searchSkills(value.trim());
				setResults(found);
				if (found.length === 0) setSearchError(t("noMatchingSkills"));
			} catch (error) {
				setSearchError(error instanceof Error ? error.message : String(error));
			} finally {
				setSearching(false);
			}
		},
		[t],
	);

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
		<div className="flex h-full min-h-0 flex-col">
			<div className="mb-5 grid gap-3">
				<strong>{t("addSkill")}</strong>
				<div className="flex gap-2">
					<Field
						value={query}
						placeholder={t("searchSkillsPlaceholder")}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void search(query);
						}}
					/>
					<Button
						variant="primary"
						type="button"
						disabled={searching || !query.trim()}
						onClick={() => void search(query)}
					>
						{searching ? t("searching") : t("search")}
					</Button>
				</div>
				<div className="flex min-w-0 items-center gap-2.5">
					<Segmented aria-label={t("installScopeAria")}>
						<Segment active={scope === "global"} onClick={() => setScope("global")}>
							{t("global")}
						</Segment>
						<Segment
							active={scope === "project"}
							disabled={!workspacePath || !projectTrusted}
							title={!projectTrusted ? t("untrustedProjectHint") : undefined}
							onClick={() => setScope("project")}
						>
							{t("project")}
						</Segment>
					</Segmented>
					<span className="overflow-hidden font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-ellipsis whitespace-nowrap text-[color:var(--text-dim)]">
						→ {installPath}
					</span>
				</div>
				{searchError ? (
					<p className="text-[length:var(--text-sm)] text-[color:var(--danger)]">{searchError}</p>
				) : null}
				{installError ? (
					<p className="text-[length:var(--text-sm)] text-[color:var(--danger)]">{installError}</p>
				) : null}
			</div>
			{results.length > 0 ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					{results.map((result) => {
						const isInstalled =
							installedPackages[scope].has(result.package) || newlyInstalled.has(`${scope}:${result.package}`);
						const isInstalling = installing === result.package;
						const atIdx = result.package.indexOf("@");
						const repoPart = atIdx > -1 ? result.package.slice(0, atIdx) : result.package;
						const skillPart = atIdx > -1 ? result.package.slice(atIdx + 1) : undefined;
						return (
							<div
								className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] py-3"
								key={result.package}
							>
								<div className="min-w-0 flex-1">
									<div className="mb-0.5 text-[length:var(--text-md)] font-semibold text-[color:var(--text)]">
										{skillPart ?? repoPart}
									</div>
									<div className="flex flex-wrap items-center gap-2.5">
										<span className="is-mono">{repoPart}</span>
										{result.installs ? <span>{result.installs}</span> : null}
										{result.url ? (
											<Button
												variant="bare"
												className="inline-flex w-fit max-w-full items-center gap-2 border-0 bg-transparent p-0 text-[color:var(--accent-strong)] hover:underline"
												onClick={() => void openExternalUrl(result.url)}
											>
												skills.sh ↗
											</Button>
										) : null}
									</div>
								</div>
								<Button
									size="sm"
									variant={isInstalled ? "outline" : "primary"}
									className={isInstalled ? "is-success" : ""}
									disabled={isInstalled || installing !== undefined}
									onClick={() => void install(result.package)}
								>
									{isInstalled ? t("installed") : isInstalling ? t("installing") : t("install")}
								</Button>
							</div>
						);
					})}
				</div>
			) : !searchError && !searching ? (
				<p className="max-w-[560px] text-[length:var(--text-md)] leading-[1.8] text-[color:var(--text-dim)]">
					{t("searchSkillsHintPrefix")}{" "}
					<Button
						variant="bare"
						className="inline-flex w-fit max-w-full items-center gap-2 border-0 bg-transparent p-0 text-[color:var(--accent-strong)] hover:underline"
						onClick={() => void openExternalUrl("https://skills.sh")}
					>
						skills.sh
					</Button>{" "}
					{t("searchSkillsHintSuffix")}
				</p>
			) : null}
		</div>
	);
}

export const SkillsConfigModal = memo(function SkillsConfigModal({
	workspacePath,
	projectTrusted,
	onTrustProject,
	onClose,
}: SkillsConfigModalProps) {
	const { t } = useI18n();
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
				const initial = list.find((skill) => skill.available !== false && !skill.disableModelInvocation) ?? list[0];
				if (initial && (initial.disableModelInvocation || initial.available === false)) {
					setDormantOpenGroups((groups) => ({ ...groups, [skillGroupLabel(initial)]: true }));
				}
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
		const dormant = skill.available === false;
		const hidden = !dormant && skill.disableModelInvocation;
		const key = updateKeyOf(skill);
		const hasUpdate = key !== null && updateStatuses[key]?.state === "update-available";
		return (
			<Button
				variant="bare"
				key={skill.filePath}
				className={`flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-sm)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${isSelected ? "bg-[var(--hover-strong)] font-semibold text-[color:var(--text)]" : ""} ${hidden || dormant ? "opacity-70" : ""}`}
				title={skill.error ?? skill.filePath}
				onClick={() => {
					setSelected(skill.filePath);
					setAddMode(false);
				}}
			>
				<span
					className={`size-[7px] shrink-0 rounded-full ${!dormant && !hidden ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" : "bg-[var(--border-strong)]"}`}
				/>
				<span>{skill.name}</span>
				{hidden ? (
					<span className="ml-auto rounded-[var(--radius-3xs)] border border-[var(--border-subtle)] px-1.5 py-px text-[length:var(--text-2xs)] font-semibold text-[color:var(--text-dim)]">
						{t("stateTagHidden")}
					</span>
				) : null}
				{dormant ? (
					<span className="ml-auto rounded-[var(--radius-3xs)] border border-[color-mix(in_srgb,var(--ds-warning)_40%,transparent)] px-1.5 py-px text-[length:var(--text-2xs)] font-semibold text-[color:var(--ds-warning)]">
						{t("stateTagDormant")}
					</span>
				) : null}
				{hasUpdate ? (
					<span
						className="shrink-0 text-[length:var(--text-md)] leading-none text-[#d97706]"
						title={t("updateAvailableTitle")}
					>
						↑
					</span>
				) : null}
			</Button>
		);
	}

	return (
		<Modal
			title={t("skills")}
			subtitle={workspacePath ? shortenPath(workspacePath) : "~"}
			className="h-[min(78vh,760px)] max-h-[calc(100dvh-16px)] w-[min(900px,100%)] overflow-hidden"
			bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
			onClose={onClose}
		>
			<div className="flex min-h-0 flex-1 max-md:flex-col">
				<aside className="flex w-[230px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-recessed)_88%,var(--surface-1))] max-md:max-h-[220px] max-md:w-full max-md:border-r-0 max-md:border-b">
					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
						{loading ? (
							<p className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
								{t("loadingSkills")}
							</p>
						) : loadError ? (
							<p className="m-0 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)] text-[color:var(--danger)]">
								{loadError}
							</p>
						) : skills.length === 0 ? (
							<p className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
								{t("noSkills")}
							</p>
						) : (
							groups.map((group) => {
								const activeSkills = group.skills.filter(
									(skill) => skill.available !== false && !skill.disableModelInvocation,
								);
								const hiddenSkills = group.skills.filter(
									(skill) => skill.available !== false && skill.disableModelInvocation,
								);
								const dormantSkills = group.skills.filter((skill) => skill.available === false);
								const dormantOpen = dormantOpenGroups[group.label] ?? false;
								return (
									<div key={group.label}>
										<div className="px-2 pt-2.5 pb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">
											{group.label}
										</div>
										{activeSkills.map(renderSkillRow)}
										{hiddenSkills.map(renderSkillRow)}
										{dormantSkills.length > 0 ? (
											<>
												<Button
													variant="bare"
													className="flex w-full items-center gap-1 rounded-[var(--radius-2xs)] border-0 bg-transparent px-2 py-1 text-left text-[length:var(--text-2xs)] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] hover:bg-[var(--hover)] hover:text-[color:var(--text-dim)]"
													aria-expanded={dormantOpen}
													title={t("dormantGroupHint")}
													onClick={() =>
														setDormantOpenGroups((current) => ({
															...current,
															[group.label]: !dormantOpen,
														}))
													}
												>
													<span className="text-[length:var(--text-2xs)]">{dormantOpen ? "▾" : "▸"}</span>
													{t("dormantGroup", { count: dormantSkills.length })}
												</Button>
												{dormantOpen ? dormantSkills.map(renderSkillRow) : null}
											</>
										) : null}
									</div>
								);
							})
						)}
					</div>
					<div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
						<Button
							variant="bare"
							className={`flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-sm)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${addMode ? "bg-[var(--hover-strong)] font-semibold text-[color:var(--text)]" : ""}`}
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
							{t("addSkill")}
						</Button>
					</div>
				</aside>
				<section className="min-w-0 flex-1 overflow-y-auto p-[18px]">
					{workspacePath && !projectTrusted ? (
						<div className="mb-4 mt-[-6px] flex items-baseline gap-2 rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--warning)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--warning)_9%,var(--surface-1))] px-2.5 py-2 text-[length:var(--text-xs)] text-[color:var(--text-dim)]">
							<strong>{t("skillProjectNotTrustedTitle")}</strong>
							<span>{t("skillProjectNotTrustedHint")}</span>
							{onTrustProject ? (
								<Button variant="outline" type="button" onClick={onTrustProject}>
									{t("trustProject")}
								</Button>
							) : null}
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
						<div className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
							{t("selectSkillHint")}
						</div>
					)}
				</section>
			</div>
			<footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--accent)_4%,var(--surface-1))] px-4 py-2.5">
				<div className="mr-auto flex min-w-0 items-center gap-2.5">
					{skills.some((skill) => skill.install) ? (
						<Button
							variant="outline"
							type="button"
							disabled={checkingAll || updatingKey !== undefined}
							onClick={() => void checkForUpdates()}
						>
							{checkingAll ? t("checking") : t("checkUpdates")}
						</Button>
					) : null}
					{availableUpdateCount > 0 ? (
						<span className="text-[length:var(--text-sm)] text-[color:var(--warning)]">
							{t("availableUpdates", { count: availableUpdateCount })}
						</span>
					) : null}
				</div>
				<Button variant="outline" type="button" onClick={onClose}>
					{t("close")}
				</Button>
			</footer>
		</Modal>
	);
});
