import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "../shared/contracts.ts";
import { checkForUpdates, openCustomCss, openExternalUrl, quitApp, setCloseQuits } from "./desktop-store.ts";
import type { AppLanguage } from "./i18n.ts";
import { Modal } from "./modal.tsx";

interface AppSettingsModalProps {
	theme: "dark" | "light";
	language: AppLanguage;
	notifyOnComplete: boolean;
	onChangeTheme: (theme: "dark" | "light") => void;
	onChangeLanguage: (language: AppLanguage) => void;
	onToggleNotify: () => void;
	onClose: () => void;
}

const PRODUCT_NAME = "Pi Agent";
const REPOSITORY = "abcwyc/pi-agent-desktop";
const RELEASES_URL = "https://github.com/abcwyc/pi-agent-desktop/releases";

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button
			className={`choice-button ${active ? "is-active" : ""}`}
			type="button"
			aria-pressed={active}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

export const AppSettingsModal = memo(function AppSettingsModal({
	theme,
	language,
	notifyOnComplete,
	onChangeTheme,
	onChangeLanguage,
	onToggleNotify,
	onClose,
}: AppSettingsModalProps) {
	const [closeQuits, setCloseQuitsState] = useState<boolean>(
		() => localStorage.getItem("pi-desktop-close-quits") === "on",
	);
	const [update, setUpdate] = useState<DesktopUpdateInfo>();
	const [checkingUpdate, setCheckingUpdate] = useState(true);
	const [updateError, setUpdateError] = useState<string>();
	const [cssBusy, setCssBusy] = useState(false);
	const [cssError, setCssError] = useState<string>();

	const runUpdateCheck = useCallback(async () => {
		setCheckingUpdate(true);
		setUpdateError(undefined);
		try {
			setUpdate(await checkForUpdates());
		} catch (error: unknown) {
			setUpdateError(error instanceof Error ? error.message : String(error));
		} finally {
			setCheckingUpdate(false);
		}
	}, []);

	useEffect(() => {
		void runUpdateCheck();
	}, [runUpdateCheck]);

	function handleToggleCloseQuits(): void {
		const next = !closeQuits;
		setCloseQuitsState(next);
		localStorage.setItem("pi-desktop-close-quits", next ? "on" : "off");
		void setCloseQuits(next);
	}

	const versionText = checkingUpdate ? "正在检查更新…" : (update?.currentVersion ?? "…");
	const latestText = update?.latestVersion ? `latest ${update.latestVersion}` : undefined;
	const updateAvailable = update?.updateAvailable === true;

	return (
		<Modal title={PRODUCT_NAME} subtitle="本地 AI 编码智能体" className="app-settings-dialog" onClose={onClose}>
			<div className="settings-meta-row">
				<button
					className="settings-meta-chip"
					type="button"
					title="打开仓库主页"
					onClick={() => void openExternalUrl(`https://github.com/${REPOSITORY}`)}
				>
					<span>仓库</span>
					<span className="is-value">{REPOSITORY}</span>
					<span aria-hidden="true">↗</span>
				</button>
				<button
					className={`settings-meta-chip ${updateAvailable ? "is-emphasized" : ""}`}
					type="button"
					title={latestText ? `当前 ${versionText} · ${latestText}` : `当前版本 ${versionText}`}
					onClick={() => void openExternalUrl(update?.releaseUrl ?? RELEASES_URL)}
				>
					<span>{updateAvailable ? `v${versionText} → v${update?.latestVersion}` : `版本 ${versionText}`}</span>
					{updateAvailable ? <span aria-hidden="true">↗</span> : null}
				</button>
				{updateAvailable ? (
					<button
						className="accent-button"
						type="button"
						onClick={() => void openExternalUrl(update?.releaseUrl ?? RELEASES_URL)}
					>
						获取更新
					</button>
				) : null}
			</div>
			{updateError ? (
				<p className="settings-update-error" aria-live="polite">
					{updateError}
					<button className="settings-update-retry" type="button" onClick={() => void runUpdateCheck()}>
						重试
					</button>
				</p>
			) : null}
			<div className="app-settings-cards">
				<section className="app-settings-card">
					<strong>语言</strong>
					<p>选择应用界面使用的语言。</p>
					<div className="choice-row">
						<ChoiceButton active={language === "zh-CN"} onClick={() => onChangeLanguage("zh-CN")}>
							简体中文
						</ChoiceButton>
						<ChoiceButton active={language === "en"} onClick={() => onChangeLanguage("en")}>
							English
						</ChoiceButton>
					</div>
				</section>
				<section className="app-settings-card">
					<strong>外观</strong>
					<p>选择适合当前环境的显示主题。</p>
					<div className="choice-row">
						<ChoiceButton active={theme === "light"} onClick={() => onChangeTheme("light")}>
							浅色
						</ChoiceButton>
						<ChoiceButton active={theme === "dark"} onClick={() => onChangeTheme("dark")}>
							深色
						</ChoiceButton>
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
								<strong>任务完成通知</strong>
								<small>窗口处于后台时，在任务完成后发送系统通知。</small>
							</span>
							<input type="checkbox" checked={notifyOnComplete} onChange={onToggleNotify} />
						</label>
						<label className="toggle-row">
							<span>
								<strong>关闭窗口时退出</strong>
								<small>关闭窗口时退出应用；关闭后可通过桌面图标重新启动。</small>
							</span>
							<input type="checkbox" checked={closeQuits} onChange={handleToggleCloseQuits} />
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
