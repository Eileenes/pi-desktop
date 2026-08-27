import { memo, useMemo, useState } from "react";
import type { DesktopSkill } from "../shared/contracts.ts";
import { installPlugin, toggleSkill } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface SkillsConfigModalProps {
	skills: DesktopSkill[];
	onClose: () => void;
}

export const SkillsConfigModal = memo(function SkillsConfigModal({ skills, onClose }: SkillsConfigModalProps) {
	const [selectedPath, setSelectedPath] = useState(
		() => skills.find((skill) => !skill.disableModelInvocation)?.filePath ?? skills[0]?.filePath,
	);
	const [togglingPath, setTogglingPath] = useState<string>();
	const [packageSource, setPackageSource] = useState("");
	const [packageScope, setPackageScope] = useState<"user" | "project">("user");
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string>();
	const selected = useMemo(() => skills.find((skill) => skill.filePath === selectedPath), [selectedPath, skills]);

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

	return (
		<Modal title="技能" subtitle="项目与用户技能" className="resource-config-modal" onClose={onClose}>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{skills.map((skill) => (
							<button
								key={skill.filePath}
								className={`resource-config-row ${selectedPath === skill.filePath ? "is-active" : ""}`}
								type="button"
								onClick={() => setSelectedPath(skill.filePath)}
							>
								<span className={`resource-status-dot ${skill.disableModelInvocation ? "" : "is-on"}`} />
								<span>{skill.name}</span>
							</button>
						))}
						{skills.length === 0 ? (
							<p className="modal-empty">信任项目后，此处会显示项目和用户目录中的技能。</p>
						) : null}
					</div>
				</aside>
				<section className="resource-config-detail">
					{selected ? (
						<>
							<div className="resource-detail-heading">
								<div>
									<strong>{selected.name}</strong>
									<code>/skill:{selected.name}</code>
								</div>
								<button
									type="button"
									className={`toggle-switch ${selected.disableModelInvocation ? "" : "is-on"}`}
									aria-pressed={!selected.disableModelInvocation}
									disabled={togglingPath === selected.filePath}
									onClick={() => void handleToggle(selected)}
								>
									<span className="toggle-knob" />
								</button>
							</div>
							<div className="resource-detail-card">
								<span>说明</span>
								<p>{selected.description || "该技能没有提供说明。"}</p>
							</div>
							<div className="resource-detail-card">
								<span>路径</span>
								<code>{selected.filePath}</code>
							</div>
						</>
					) : (
						<div className="settings-empty-state">选择一个技能查看详情</div>
					)}
				</section>
			</div>
			<div className="resource-package-install">
				<input
					value={packageSource}
					placeholder="安装包含技能的 npm、Git 或本地资源包"
					onChange={(event) => setPackageSource(event.target.value)}
				/>
				<select
					value={packageScope}
					onChange={(event) => setPackageScope(event.target.value as "user" | "project")}
				>
					<option value="user">用户</option>
					<option value="project">项目</option>
				</select>
				<button
					className="accent-button"
					type="button"
					disabled={!packageSource.trim() || installing}
					onClick={() => void handleInstall()}
				>
					{installing ? "安装中" : "安装资源包"}
				</button>
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
