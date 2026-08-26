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
		<Modal title="Pi Desktop" className="app-settings-dialog" onClose={onClose}>
			<div className="app-settings-intro">
				<strong>Pi 桌面端设置</strong>
				<p>配置界面外观、桌面行为和任务通知。</p>
			</div>
			<div className="app-settings-cards">
				<section className="app-settings-card">
					<strong>语言</strong>
					<p>选择应用界面使用的语言。</p>
					<div className="choice-row">
						<button type="button" className="choice-button is-active" aria-pressed="true">
							简体中文
						</button>
					</div>
				</section>
				<section className="app-settings-card">
					<strong>外观</strong>
					<p>选择适合当前环境的显示主题。</p>
					<div className="choice-row">
						<button
							type="button"
							className={`choice-button ${theme === "light" ? "is-active" : ""}`}
							aria-pressed={theme === "light"}
							onClick={() => onChangeTheme("light")}
						>
							浅色
						</button>
						<button
							type="button"
							className={`choice-button ${theme === "dark" ? "is-active" : ""}`}
							aria-pressed={theme === "dark"}
							onClick={() => onChangeTheme("dark")}
						>
							深色
						</button>
					</div>
				</section>
				<section className="app-settings-card">
					<strong>桌面应用</strong>
					<p>控制关闭窗口和后台任务的行为。</p>
					<div className="app-settings-options">
						<label className="toggle-row">
							<span>
								<strong>关闭窗口时退出</strong>
								<small>关闭窗口时退出应用；关闭后可通过桌面图标重新启动。</small>
							</span>
							<input type="checkbox" checked={closeQuits} onChange={handleToggleCloseQuits} />
						</label>
						<label className="toggle-row">
							<span>
								<strong>任务完成通知</strong>
								<small>窗口处于后台时，在任务完成后发送系统通知。</small>
							</span>
							<input type="checkbox" checked={notifyOnComplete} onChange={onToggleNotify} />
						</label>
						<button className="outline-button settings-quit" type="button" onClick={() => void quitApp()}>
							退出 Pi
						</button>
					</div>
				</section>
			</div>
		</Modal>
	);
});
