import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopPlugin, DesktopPluginPackage } from "../shared/contracts.ts";
import {
	getPluginPackages,
	installPlugin,
	reloadSession,
	removePlugin,
	selectDirectory,
	togglePlugin,
} from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	workspacePath?: string;
	projectTrusted: boolean;
	onClose: () => void;
}

const SCOPE_LABEL = { user: "GLOBAL", project: "PROJECT" } as const;
const STATUS_LABEL: Record<DesktopPluginPackage["status"], string> = {
	disabled: "已禁用",
	error: "加载错误",
	installed: "已安装",
	loaded: "已加载",
	missing: "未找到",
};

function packageKey(pkg: Pick<DesktopPluginPackage, "scope" | "source">): string {
	return `${pkg.scope}\0${pkg.source}`;
}

function normalizeInstallSource(input: string): string {
	return input.trim().replace(/^\$?\s*pi\s+install\s+/iu, "");
}

function resourceSummary(pkg: DesktopPluginPackage): string {
	const parts = [
		[pkg.resources.extensions.length, "ext"],
		[pkg.resources.skills.length, "sk"],
		[pkg.resources.prompts.length, "prm"],
		[pkg.resources.themes.length, "thm"],
	]
		.filter(([count]) => Number(count) > 0)
		.map(([count, label]) => `${count} ${label}`);
	return parts.length ? parts.join(" · ") : "未发现资源";
}

