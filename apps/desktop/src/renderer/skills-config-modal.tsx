import { memo } from "react";
import type { DesktopSkill } from "../shared/contracts.ts";
import { Modal } from "./modal.tsx";

interface SkillsConfigModalProps {
	skills: DesktopSkill[];
	onClose: () => void;
}

export const SkillsConfigModal = memo(function SkillsConfigModal({ skills, onClose }: SkillsConfigModalProps) {
	return (
		<Modal title="技能" onClose={onClose}>
			{skills.length ? (
				<ul className="resource-list">
					{skills.map((skill) => (
						<li key={skill.name}>
							<code>/skill:{skill.name}</code>
							<span>{skill.description}</span>
						</li>
					))}
				</ul>
			) : (
				<p className="modal-empty">信任项目后，此处会显示项目和用户目录中的技能。</p>
			)}
		</Modal>
	);
});
