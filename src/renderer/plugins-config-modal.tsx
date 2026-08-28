import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type {
	DesktopPlugin,
	DesktopPluginPackage,
	DesktopPluginPackageFilterInput,
	DesktopPluginPackageResourceFilters,
} from "../shared/contracts.ts";
import {
	getPluginPackages,
	installPlugin,
	reloadSession,
	removePlugin,
	savePluginPackageFilters,
	selectDirectory,
	togglePlugin,
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

function displayResourcePath(path: string, workspacePath?: string): string {
	if (!workspacePath) return path;
	const normalizedRoot = workspacePath.replace(/[\\/]+$/u, "");
	if (path === normalizedRoot) return ".";
	if (path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`)) {
		return `./${path.slice(normalizedRoot.length).replace(/^[/\\]/u, "")}`;
	}
	return path.replace(/^\/Users\/[^/]+/u, "~");
}

const FILTER_KINDS = [
	["extensions", "filterExtensions"],
	["skills", "filterSkills"],
	["prompts", "filterPrompts"],
	["themes", "filterThemes"],
] as const satisfies ReadonlyArray<readonly [keyof DesktopPluginPackageResourceFilters, TranslationKey]>;

function parseFilterPatterns(text: string, t: I18n["t"]): string[] | string {
	const seen = new Set<string>();
	const patterns: string[] = [];
	for (const line of text.split("\n")) {
		const pattern = line.trim();
		if (!pattern) continue;
		if (pattern.length > 200) return t("patternTooLong", { pattern: pattern.slice(0, 40) });
		if (seen.has(pattern)) continue;
		seen.add(pattern);
		patterns.push(pattern);
	}
	if (patterns.length > 100) return t("tooManyPatterns");
	return patterns;
}

function PluginFilterEditor({
	pkg,
	busy,
	onSave,
}: {
	pkg: DesktopPluginPackage;
	busy: boolean;
	onSave: (input: DesktopPluginPackageFilterInput) => Promise<void>;
}) {
	const { t } = useI18n();
	const [autoload, setAutoload] = useState(pkg.autoload ?? true);
	const [texts, setTexts] = useState<Record<keyof DesktopPluginPackageResourceFilters, string>>(() => ({
		extensions: (pkg.filters?.extensions ?? []).join("\n"),
		skills: (pkg.filters?.skills ?? []).join("\n"),
		prompts: (pkg.filters?.prompts ?? []).join("\n"),
		themes: (pkg.filters?.themes ?? []).join("\n"),
	}));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	async function handleSave(): Promise<void> {
		setError(undefined);
		const filters = {} as DesktopPluginPackageResourceFilters;
		for (const [kind] of FILTER_KINDS) {
			const parsed = parseFilterPatterns(texts[kind], t);
			if (typeof parsed === "string") {
				setError(parsed);
				return;
			}
			filters[kind] = parsed;
		}
		setSaving(true);
		try {
			await onSave({ source: pkg.source, local: pkg.scope === "project", autoload, filters });
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="plugin-filter-editor">
			<div className="plugin-filter-header">
				<strong>{t("filterRules")}</strong>
				<label className="plugin-filter-autoload">
					<input
						type="checkbox"
						checked={autoload}
						disabled={busy || saving}
						onChange={(event) => setAutoload(event.target.checked)}
					/>
					{t("autoLoad")}
				</label>
			</div>
			<p className="plugin-filter-hint">
				{t("filterRulesHint1")} <code>*</code> {t("filterRulesHint2")}
			</p>
			<div className="plugin-filter-grid">
				{FILTER_KINDS.map(([kind, labelKey]) => (
					<label key={kind}>
						<span>{t(labelKey)}</span>
						<textarea
							spellCheck={false}
							value={texts[kind]}
							disabled={busy || saving}
							onChange={(event) => setTexts((current) => ({ ...current, [kind]: event.target.value }))}
						/>
					</label>
				))}
			</div>
			{error ? <p className="is-error">{error}</p> : null}
			<div className="plugin-filter-actions">
				<button className="accent-button" type="button" disabled={busy || saving} onClick={() => void handleSave()}>
					{saving ? t("saving") : t("saveFilters")}
				</button>
			</div>
		</div>
	);
}

export const PluginsConfigModal = memo(function PluginsConfigModal({
	plugins,
	workspacePath,
	projectTrusted,
	onClose,
}: PluginsConfigModalProps) {
	const { t } = useI18n();
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
				if (current === undefined) return next[0] ? packageKey(next[0]) : "add";
				if (next.some((pkg) => packageKey(pkg) === current)) return current;
				const [scope, ...sourceParts] = current.split("\0");
				const source = sourceParts.join("\0");
				const normalized = next.find(
					(pkg) =>
						pkg.scope === scope &&
						(pkg.source === source || pkg.source.endsWith(source) || source.endsWith(pkg.source)),
				);
				return normalized ? packageKey(normalized) : next[0] ? packageKey(next[0]) : "add";
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
		await run(
			async () => {
				await installPlugin(source, installScope === "project");
				setInstallSource("");
				setSelectedKey(`${installScope}\0${source}`);
			},
			t("installedPlugin", { source }),
		);
	}

	async function handleSaveFilters(input: DesktopPluginPackageFilterInput): Promise<void> {
		await run(async () => {
			await savePluginPackageFilters(input);
		}, t("filtersSaved"));
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
					<small>{resourceSummary(pkg, t)}</small>
					<small>
						{[pkg.version ? `v${pkg.version}` : undefined, statusLabel(pkg.status, t)]
							.filter(Boolean)
							.join(" · ")}
					</small>
					{pkg.filtered ? <small className="plugin-filtered-label">{t("filteredLabel")}</small> : null}
				</span>
			</button>
		);
	}

	return (
		<Modal
			title={t("plugins")}
			subtitle={workspacePath ?? "~/.pi/agent/plugins"}
			className="resource-config-modal plugin-config-modal"
			onClose={onClose}
		>
			<div className="resource-config-layout">
				<aside className="resource-config-sidebar">
					<div className="resource-config-scroll">
						{loading ? <p className="modal-empty">{t("loadingPlugins")}</p> : null}
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
						{!loading && packages.length === 0 ? <p className="modal-empty">{t("noPlugins")}</p> : null}
					</div>
					<button
						className={`resource-config-add ${selectedKey === "add" ? "is-active" : ""}`}
						type="button"
						onClick={() => setSelectedKey("add")}
					>
						{t("addPlugin")}
					</button>
				</aside>
				<section className="resource-config-detail">
					{workspacePath && !projectTrusted ? (
						<div className="resource-trust-banner" aria-live="polite">
							<strong>{t("projectNotTrustedTitle")}</strong>
							<span>{t("projectNotTrustedHint")}</span>
						</div>
					) : null}
					{selectedKey === "add" ? (
						<div className="resource-add-panel plugin-add-panel">
							<strong>{t("addPlugin")}</strong>
							<p>{t("addPluginHint")}</p>
							<a
								href="https://pi.dev/packages"
								onClick={(event) => {
									event.preventDefault();
									void window.piDesktop.openExternalUrl("https://pi.dev/packages");
								}}
							>
								{t("browsePackages")}
							</a>
							<label>
								{t("sourceLabel")}
								<div className="plugin-source-picker">
									<input
										className="mono"
										value={installSource}
										placeholder={t("sourcePlaceholder")}
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
										{t("browse")}
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
									{t("global")}
								</button>
								<button
									type="button"
									className={installScope === "project" ? "is-active" : ""}
									disabled={!workspacePath || !projectTrusted}
									onClick={() => setInstallScope("project")}
								>
									{t("project")}
								</button>
							</div>
							<button
								className="accent-button"
								type="button"
								disabled={!normalizeInstallSource(installSource) || busy}
								onClick={() => void handleInstall()}
							>
								{busy ? t("installing") : t("installPluginAction")}
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
												event.target.checked ? t("pluginEnabled") : t("pluginDisabled"),
											)
										}
									/>
									<span>{selected.enabled ? t("enable") : t("disable")}</span>
								</label>
							</div>
							<div className="resource-meta-grid">
								<span>{t("statusLabel")}</span>
								<strong className={`is-${selected.status}`}>{statusLabel(selected.status, t)}</strong>
								<span>{t("versionLabel")}</span>
								<strong>
									{selected.version ? t("installedVersion", { version: selected.version }) : "—"}
									{selected.configuredVersion
										? t("configuredVersion", { version: selected.configuredVersion })
										: ""}
								</strong>
								<span>{t("packageNameLabel")}</span>
								<strong className="is-mono">{selected.packageName ?? selected.source}</strong>
								<span>{t("installedPathLabel")}</span>
								<strong className={`is-mono ${selected.installedPath ? "" : "is-error"}`}>
									{selected.installedPath ?? t("missingInstallPath")}
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
							<PluginFilterEditor
								key={packageKey(selected)}
								busy={busy}
								pkg={selected}
								onSave={handleSaveFilters}
							/>
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
											t("pluginUpdated"),
										)
									}
								>
									{t("update")}
								</button>
								<button
									className="outline-button"
									type="button"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await reloadSession();
										}, t("sessionReloaded"))
									}
								>
									{t("reloadSessionButton")}
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
										}, t("pluginRemoved"));
									}}
								>
									{removeArmed ? t("clickAgainToRemove") : t("remove")}
								</button>
							</div>
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
					) : (
						<span>
							{t("footerSummary", {
								packages: packages.length,
								resources: loadedResourceCount,
								extensions: plugins.length,
							})}
						</span>
					)}
				</div>
				{diagnosticCount ? (
					<span className="plugin-diagnostic-count">{t("diagnosticCount", { count: diagnosticCount })}</span>
				) : null}
				<button className="outline-button" type="button" disabled={loading} onClick={() => void load()}>
					{t("refresh")}
				</button>
				<button className="outline-button" type="button" onClick={onClose}>
					{t("close")}
				</button>
			</footer>
		</Modal>
	);
});