function displayResourcePath(path: string, workspacePath?: string): string {
	if (!workspacePath) return path;
	const normalizedRoot = workspacePath.replace(/[\\/]+$/u, "");
	if (path === normalizedRoot) return ".";
	if (path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`)) {
		return `./${path.slice(normalizedRoot.length).replace(/^[/\\]/u, "")}`;
	}
	return path.replace(/^\/Users\/[^/]+/u, "~");
}

export const PluginsConfigModal = memo(function PluginsConfigModal({
	plugins,
	workspacePath,
	projectTrusted,
	onClose,
}: PluginsConfigModalProps) {
	const [packages, setPackages] = useState<DesktopPluginPackage[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedKey, setSelectedKey] = useState<string>();
	const [installSource, setInstallSource] = useState("");
	const [installScope, setInstallScope] = useState<"user" | "project">("user");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [success, setSuccess] = useState<string>();
	const [removeArmed, setRemoveArmed] = useState(false);
	const selected = useMemo(() => packages.find((pkg) => packageKey(pkg) === selectedKey), [packages, selectedKey]);
	const projectPackages = packages.filter((pkg) => pkg.scope === "project");
	const userPackages = packages.filter((pkg) => pkg.scope === "user");
	const diagnosticCount = packages.reduce((total, pkg) => total + pkg.diagnostics.length, 0);
	const loadedResourceCount = packages.reduce(
		(total, pkg) =>
			total +
			pkg.resources.extensions.length +
			pkg.resources.skills.length +
			pkg.resources.prompts.length +
			pkg.resources.themes.length,
		0,
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const next = await getPluginPackages();
			setPackages(next);
			setSelectedKey((current) => {
				if (current === "add") return current;
				if (current === undefined) return undefined;
				if (next.some((pkg) => packageKey(pkg) === current)) return current;
				const [scope, ...sourceParts] = current.split("\0");
				const source = sourceParts.join("\0");
				const normalized = next.find(
					(pkg) =>
						pkg.scope === scope &&
						(pkg.source === source || pkg.source.endsWith(source) || source.endsWith(pkg.source)),
				);
				return normalized ? packageKey(normalized) : undefined;
			});
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => void load(), [load]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 选中包变化时需要重新解除危险删除按钮。
	useEffect(() => setRemoveArmed(false), [selectedKey]);
	useEffect(() => {
		if (!removeArmed) return;
		const timeout = window.setTimeout(() => setRemoveArmed(false), 4_000);
		return () => window.clearTimeout(timeout);
	}, [removeArmed]);

	async function run(action: () => Promise<void>, successMessage: string): Promise<void> {
		setBusy(true);
		setError(undefined);
		setSuccess(undefined);
		try {
			await action();
			await load();
			setSuccess(successMessage);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}

	async function handleInstall(): Promise<void> {
		const source = normalizeInstallSource(installSource);
		if (!source) return;
		await run(async () => {
			await installPlugin(source, installScope === "project");
			setInstallSource("");
			setSelectedKey(`${installScope}\0${source}`);
		}, `已安装 ${source}`);
	}

	function renderPackageRow(pkg: DesktopPluginPackage) {
		return (
			<button
				key={packageKey(pkg)}
				className={`plugin-package-row ${selectedKey === packageKey(pkg) ? "is-active" : ""}`}
				type="button"
				title={pkg.source}
				onClick={() => setSelectedKey(packageKey(pkg))}
			>
				<span className={`plugin-status-dot is-${pkg.status}`} />
				<span className="plugin-package-copy">
					<strong>{pkg.packageName ?? pkg.source.split("/").at(-1) ?? pkg.source}</strong>
					<small>{pkg.source}</small>
					<small>{resourceSummary(pkg)}</small>
					<small>
						{[pkg.version ? `v${pkg.version}` : undefined, STATUS_LABEL[pkg.status]].filter(Boolean).join(" · ")}
					</small>
					{pkg.filtered ? <small className="plugin-filtered-label">已过滤</small> : null}
				</span>
			</button>
		);
	}

	return (
		<Modal
			title="插件"
			subtitle={workspacePath ?? "~/.pi/agent/plugins"}
			className="resource-config-modal plugin-config-modal"
			onClose={onClose}
		>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? <p className="modal-empty">正在加载插件…</p> : null}
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
						{!loading && packages.length === 0 ? <p className="modal-empty">尚未安装插件。</p> : null}
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
					{workspacePath && !projectTrusted ? (
						<div className="resource-trust-banner" aria-live="polite">
							<strong>项目工作区尚未信任</strong>
							<span>项目级插件安装和加载会受到限制，请先在主界面完成信任确认。</span>
						</div>
					) : null}
					{selectedKey === "add" ? (
						<div className="resource-add-panel plugin-add-panel">
							<strong>添加插件</strong>
							<p>支持 npm 包、Git URL、本地路径，也可直接粘贴 `pi install ...` 命令。</p>
							<a
								href="https://pi.dev/packages"
								onClick={(event) => {
									event.preventDefault();
									void window.piDesktop.openExternalUrl("https://pi.dev/packages");
								}}
							>
								浏览 pi.dev/packages
							</a>
							<label>
								源
								<div className="plugin-source-picker">
									<input
										className="mono"
										value={installSource}
										placeholder="@scope/plugin、git:https://… 或 /path"
										onChange={(event) => setInstallSource(event.target.value)}
										onBlur={(event) => setInstallSource(normalizeInstallSource(event.currentTarget.value))}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												void handleInstall();
											}
										}}
									/>
									<button
										className="outline-button"
										type="button"
										disabled={busy}
										onClick={() =>
											void selectDirectory()
												.then((path) => {
													if (path) setInstallSource(path);
												})
												.catch((reason: unknown) => {
													setError(reason instanceof Error ? reason.message : String(reason));
												})
										}
									>
										浏览…
									</button>
								</div>
							</label>
							<div className="plugin-example-chips">
								{[
									"@mariozechner/pi-powerline",
									"git:https://github.com/user/pi-extension",
									"./extensions/local.ts",
								].map((example) => (
									<button type="button" key={example} onClick={() => setInstallSource(example)}>
										{example}
									</button>
								))}
							</div>
							<div className="plugin-scope-picker">
								<button
									type="button"
									className={installScope === "user" ? "is-active" : ""}
									onClick={() => setInstallScope("user")}
								>
									全局
								</button>
								<button
									type="button"
									className={installScope === "project" ? "is-active" : ""}
									disabled={!workspacePath || !projectTrusted}
									onClick={() => setInstallScope("project")}
								>
									项目
								</button>
							</div>
							<button
								className="accent-button"
								type="button"
								disabled={!normalizeInstallSource(installSource) || busy}
								onClick={() => void handleInstall()}
							>
								{busy ? "安装中…" : "安装插件"}
							</button>
						</div>
					) : selected ? (
						<div className="plugin-detail">
							<div className="resource-detail-heading">
								<div>
									<span className={`resource-scope-tag ${selected.scope === "project" ? "is-project" : ""}`}>
										{SCOPE_LABEL[selected.scope]}
									</span>
									<h3 className="resource-detail-name">{selected.packageName ?? selected.source}</h3>
								</div>
								<label className="plugin-toggle">
									<input
										type="checkbox"
										checked={selected.enabled}
										disabled={busy}
										onChange={(event) =>
											void run(
												() =>
													togglePlugin(
														selected.source,
														selected.scope === "project",
														event.target.checked,
													).then(() => undefined),
												event.target.checked ? "插件已启用" : "插件已禁用",
											)
										}
									/>
									<span>{selected.enabled ? "启用" : "禁用"}</span>
								</label>
							</div>
							<div className="resource-meta-grid">
								<span>状态</span>
								<strong className={`is-${selected.status}`}>{STATUS_LABEL[selected.status]}</strong>
								<span>版本</span>
								<strong>
									{selected.version ? `已安装 v${selected.version}` : "—"}
									{selected.configuredVersion ? ` · 配置 v${selected.configuredVersion}` : ""}
								</strong>
								<span>包名</span>
								<strong className="is-mono">{selected.packageName ?? selected.source}</strong>
								<span>安装路径</span>
								<strong className={`is-mono ${selected.installedPath ? "" : "is-error"}`}>
									{selected.installedPath ?? "安装路径缺失"}
								</strong>
								<span>CWD</span>
								<strong className="is-mono">{workspacePath ?? "—"}</strong>
							</div>
							<div className="plugin-resource-browser">
								{Object.entries(selected.resources).map(([kind, paths]) =>
									paths.length ? (
										<details key={kind} open>
											<summary>
												{kind.toUpperCase()} <span>{paths.length}</span>
											</summary>
											{paths.map((path) => (
												<code key={path} title={path}>
													{displayResourcePath(path, workspacePath)}
												</code>
											))}
										</details>
									) : null,
								)}
							</div>
							{selected.diagnostics.length ? (
								<div className="plugin-diagnostics">
									{selected.diagnostics.map((diagnostic, index) => (
										<p className={`is-${diagnostic.type}`} key={`${diagnostic.message}-${index}`}>
											{diagnostic.message}
											{diagnostic.path ? <code>{diagnostic.path}</code> : null}
										</p>
									))}
								</div>
							) : null}
							<div className="resource-detail-actions">
								<button
									className="outline-button"
									type="button"
									disabled={busy}
									onClick={() =>
										void run(
											() =>
												installPlugin(selected.source, selected.scope === "project").then(() => undefined),
											"插件已更新",
										)
									}
								>
									更新
								</button>
								<button
									className="outline-button"
									type="button"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await reloadSession();
										}, "会话已重载")
									}
								>
									重载会话
								</button>
								<button
									className="danger-button"
									type="button"
									disabled={busy}
									onClick={() => {
										if (!removeArmed) {
											setRemoveArmed(true);
											return;
										}
										void run(async () => {
											await removePlugin(selected.source, selected.scope === "project");
											setSelectedKey("add");
										}, "插件已移除");
									}}
								>
									{removeArmed ? "再次点击确认移除" : "移除"}
								</button>
							</div>
						</div>
					) : (
						<div className="settings-empty-state">选择一个插件查看详情</div>
					)}
				</section>
			</div>
			<footer className="models-footer plugin-footer">
				<div>
					{error ? (
						<span className="is-error">{error}</span>
					) : success ? (
						<span className="is-success">{success}</span>
					) : (
						<span>
							{packages.length} 个包 · {loadedResourceCount} 个资源 · {plugins.length} 个扩展
						</span>
					)}
				</div>
				{diagnosticCount ? <span className="plugin-diagnostic-count">{diagnosticCount} 条诊断</span> : null}
				<button className="outline-button" type="button" disabled={loading} onClick={() => void load()}>
					刷新
				</button>
				<button className="outline-button" type="button" onClick={onClose}>
					关闭
				</button>
			</footer>
		</Modal>
	);
});
