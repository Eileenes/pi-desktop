import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
	const [selectedKey, setSelectedKey] = useState<string>("add");
	const [installSource, setInstallSource] = useState("");
	const [installScope, setInstallScope] = useState<"user" | "project">("user");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const selected = useMemo(
		() => packages.find((pkg) => `${pkg.scope}\0${pkg.source}` === selectedKey),
		[packages, selectedKey],
	);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const next = await getPluginPackages();
			setPackages(next);
			setSelectedKey((current) =>
				current === "add"
					? current
					: next.some((pkg) => `${pkg.scope}\0${pkg.source}` === current)
						? current
						: "add",
			);
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
			setSelectedKey(`${installScope}\0${source}`);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}
	async function handleUpdate(pkg: InstalledPackage): Promise<void> {
		setBusy(true);
		setError(undefined);
		try {
			await installPlugin(pkg.source, pkg.scope === "project");
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
			setSelectedKey("add");
			await load();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Modal title="插件" subtitle="项目与用户插件" className="resource-config-modal" onClose={onClose}>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? (
							<p className="modal-empty">正在加载插件…</p>
						) : (
							packages.map((pkg) => (
								<button
									key={`${pkg.scope}\0${pkg.source}`}
									className={`resource-config-row ${selectedKey === `${pkg.scope}\0${pkg.source}` ? "is-active" : ""}`}
									type="button"
									onClick={() => setSelectedKey(`${pkg.scope}\0${pkg.source}`)}
								>
									<span className="resource-status-dot is-on" />
									<span>{pkg.source}</span>
									<small>{pkg.scope === "user" ? "用户" : "项目"}</small>
								</button>
							))
						)}
					</div>
					<button
						className={`resource-config-add ${selectedKey === "add" ? "is-active" : ""}`}
						type="button"
						onClick={() => setSelectedKey("add")}
					>
						＋ 添加插件
					</button>
				</aside>
				<section className="resource-config-detail">
					{selectedKey === "add" ? (
						<div className="resource-add-panel">
							<strong>安装插件</strong>
							<p>支持 npm 包、Git URL 或本地路径。</p>
							<label>
								源
								<input
									value={installSource}
									placeholder="npm:@scope/plugin 或 git:https://... 或 /path"
									onChange={(event) => setInstallSource(event.target.value)}
								/>
							</label>
							<label>
								范围
								<select
									value={installScope}
									onChange={(event) => setInstallScope(event.target.value as "user" | "project")}
								>
									<option value="user">用户</option>
									<option value="project">项目</option>
								</select>
							</label>
							<button
								className="accent-button"
								type="button"
								disabled={!installSource.trim() || busy}
								onClick={() => void handleInstall()}
							>
								{busy ? "处理中…" : "安装"}
							</button>
						</div>
					) : selected ? (
						<>
							<div className="resource-detail-heading">
								<div>
									<strong>{selected.source}</strong>
									<code>{selected.scope === "user" ? "用户范围" : "项目范围"}</code>
								</div>
								<div className="resource-detail-actions">
									<button
										className="outline-button"
										type="button"
										disabled={busy}
										onClick={() => void handleUpdate(selected)}
									>
										更新 / 重载
									</button>
									<button
										className="danger-button"
										type="button"
										disabled={busy}
										onClick={() => void handleRemove(selected)}
									>
										移除
									</button>
								</div>
							</div>
							<div className="resource-detail-card">
								<span>已加载资源</span>
								<p>
									{plugins.find((plugin) =>
										plugin.name.includes(selected.source.split("/").at(-1) ?? selected.source),
									)?.commands.length ?? 0}{" "}
									个斜杠命令
								</p>
							</div>
						</>
					) : (
						<div className="settings-empty-state">选择一个插件查看详情</div>
					)}
				</section>
			</div>
			<footer className="models-footer">
				{error ? (
					<p className="sidebar-error">{error}</p>
				) : (
					<span>
						{packages.length} 个已安装插件 · {plugins.length} 个已加载插件
					</span>
				)}
				<button className="outline-button" type="button" onClick={onClose}>
					关闭
				</button>
			</footer>
		</Modal>
	);
});
