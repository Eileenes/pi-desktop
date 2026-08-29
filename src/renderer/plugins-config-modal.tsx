import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopPlugin, DesktopPluginDiagnostic, DesktopPluginPackage } from "../shared/contracts.ts";
import {
	getPluginPackages,
	installPlugin,
	reloadSession,
	removePlugin,
	selectDirectory,
	togglePlugin,
	updatePlugin,
} from "./desktop-store.ts";
import { type I18n, type TranslationKey, useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	workspacePath?: string;
	projectTrusted: boolean;
	onClose: () => void;
}

const SCOPE_LABEL = { user: "GLOBAL", project: "PROJECT" } as const;

function detailScopeLabel(scope: DesktopPluginPackage["scope"]): string {
	return scope === "user" ? "global" : "project";
}

function shortenPath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+/u, "~");
}

function installLocation(scope: "user" | "project", workspacePath?: string): string {
	if (scope === "project" && workspacePath) return `${shortenPath(workspacePath)}/.pi/agent/{npm,git}`;
	return "~/.pi/agent/{npm,git}";
}

function statusLabel(status: DesktopPluginPackage["status"], t: I18n["t"]): string {
	switch (status) {
		case "disabled":
			return t("statusDisabled");
		case "error":
			return t("statusError");
		case "installed":
			return t("statusInstalled");
		case "loaded":
			return t("statusLoaded");
		case "missing":
			return t("statusMissing");
	}
}

function packageKey(pkg: Pick<DesktopPluginPackage, "scope" | "source">): string {
	return `${pkg.scope}\0${pkg.source}`;
}

function normalizeInstallSource(input: string): string {
	const value = input.trim();
	const command = value.match(/^\$?\s*pi\s+install\s+(\S+)\s*$/iu);
	return command?.[1] ?? value;
}

function resourceSummary(pkg: DesktopPluginPackage, t: I18n["t"]): string {
	if (!pkg.enabled) return t("statusDisabled");
	const parts = [
		[pkg.resources.extensions.length, "ext"],
		[pkg.resources.skills.length, "sk"],
		[pkg.resources.prompts.length, "prm"],
		[pkg.resources.themes.length, "thm"],
	]
		.filter(([count]) => Number(count) > 0)
		.map(([count, label]) => `${count} ${label}`);
	return parts.length ? parts.join(" · ") : t("noResourcesFound");
}

