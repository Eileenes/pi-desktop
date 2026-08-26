import { memo, useState } from "react";
import type { DesktopSkill } from "../shared/contracts.ts";
import { toggleSkill } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface SkillsConfigModalProps {
	skills: DesktopSkill[];
	onClose: () => void;
}

export const SkillsConfigModal = memo(function SkillsConfigModal({ skills, onClose }: SkillsConfigModalProps) {
	const [togglingPath, setTogglingPath] = useState<string>();
	const [error, setError] = useState<string>();

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

	return (
		<Modal title="技能" onClose={onClose}>
			{error ? <p className="sidebar-error">{error}</p> : null}
			{skills.length ? (
				<ul className="resource-list skill-list">
					{skills.map((skill) => {
						const enabled = !skill.disableModelInvocation;
						const toggling = togglingPath === skill.filePath;
						return (
							<li key={skill.filePath} className="skill-row">
								<div className="skill-info">
									<code>/skill:{skill.name}</code>
									<span>{skill.description}</span>
								</div>
								<button
									type="button"
									className={`toggle-switch ${enabled ? "is-on" : ""}`}
									aria-pressed={enabled}
									disabled={toggling}
									onClick={() => void handleToggle(skill)}
								>
									<span className="toggle-knob" />
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="modal-empty">信任项目后，此处会显示项目和用户目录中的技能。</p>
			)}
		</Modal>
	);
});
