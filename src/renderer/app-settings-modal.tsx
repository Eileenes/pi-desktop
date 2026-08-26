import { memo, useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "../shared/contracts.ts";
import { checkForUpdates, openCustomCss, openExternalUrl, quitApp, setCloseQuits } from "./desktop-store.ts";
import type { AppLanguage } from "./i18n.ts";
import { Modal } from "./modal.tsx";

interface AppSettingsModalProps {
	theme: "dark" | "light" | "system";
	language: AppLanguage;
	notifyOnComplete: boolean;
	soundOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light" | "system") => void;
	onChangeLanguage: (language: AppLanguage) => void;
	onToggleNotify: () => void;
	onToggleSound: () => void;
	onClose: () => void;
}

export const AppSettingsModal = memo(function AppSettingsModal({
	theme,
	language,
	notifyOnComplete,
	soundOnComplete,
	onChangeTheme,
	onChangeLanguage,
	onToggleNotify,
	onToggleSound,
	onClose,
}: AppSettingsModalProps) {
	const [closeQuits, setCloseQuitsState] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-close-quits") === "on",
	);
	const [update, setUpdate] = useState<DesktopUpdateInfo>();
	const [updateError, setUpdateError] = useState<string>();
	const [checkingUpdate, setCheckingUpdate] = useState(true);
	const [cssBusy, setCssBusy] = useState(false);
	const [cssError, setCssError] = useState<string>();

	useEffect(() => {
		let active = true;
		void checkForUpdates()
			.then((value) => {
				if (active) setUpdate(value);
			})
			.catch((error: unknown) => {
				if (active) setUpdateError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (active) setCheckingUpdate(false);
			});
		return () => {
			active = false;
		};
	}, []);

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
				<div className="settings-version-row">
					<span>当前 v{update?.currentVersion ?? "…"}</span>
					<span>
						{checkingUpdate
							? "正在检查更新…"
							: updateError
								? updateError
								: update?.updateAvailable
									? `最新 v${update.latestVersion}`
									: "已是最新版本"}
					</span>
					{update?.updateAvailable ? (
						<button
							className="outline-button"
							type="button"
							onClick={() => void openExternalUrl(update.releaseUrl)}
						>
							查看版本
						</button>
					) : null}
				</div>
			</div>
			<div className="app-settings-cards">
				<section className="app-settings-card">
					<strong>语言</strong>
					<p>选择应用界面使用的语言。</p>
					<div className="choice-row">
						<button
							type="button"
							className={`choice-button ${language === "zh-CN" ? "is-active" : ""}`}
							aria-pressed={language === "zh-CN"}
							onClick={() => onChangeLanguage("zh-CN")}
						>
							简体中文
						</button>
						<button
							type="button"
							className={`choice-button ${language === "en" ? "is-active" : ""}`}
							aria-pressed={language === "en"}
							onClick={() => onChangeLanguage("en")}
						>
							English
						</button>
					</div>
				</section>
				<section className="app-settings-card">
					<strong>外观</strong>
					<p>选择适合当前环境的显示主题。</p>
					<div className="choice-row">
						<button
							type="button"
							className={`choice-button ${theme === "system" ? "is-active" : ""}`}
							aria-pressed={theme === "system"}
							onClick={() => onChangeTheme("system")}
						>
							跟随系统
						</button>
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
					<div className="custom-css-row">
						<span>
							<strong>自定义样式表</strong>
							<small>修改字体、颜色与尺寸，重载窗口后生效。</small>
						</span>
						<button
							className="outline-button"
							type="button"
							disabled={cssBusy}
							onClick={() => {
								setCssBusy(true);
								setCssError(undefined);
								void openCustomCss()
									.catch((error: unknown) =>
										setCssError(error instanceof Error ? error.message : String(error)),
									)
									.finally(() => setCssBusy(false));
							}}
						>
							{cssBusy ? "正在打开…" : "打开 custom.css"}
						</button>
					</div>
					{cssError ? <p className="sidebar-error">{cssError}</p> : null}
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
								<strong>完成提示音</strong>
								<small>任务完成时播放本地短提示音。</small>
							</span>
							<input type="checkbox" checked={soundOnComplete} onChange={onToggleSound} />
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
