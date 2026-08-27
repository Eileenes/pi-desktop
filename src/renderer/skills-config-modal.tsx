import { memo, useMemo, useState } from "react";
import type { DesktopSkill } from "../shared/contracts.ts";
import { installPlugin, toggleSkill } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface SkillsConfigModalProps {
	skills: DesktopSkill[];
	workspacePath?: string;
	onClose: () => void;
}

interface SkillGroup {
	key: string;
	label: string;
	skills: DesktopSkill[];
	dormant: DesktopSkill[];
}

function buildGroups(skills: DesktopSkill[], workspacePath: string | undefined): SkillGroup[] {
	const project: DesktopSkill[] = [];
	const global: DesktopSkill[] = [];
	for (const skill of skills) {
		const normalized = skill.filePath.replaceAll("\\", "/");
		const isProject = workspacePath ? normalized.startsWith(workspacePath.replaceAll("\\", "/")) : false;
		(isProject ? project : global).push(skill);
	}
	const splitDormant = (items: DesktopSkill[]) => ({
		active: items.filter((skill) => !skill.disableModelInvocation),
		dormant: items.filter((skill) => skill.disableModelInvocation),
	});
	const p = splitDormant(project);
	const g = splitDormant(global);
	const groups: SkillGroup[] = [];
	if (p.active.length || p.dormant.length)
		groups.push({ key: "project", label: "PROJECT", skills: p.active, dormant: p.dormant });
	if (g.active.length || g.dormant.length)
		groups.push({ key: "global", label: "GLOBAL", skills: g.active, dormant: g.dormant });
	return groups;
}

export const SkillsConfigModal = memo(function SkillsConfigModal({
	skills,
	workspacePath,
	onClose,
}: SkillsConfigModalProps) {
	const [selectedPath, setSelectedPath] = useState(
		() => skills.find((skill) => !skill.disableModelInvocation)?.filePath ?? skills[0]?.filePath,
	);
	const [togglingPath, setTogglingPath] = useState<string>();
	const [dormantOpen, setDormantOpen] = useState(false);
	const [packageSource, setPackageSource] = useState("");
	const [packageScope, setPackageScope] = useState<"user" | "project">("user");
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string>();
	const selected = useMemo(() => skills.find((skill) => skill.filePath === selectedPath), [selectedPath, skills]);
	const groups = useMemo(() => buildGroups(skills, workspacePath), [skills, workspacePath]);
	const isProjectSkill = selected
		? workspacePath
			? selected.filePath.replaceAll("\\", "/").startsWith(workspacePath.replaceAll("\\", "/"))
			: false
		: false;

	async function handleToggle(skill: DesktopSkill): Promise<void> {
		setTogglingPath(skill.filePath);
		setError(undefined);
		try {
			await toggleSkill(skill.filePath, !skill.disableModelInvocation);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setTogglingPath(undefined);
		}
	}

	async function handleInstall(): Promise<void> {
		const source = packageSource.trim();
		if (!source) return;
		setInstalling(true);
		setError(undefined);
		try {
			await installPlugin(source, packageScope === "project");
			setPackageSource("");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setInstalling(false);
		}
	}

	function renderSkillRow(skill: DesktopSkill) {
		return (
			<button
				key={skill.filePath}
				className={`resource-config-row ${selectedPath === skill.filePath ? "is-active" : ""}`}
				type="button"
				title={skill.filePath}
				onClick={() => setSelectedPath(skill.filePath)}
			>
				<span className={`resource-status-dot ${skill.disableModelInvocation ? "" : "is-on"}`} />
				<span>{skill.name}</span>
			</button>
		);
	}

	return (
		<Modal
			title="技能"
			subtitle={workspacePath ?? "~/.pi/agent/skills"}
			className="resource-config-modal"
			onClose={onClose}
		>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{groups.map((group) => (
							<div key={group.key}>
								<div className="settings-group-label">{group.label}</div>
								{group.skills.map(renderSkillRow)}
								{group.dormant.length ? (
									<>
										<button
											className="settings-dormant-toggle"
											type="button"
											aria-expanded={dormantOpen}
											onClick={() => setDormantOpen((open) => !open)}
										>
											{dormantOpen ? "▾" : "▸"} DORMANT ({group.dormant.length})
										</button>
										{dormantOpen ? group.dormant.map(renderSkillRow) : null}
									</>
								) : null}
							</div>
						))}
						{skills.length === 0 ? (
							<p className="modal-empty">信任项目后，此处会显示项目和用户目录中的技能。</p>
						) : null}
					</div>
					<div className="resource-package-install">
						<input
							value={packageSource}
							placeholder="npm / git / 本地路径"
							onChange={(event) => setPackageSource(event.target.value)}
						/>
						<select
							value={packageScope}
							onChange={(event) => setPackageScope(event.target.value as "user" | "project")}
						>
							<option value="user">全局</option>
							<option value="project">项目</option>
						</select>
						<button
							className="accent-button"
							type="button"
							disabled={!packageSource.trim() || installing}
							onClick={() => void handleInstall()}
						>
							{installing ? "安装中" : "安装"}
						</button>
					</div>
				</aside>
				<section className="resource-config-detail">
					{selected ? (
						<>
							<div className="resource-detail-heading">
								<div className="resource-detail-title-row">
									<button
										type="button"
										className={`toggle-switch ${selected.disableModelInvocation ? "" : "is-on"}`}
										aria-pressed={!selected.disableModelInvocation}
										disabled={togglingPath === selected.filePath}
										onClick={() => void handleToggle(selected)}
									>
										<span className="toggle-knob" />
									</button>
									<span className={`resource-scope-tag ${isProjectSkill ? "is-project" : ""}`}>
										{isProjectSkill ? "PROJECT" : "GLOBAL"}
									</span>
								</div>
								<code className="resource-detail-path" title={selected.filePath}>
									{selected.filePath}
								</code>
							</div>
							<h3 className="resource-detail-name">{selected.name}</h3>
							<p className="resource-detail-description">{selected.description || "该技能没有提供说明。"}</p>
						</>
					) : (
						<div className="settings-empty-state">选择一个技能查看详情</div>
					)}
				</section>
			</div>
			<footer className="models-footer">
				{error ? <p className="sidebar-error">{error}</p> : <span>{skills.length} 个技能</span>}
				<button className="outline-button" type="button" onClick={onClose}>
					关闭
				</button>
			</footer>
		</Modal>
	);
});
