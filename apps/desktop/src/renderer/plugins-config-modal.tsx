import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopPlugin } from "../shared/contracts.ts";
import { getPluginPackages, installPlugin, removePlugin } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	onClose: () => void;
}

interface InstalledPackage {
	source: string;
	scope: "user" | "project";
}

export const PluginsConfigModal = memo(function PluginsConfigModal({ plugins, onClose }: PluginsConfigModalProps) {
	const [packages, setPackages] = useState<InstalledPackage[]>([]);
	const [loading, setLoading] = useState(true);
	const [installSource, setInstallSource] = useState("");
	const [installScope, setInstallScope] = useState<"user" | "project">("user");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setPackages(await getPluginPackages());
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function handleInstall(): Promise<void> {
		const source = installSource.trim();
		if (!source) return;
		setBusy(true);
		setError(undefined);
		try {
			await installPlugin(source, installScope === "project");
			setInstallSource("");
			await load();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	async function handleRemove(pkg: InstalledPackage): Promise<void> {
		setBusy(true);
		setError(undefined);
		try {
			await removePlugin(pkg.source, pkg.scope === "project");
			await load();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Modal title="插件" onClose={onClose}>
			<div className="settings-modal-sections">
				<section className="settings-group">
					<p className="section-kicker">安装插件</p>
					<div className="plugin-install-form">
						<label htmlFor="plugin-source">源</label>
						<input
							id="plugin-source"
							value={installSource}
							placeholder="npm:@scope/plugin 或 git:https://... 或 /path"
							onChange={(event) => setInstallSource(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void handleInstall();
								}
							}}
						/>
						<label htmlFor="plugin-scope">范围</label>
						<select
							id="plugin-scope"
							value={installScope}
							onChange={(event) => setInstallScope(event.target.value as "user" | "project")}
						>
							<option value="user">用户</option>
							<option value="project">项目</option>
						</select>
						<button
							className="accent-button"
							type="button"
							disabled={!installSource.trim() || busy}
							onClick={() => void handleInstall()}
						>
							{busy ? "处理中…" : "安装"}
						</button>
					</div>
				</section>
				{error ? <p className="sidebar-error">{error}</p> : null}
				<section className="settings-group">
					<p className="section-kicker">已安装</p>
					{loading ? (
						<p className="modal-empty">正在加载插件…</p>
					) : packages.length ? (
						<ul className="resource-list plugin-list">
							{packages.map((pkg) => (
								<li key={`${pkg.scope}\0${pkg.source}`} className="skill-row">
									<div className="skill-info">
										<code>{pkg.source}</code>
										<span>{pkg.scope === "user" ? "用户范围" : "项目范围"}</span>
									</div>
									<button
										className="quiet-button"
										type="button"
										disabled={busy}
										onClick={() => void handleRemove(pkg)}
									>
										移除
									</button>
								</li>
							))}
						</ul>
					) : (
						<p className="modal-empty">暂无已安装的插件。</p>
					)}
				</section>
				{plugins.length ? (
					<section className="settings-group">
						<p className="section-kicker">已加载插件</p>
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
					</section>
				) : null}
			</div>
		</Modal>
	);
});
