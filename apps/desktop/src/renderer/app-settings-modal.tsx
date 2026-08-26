import { memo, useState } from "react";
import { quitApp, setCloseQuits } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface AppSettingsModalProps {
	theme: "dark" | "light";
	notifyOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light") => void;
	onToggleNotify: () => void;
	onClose: () => void;
}

export const AppSettingsModal = memo(function AppSettingsModal({
	theme,
	notifyOnComplete,
	onChangeTheme,
	onToggleNotify,
	onClose,
}: AppSettingsModalProps) {
	const [closeQuits, setCloseQuitsState] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-close-quits") === "on",
	);

	function handleToggleCloseQuits(): void {
		const next = !closeQuits;
		setCloseQuitsState(next);
		localStorage.setItem("pi-desktop-close-quits", next ? "on" : "off");
		void setCloseQuits(next);
	}

	return (
		<Modal title="设置" onClose={onClose}>
			<div className="settings-modal-sections">
				<section className="settings-group">
					<p className="section-kicker">主题</p>
					<div className="choice-row">
						<button
							type="button"
							className={`choice-button ${theme === "light" ? "is-active" : ""}`}
							onClick={() => onChangeTheme("light")}
						>
							浅色
						</button>
						<button
							type="button"
							className={`choice-button ${theme === "dark" ? "is-active" : ""}`}
							onClick={() => onChangeTheme("dark")}
						>
							深色
						</button>
					</div>
				</section>
				<section className="settings-group">
					<p className="section-kicker">行为</p>
					<label className="toggle-row">
						<span>
							<strong>关闭窗口时退出</strong>
							<small>关闭时退出应用，否则最小化到托盘继续运行。</small>
						</span>
						<input type="checkbox" checked={closeQuits} onChange={handleToggleCloseQuits} />
					</label>
					<label className="toggle-row">
						<span>
							<strong>任务完成通知</strong>
							<small>窗口在后台时，任务完成后发送系统通知。</small>
						</span>
						<input type="checkbox" checked={notifyOnComplete} onChange={onToggleNotify} />
					</label>
				</section>
				<section className="settings-group">
					<p className="section-kicker">应用</p>
					<button className="outline-button" type="button" onClick={() => void quitApp()}>
						退出 Pi
					</button>
				</section>
			</div>
		</Modal>
	);
});