function versionSummary(pkg: DesktopPluginPackage, t: I18n["t"]): string {
	const versions = [
		pkg.version ? t("installedVersion", { version: pkg.version }) : undefined,
		pkg.configuredVersion
			? t("configuredVersion", { version: pkg.configuredVersion }).replace(/^·\s*/u, "")
			: undefined,
	].filter((version): version is string => Boolean(version));
	return versions.length ? versions.join(" · ") : "—";
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

function findInstalledPackage(
	packages: DesktopPluginPackage[],
	source: string,
	scope: DesktopPluginPackage["scope"],
): DesktopPluginPackage | undefined {
	const withoutNpmPrefix = source.startsWith("npm:") ? source.slice(4) : source;
	return (
		packages.find((pkg) => pkg.scope === scope && pkg.source === source) ??
		packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`) ??
		packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(source))
	);
}

const RESOURCE_GROUPS = [
	["extensions", "filterExtensions"],
	["skills", "filterSkills"],
	["prompts", "filterPrompts"],
	["themes", "filterThemes"],
] as const satisfies ReadonlyArray<readonly [keyof DesktopPluginPackage["resources"], TranslationKey]>;

export const PluginsConfigModal = memo(function PluginsConfigModal({
	workspacePath,
	projectTrusted,
	onClose,
}: PluginsConfigModalProps) {
	const { t } = useI18n();
	const [packages, setPackages] = useState<DesktopPluginPackage[]>([]);
	const [diagnostics, setDiagnostics] = useState<DesktopPluginDiagnostic[]>([]);
	const [hasActiveSession, setHasActiveSession] = useState(false);
	const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(projectTrusted);
	const [loading, setLoading] = useState(true);
	const [selectedKey, setSelectedKey] = useState<string>();
	const [installSource, setInstallSource] = useState("");
	const [installScope, setInstallScope] = useState<"user" | "project">("user");
	const [busyAction, setBusyAction] = useState<"install" | "toggle" | "update" | "reload" | "remove">();
	const [error, setError] = useState<string>();
	const [success, setSuccess] = useState<string>();
	const [removeArmed, setRemoveArmed] = useState(false);
	const installInputRef = useRef<HTMLInputElement>(null);
	const busy = busyAction !== undefined;
	const cwdLabel = workspacePath ? shortenPath(workspacePath) : "~/.pi/agent";
	const selected = useMemo(() => packages.find((pkg) => packageKey(pkg) === selectedKey), [packages, selectedKey]);
	const groupedPackages = useMemo(
		() =>
			(["project", "user"] as const)
				.map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
				.filter((group) => group.packages.length > 0),
		[packages],
	);
	const diagnosticCount = useMemo(
		() => diagnostics.length + packages.reduce((total, pkg) => total + pkg.diagnostics.length, 0),
		[diagnostics.length, packages],
	);
	const diagnosticSummary = useMemo(() => {
		const entries = [
			...diagnostics,
			...packages.flatMap((pkg) =>
				pkg.diagnostics.map((diagnostic) => ({ ...diagnostic, source: diagnostic.source ?? pkg.source })),
			),
		];
		return {
			hasError: entries.some((diagnostic) => diagnostic.type === "error"),
			title: entries
				.map((diagnostic) =>
					diagnostic.source ? `${diagnostic.source}: ${diagnostic.message}` : diagnostic.message,
				)
				.join("\n"),
		};
	}, [diagnostics, packages]);
	const resourceTotals = useMemo(
		() =>
			packages.reduce(
				(totals, pkg) => ({
					extensions: totals.extensions + pkg.resources.extensions.length,
					skills: totals.skills + pkg.resources.skills.length,
					prompts: totals.prompts + pkg.resources.prompts.length,
					themes: totals.themes + pkg.resources.themes.length,
				}),
				{ extensions: 0, skills: 0, prompts: 0, themes: 0 },
			),
		[packages],
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const next = await getPluginPackages();
			setPackages(next.packages);
			setDiagnostics(next.diagnostics);
			setHasActiveSession(next.hasActiveSession);
			setProjectResourcesLoaded(next.projectResourcesLoaded);
			setSelectedKey((current) => {
				if (current === "add") return current;
				if (current === undefined) return next.packages[0] ? packageKey(next.packages[0]) : "add";
				if (next.packages.some((pkg) => packageKey(pkg) === current)) return current;
				const [scope, ...sourceParts] = current.split("\0");
				const source = sourceParts.join("\0");
				if (scope !== "user" && scope !== "project") {
					return next.packages[0] ? packageKey(next.packages[0]) : "add";
				}
				const normalized = findInstalledPackage(next.packages, source, scope);
				return normalized ? packageKey(normalized) : next.packages[0] ? packageKey(next.packages[0]) : "add";
			});
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => void load(), [load]);
	useEffect(() => {
		if (selectedKey !== "add") return;
		const frame = window.requestAnimationFrame(() => installInputRef.current?.focus());
		return () => window.cancelAnimationFrame(frame);
	}, [selectedKey]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 选中包变化时需要重新解除危险删除按钮。
	useEffect(() => setRemoveArmed(false), [selectedKey]);
	useEffect(() => {
		if (!removeArmed) return;
		const timeout = window.setTimeout(() => setRemoveArmed(false), 4_000);
		return () => window.clearTimeout(timeout);
	}, [removeArmed]);

	async function run(
		actionName: NonNullable<typeof busyAction>,
		action: () => Promise<boolean | undefined>,
		successMessage: string,
	): Promise<void> {
		setBusyAction(actionName);
		setError(undefined);
		setSuccess(undefined);
		try {
			const performed = await action();
			if (performed === false) return;
			await load();
			setSuccess(successMessage);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusyAction(undefined);
		}
	}

	async function handleInstall(): Promise<void> {
		const source = normalizeInstallSource(installSource);
		if (!source) return;
		await run(
			"install",
			async () => {
				const performed = await installPlugin(source, installScope === "project");
				if (!performed) return false;
				setInstallSource("");
				setSelectedKey(`${installScope}\0${source}`);
				return true;
			},
			t("installedPlugin", { source }),
		);
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
					<strong>{pkg.source}</strong>
					<small>{resourceSummary(pkg, t)}</small>
					{pkg.version || pkg.configuredVersion ? <small>{versionSummary(pkg, t)}</small> : null}
					{pkg.filtered ? <small className="plugin-filtered-label">{t("filteredLabel")}</small> : null}
				</span>
			</button>
		);
	}

	return (
		<Modal
			title={t("plugins")}
			subtitle={cwdLabel}
			className="resource-config-modal plugin-config-modal"
			onClose={onClose}
		>
			{workspacePath && !projectResourcesLoaded ? (
				<output className="plugin-trust-banner">
					<strong>{t("projectNotTrustedTitle")}</strong>
					<span>{t("projectNotTrustedHint")}</span>
				</output>
			) : null}
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? <p className="modal-empty">{t("loadingPlugins")}</p> : null}
						{groupedPackages.map((group) => (
							<div className="plugin-package-group" key={group.scope}>
								<div className="settings-group-label">{SCOPE_LABEL[group.scope]}</div>
								{group.packages.map(renderPackageRow)}
							</div>
						))}
						{!loading && packages.length === 0 ? <p className="modal-empty">{t("noPlugins")}</p> : null}
					</div>
					<div className="resource-config-sidebar-footer">
						<button
							className={`resource-config-add ${selectedKey === "add" ? "is-active" : ""}`}
							type="button"
							onClick={() => {
								setSelectedKey("add");
								setError(undefined);
								setSuccess(undefined);
							}}
						>
							<svg aria-hidden="true" viewBox="0 0 24 24">
								<path d="M12 5v14M5 12h14" />
							</svg>
							{t("addPlugin").replace(/^＋\s*/u, "")}
						</button>
					</div>
				</aside>
				<section className="resource-config-detail">
					{selectedKey === "add" ? (
						<div className="resource-add-panel plugin-add-panel">
							<div className="plugin-add-heading">
								<div>
									<strong>{t("addPlugin").replace(/^＋\s*/u, "")}</strong>
									<code>{installLocation(installScope, workspacePath)}</code>
								</div>
								<a
									href="https://pi.dev/packages"
									onClick={(event) => {
										event.preventDefault();
										void window.piDesktop.openExternalUrl("https://pi.dev/packages");
									}}
								>
									<svg width="28" height="28" viewBox="0 0 800 800" aria-hidden="true">
										<path d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29V165.29ZM282.65 282.65V400H400V282.65Z" />
										<path d="M517.36 400H634.72V634.72H517.36Z" />
									</svg>
									pi.dev/packages
								</a>
							</div>
							<label>
								{t("sourceLabel")}
								<div className="plugin-source-picker">
									<input
										ref={installInputRef}
										className="mono"
										value={installSource}
										placeholder={t("sourcePlaceholder")}
										onChange={(event) => setInstallSource(event.target.value)}
										onPaste={(event) => {
											const pasted = event.clipboardData.getData("text");
											const normalized = normalizeInstallSource(pasted);
											if (normalized === pasted) return;
											event.preventDefault();
											setInstallSource(normalized);
										}}
										onBlur={(event) => setInstallSource(normalizeInstallSource(event.currentTarget.value))}
										onKeyDown={(event) => {
											if (event.key === "Enter" && normalizeInstallSource(installSource) && !busy) {
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
										{t("browse")}
									</button>
								</div>
							</label>
							<div className="plugin-install-actions">
								<fieldset className="plugin-scope-picker" aria-label={t("installScopeLabel")}>
									<button
										type="button"
										className={installScope === "user" ? "is-active" : ""}
										aria-pressed={installScope === "user"}
										onClick={() => setInstallScope("user")}
									>
										{t("global")}
									</button>
									<button
										type="button"
										className={installScope === "project" ? "is-active" : ""}
										aria-pressed={installScope === "project"}
										disabled={!workspacePath || !projectResourcesLoaded}
										title={!workspacePath || !projectResourcesLoaded ? t("projectNotTrustedHint") : undefined}
										onClick={() => setInstallScope("project")}
									>
										{t("project")}
									</button>
								</fieldset>
								<button
									className="accent-button"
									type="button"
									disabled={!normalizeInstallSource(installSource) || busy}
									onClick={() => void handleInstall()}
								>
									{busyAction === "install" ? t("installing") : t("installPluginAction")}
								</button>
							</div>
							<div className="plugin-example-list">
								<span>{t("examplesLabel")}</span>
								{["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"].map(
									(example) => (
										<button type="button" key={example} onClick={() => setInstallSource(example)}>
											{example}
										</button>
									),
								)}
							</div>
							{error ? <p className="plugin-action-message is-error">{error}</p> : null}
						</div>
					) : selected ? (
						<div className="plugin-detail">
							<div className="plugin-detail-heading">
								<div className="plugin-detail-identity">
									<button
										className={`plugin-toggle-switch ${selected.enabled ? "is-on" : ""}`}
										type="button"
										role="switch"
										aria-checked={selected.enabled}
										aria-label={selected.enabled ? t("disable") : t("enable")}
										disabled={busy || (selected.scope === "project" && !projectResourcesLoaded)}
										onClick={() =>
											void run(
												"toggle",
												() =>
													togglePlugin(
														selected.source,
														selected.scope === "project",
														!selected.enabled,
													).then(() => undefined),
												selected.enabled ? t("pluginDisabled") : t("pluginEnabled"),
											)
										}
									>
										<span />
									</button>
									<span className={`resource-scope-tag ${selected.scope === "project" ? "is-project" : ""}`}>
										{detailScopeLabel(selected.scope)}
									</span>
									{!selected.enabled ? <span className="plugin-state-tag">{t("statusDisabled")}</span> : null}
									{selected.enabled && selected.filtered ? (
										<span className="plugin-state-tag is-warning">{t("filteredLabel")}</span>
									) : null}
									<code title={selected.source}>{selected.source}</code>
								</div>
								<div className="resource-detail-actions">
									<button
										className="outline-button"
										type="button"
										disabled={busy || (selected.scope === "project" && !projectResourcesLoaded)}
										onClick={() =>
											void run(
												"update",
												() => updatePlugin(selected.source, selected.scope === "project"),
												t("pluginUpdated"),
											)
										}
									>
										{busyAction === "update" ? t("updatingPlugin") : t("update")}
									</button>
									<button
										className="outline-button"
										type="button"
										disabled={busy || !hasActiveSession}
										title={!hasActiveSession ? t("openSessionToReload") : undefined}
										onClick={() =>
											void run(
												"reload",
												async () => {
													await reloadSession();
													return undefined;
												},
												t("sessionReloaded"),
											)
										}
									>
										{busyAction === "reload" ? t("reloadingSession") : t("reloadSessionButton")}
									</button>
									<button
										className="danger-button"
										type="button"
										disabled={busy || (selected.scope === "project" && !projectResourcesLoaded)}
										onClick={() => {
											if (!removeArmed) {
												setRemoveArmed(true);
												return;
											}
											void run(
												"remove",
												async () => {
													await removePlugin(selected.source, selected.scope === "project");
													return undefined;
												},
												t("pluginRemoved"),
											);
										}}
									>
										{busyAction === "remove"
											? t("removingPlugin")
											: removeArmed
												? t("clickAgainToRemove")
												: t("remove")}
									</button>
								</div>
							</div>
							<div className="resource-meta-grid plugin-meta-grid">
								<span>{t("statusLabel")}</span>
								<strong className={`is-${selected.status}`}>{statusLabel(selected.status, t)}</strong>
								<span>{t("versionLabel")}</span>
								<strong>{versionSummary(selected, t)}</strong>
								<span>{t("packageNameLabel")}</span>
								<strong className="is-mono">{selected.packageName ?? t("unknown")}</strong>
								<span>{t("resourcesLabel")}</span>
								<strong>{resourceSummary(selected, t)}</strong>
								<span>{t("installedPathLabel")}</span>
								<strong className={`is-mono ${selected.installedPath ? "" : "is-error"}`}>
									{selected.installedPath ? shortenPath(selected.installedPath) : t("missingInstallPath")}
								</strong>
								<span>CWD</span>
								<strong className="is-mono">{cwdLabel}</strong>
							</div>
							<div className="plugin-resources-section">
								<strong>{t("resolvedResources")}</strong>
								<div className="plugin-resource-browser">
									{RESOURCE_GROUPS.map(([kind, labelKey]) => {
										const paths = selected.resources[kind];
										if (!paths.length) return null;
										return (
											<div className="plugin-resource-group" key={kind}>
												<span className="plugin-resource-kind">{t(labelKey)}</span>
												{paths.map((resource) => (
													<span
														className="plugin-resource-entry"
														key={resource.path}
														title={resource.path}
													>
														<code>{resource.name}</code>
														<small>{displayResourcePath(resource.relativePath, workspacePath)}</small>
													</span>
												))}
											</div>
										);
									})}
									{Object.values(selected.resources).every((paths) => paths.length === 0) ? (
										<p className="modal-empty">
											{selected.enabled ? t("noResourcesFound") : t("statusDisabled")}
										</p>
									) : null}
								</div>
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
							{success ? <p className="plugin-action-message is-success">{success}</p> : null}
							{error ? <p className="plugin-action-message is-error">{error}</p> : null}
						</div>
					) : (
						<div className="settings-empty-state">{t("selectPluginHint")}</div>
					)}
				</section>
			</div>
			<footer className="models-footer plugin-footer">
				<div>
					{error ? (
						<span className="is-error">{error}</span>
					) : success ? (
						<span className="is-success">{success}</span>
					) : diagnosticCount ? (
						<span
							className={`plugin-diagnostic-count ${diagnosticSummary.hasError ? "is-error" : "is-warning"}`}
							title={diagnosticSummary.title}
						>
							{t("diagnosticCount", { count: diagnosticCount })}
						</span>
					) : (
						<span>{`${resourceTotals.extensions} ext · ${resourceTotals.skills} skills · ${resourceTotals.prompts} prompts · ${resourceTotals.themes} themes`}</span>
					)}
				</div>
				<button className="outline-button" type="button" disabled={loading || busy} onClick={() => void load()}>
					{t("refresh")}
				</button>
				<button className="outline-button" type="button" onClick={onClose}>
					{t("close")}
				</button>
			</footer>
		</Modal>
	);
});
