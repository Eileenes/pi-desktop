import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopPlugin } from "../shared/contracts.ts";
import { getPluginPackages, installPlugin, removePlugin } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	workspacePath?: string;
	onClose: () => void;
}

interface InstalledPackage {
	source: string;
	scope: "user" | "project";
}

const SCOPE_LABEL: Record<"user" | "project", string> = { user: "GLOBAL", project: "PROJECT" };

export const PluginsConfigModal = memo(function PluginsConfigModal({
	plugins,
	workspacePath,
	onClose,
}: PluginsConfigModalProps) {
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
	const projectPackages = packages.filter((pkg) => pkg.scope === "project");
	const userPackages = packages.filter((pkg) => pkg.scope === "user");
	const selectedPlugin = selected
		? plugins.find((plugin) => plugin.name.includes(selected.source.split("/").at(-1) ?? selected.source))
		: undefined;

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

	function renderPackageRow(pkg: InstalledPackage) {
		const key = `${pkg.scope}\0${pkg.source}`;
		const commandCount = plugins.find((plugin) => plugin.name.includes(pkg.source.split("/").at(-1) ?? pkg.source))
			?.commands.length;
		return (
			<button
				key={key}
				className={`resource-config-row ${selectedKey === key ? "is-active" : ""}`}
				type="button"
				title={pkg.source}
				onClick={() => setSelectedKey(key)}
			>
				<span className="resource-status-dot is-on" />
				<span>{pkg.source}</span>
				<small>{commandCount ? `${commandCount} cmd` : SCOPE_LABEL[pkg.scope]}</small>
			</button>
		);
	}

	return (
		<Modal
			title="插件"
			subtitle={workspacePath ?? "~/.pi/agent/plugins"}
			className="resource-config-modal"
			onClose={onClose}
		>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? (
							<p className="modal-empty">正在加载插件…</p>
						) : (
							<>
								{projectPackages.length ? (
									<>
										<div className="settings-group-label">PROJECT</div>
										{projectPackages.map(renderPackageRow)}
									</>
								) : null}
								{userPackages.length ? (
									<>
										<div className="settings-group-label">GLOBAL</div>
										{userPackages.map(renderPackageRow)}
									</>
								) : null}
								{packages.length === 0 ? <p className="modal-empty">尚未安装插件。</p> : null}
							</>
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
							<strong>添加插件</strong>
							<p>支持 npm 包、Git URL 或本地路径。安装前会请求确认。</p>
							<label>
								源
								<input
									className="mono"
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
									<option value="user">全局</option>
									<option value="project">项目</option>
								</select>
							</label>
							<button
								className="accent-button"
								type="button"
								disabled={!installSource.trim() || busy}
								onClick={() => void handleInstall()}
							>
								{busy ? "安装中…" : "安装"}
							</button>
						</div>
					) : selected ? (
						<>
							<div className="resource-detail-heading">
								<div className="resource-detail-title-row">
									<span className={`resource-scope-tag ${selected.scope === "project" ? "is-project" : ""}`}>
										{SCOPE_LABEL[selected.scope]}
									</span>
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
							<h3 className="resource-detail-name">{selected.source}</h3>
							<div className="resource-meta-grid">
								<span>状态</span>
								<strong>{selectedPlugin ? "已加载" : "已安装 · 未加载"}</strong>
								<span>范围</span>
								<strong>{selected.scope === "user" ? "全局" : "项目"}</strong>
								<span>命令</span>
								<strong>{selectedPlugin ? `${selectedPlugin.commands.length} 个斜杠命令` : "—"}</strong>
								<span>命令列表</span>
								<strong className="is-mono">
									{selectedPlugin?.commands.length ? selectedPlugin.commands.join("  ") : "—"}
								</strong>
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
