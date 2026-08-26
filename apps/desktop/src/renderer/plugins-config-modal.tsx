import { memo } from "react";
import type { DesktopPlugin } from "../shared/contracts.ts";
import { Modal } from "./modal.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	onClose: () => void;
}

export const PluginsConfigModal = memo(function PluginsConfigModal({ plugins, onClose }: PluginsConfigModalProps) {
	return (
		<Modal title="插件" onClose={onClose}>
			{plugins.length ? (
				<ul className="resource-list">
					{plugins.map((plugin) => (
						<li key={plugin.name}>
							<code>{plugin.name}</code>
							<span>
								{plugin.commands.length ? `提供 ${plugin.commands.length} 个斜杠命令` : "未注册斜杠命令"}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="modal-empty">信任项目后，此处会显示已加载的插件。</p>
			)}
		</Modal>
	);
});
