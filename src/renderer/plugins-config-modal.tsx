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
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";
import { Switch } from "./ui/switch.tsx";

interface PluginsConfigModalProps {
	plugins: DesktopPlugin[];
	workspacePath?: string;
	projectTrusted: boolean;
	/** Opens the project trust confirmation, so the banner is actionable. */
	onTrustProject?: () => void;
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
	onTrustProject,
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
		const local = installScope === "project";
		await run(
			"install",
			async () => {
				const performed = await installPlugin(source, local);
				if (!performed) return false;
				setInstallSource("");
				setSelectedKey(`${local ? "project" : "user"}\0${source}`);
				return true;
			},
			t("installedPlugin", { source }),
		);
	}

	function renderPackageRow(pkg: DesktopPluginPackage) {
		return (
			<Button
				variant="bare"
				key={packageKey(pkg)}
				className={`grid w-full grid-cols-[7px_minmax(0,1fr)] items-start gap-2 rounded-[var(--radius-2xs)] p-2 text-left text-[color:var(--text-dim)] hover:bg-[var(--hover)] ${selectedKey === packageKey(pkg) ? "bg-[var(--hover-strong)]" : ""}`}
				title={pkg.source}
				onClick={() => setSelectedKey(packageKey(pkg))}
			>
				<span
					className={`mt-1.5 size-[7px] rounded-full ${pkg.status === "loaded" ? "bg-[var(--accent)]" : pkg.status === "installed" ? "bg-[var(--warning)]" : pkg.status === "error" || pkg.status === "missing" ? "bg-[var(--danger)]" : "bg-[var(--muted)]"}`}
				/>
				<span className="grid min-w-0 gap-0.5">
					<strong>{pkg.source}</strong>
					<small>{resourceSummary(pkg, t)}</small>
					{pkg.version || pkg.configuredVersion ? <small>{versionSummary(pkg, t)}</small> : null}
					{pkg.filtered ? <small className="text-[color:var(--warning)]">{t("filteredLabel")}</small> : null}
				</span>
			</Button>
		);
	}

	return (
		<Modal
			title={t("plugins")}
			subtitle={cwdLabel}
			className="h-[min(78vh,760px)] max-h-[calc(100dvh-16px)] w-[min(900px,100%)] overflow-hidden"
			bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
			onClose={onClose}
		>
			{workspacePath && !projectResourcesLoaded ? (
				<output className="flex items-baseline gap-2 border-b border-[var(--border-subtle)] px-[18px] py-2 text-[length:var(--text-sm)] text-[color:var(--text-dim)] max-md:flex-col max-md:items-start">
					<strong>{t("projectNotTrustedTitle")}</strong>
					<span>{t("projectNotTrustedHint")}</span>
					{onTrustProject ? (
						<Button variant="outline" type="button" onClick={onTrustProject}>
							{t("trustProject")}
						</Button>
					) : null}
				</output>
			) : null}
			<div className="flex min-h-0 flex-1 max-md:flex-col">
				<aside className="flex w-[230px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-recessed)_88%,var(--surface-1))] max-md:max-h-[220px] max-md:w-full max-md:border-r-0 max-md:border-b">
					<div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
						{loading ? (
							<p className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
								{t("loadingPlugins")}
							</p>
						) : null}
						{groupedPackages.map((group) => (
							<div className="mt-1" key={group.scope}>
								<div className="px-2 pt-2.5 pb-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">
									{SCOPE_LABEL[group.scope]}
								</div>
								{group.packages.map(renderPackageRow)}
							</div>
						))}
						{!loading && packages.length === 0 ? (
							<p className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
								{t("noPlugins")}
							</p>
						) : null}
					</div>
					<div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
						<Button
							variant="bare"
							className={`flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-sm)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] ${selectedKey === "add" ? "bg-[var(--hover-strong)] font-semibold text-[color:var(--text)]" : ""}`}
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
						</Button>
					</div>
				</aside>
				<section className="min-w-0 flex-1 overflow-y-auto p-[18px]">
					{selectedKey === "add" ? (
						<div className="flex min-h-full max-w-[660px] flex-col gap-[18px]">
							<div className="flex items-start justify-between gap-4">
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
								<div className="flex gap-2">
									<Field
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
									<Button
										variant="outline"
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
									</Button>
								</div>
							</label>
							<div className="flex flex-wrap items-center gap-2.5">
								<Segmented aria-label={t("installScopeLabel")}>
									<Segment active={installScope === "user"} onClick={() => setInstallScope("user")}>
										{t("global")}
									</Segment>
									<Segment
										active={installScope === "project"}
										disabled={!workspacePath || !projectResourcesLoaded}
										title={!workspacePath || !projectResourcesLoaded ? t("projectNotTrustedHint") : undefined}
										onClick={() => setInstallScope("project")}
									>
										{t("project")}
									</Segment>
								</Segmented>
								<Button
									variant="primary"
									type="button"
									disabled={!normalizeInstallSource(installSource) || busy}
									onClick={() => void handleInstall()}
								>
									{busyAction === "install" ? t("installing") : t("installPluginAction")}
								</Button>
							</div>
							<div className="grid gap-1.5">
								<span>{t("examplesLabel")}</span>
								{["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"].map(
									(example) => (
										<Button
											variant="bare"
											className="w-full min-h-8 overflow-hidden rounded-[var(--radius-2xs)] border border-[var(--border-subtle)] px-2 py-1.5 text-left text-[color:var(--muted)]"
											key={example}
											onClick={() => setInstallSource(example)}
										>
											{example}
										</Button>
									),
								)}
							</div>
							{error ? (
								<p className="m-0 text-[length:var(--text-sm)] whitespace-pre-wrap text-[color:var(--danger)]">
									{error}
								</p>
							) : null}
						</div>
					) : selected ? (
						<div className="flex max-w-[680px] flex-col gap-5">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="flex min-w-[180px] flex-1 items-center gap-2">
									<Switch
										checked={selected.enabled}
										aria-label={selected.enabled ? t("disable") : t("enable")}
										disabled={busy || (selected.scope === "project" && !projectResourcesLoaded)}
										onCheckedChange={() =>
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
									/>
									<span
										className={`rounded-[var(--radius-3xs)] px-1.5 py-px text-[length:var(--text-2xs)] font-semibold tracking-wide ${selected.scope === "project" ? "bg-[color-mix(in_oklab,var(--ds-purple)_12%,transparent)] text-[color-mix(in_oklab,var(--ds-purple)_85%,transparent)]" : "bg-[var(--overlay-7)] text-[color:var(--text-dim)]"}`}
									>
										{detailScopeLabel(selected.scope)}
									</span>
									{!selected.enabled ? (
										<span className="rounded-[var(--radius-3xs)] bg-[var(--overlay-7)] px-1.5 py-px text-[length:var(--text-2xs)] whitespace-nowrap text-[color:var(--muted)]">
											{t("statusDisabled")}
										</span>
									) : null}
									{selected.enabled && selected.filtered ? (
										<span className="rounded-[var(--radius-3xs)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-1.5 py-px text-[length:var(--text-2xs)] whitespace-nowrap text-[color:var(--warning)]">
											{t("filteredLabel")}
										</span>
									) : null}
									<code title={selected.source}>{selected.source}</code>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
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
									</Button>
									<Button
										variant="outline"
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
									</Button>
									<Button
										variant="danger"
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
									</Button>
								</div>
							</div>
							<div className="grid max-w-none grid-cols-[minmax(96px,130px)_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-2 rounded-[var(--radius-s)] border border-[var(--border-subtle)] p-3.5">
								<span>{t("statusLabel")}</span>
								<strong
									className={`font-medium ${selected.status === "installed" ? "text-[color:var(--warning)]" : selected.status === "error" || selected.status === "missing" ? "text-[color:var(--danger)]" : selected.status === "disabled" ? "text-[color:var(--muted)]" : "text-[color:var(--text-dim)]"}`}
								>
									{statusLabel(selected.status, t)}
								</strong>
								<span>{t("versionLabel")}</span>
								<strong>{versionSummary(selected, t)}</strong>
								<span>{t("packageNameLabel")}</span>
								<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] font-medium [overflow-wrap:anywhere]">
									{selected.packageName ?? t("unknown")}
								</strong>
								<span>{t("resourcesLabel")}</span>
								<strong>{resourceSummary(selected, t)}</strong>
								<span>{t("installedPathLabel")}</span>
								<strong
									className={
										selected.installedPath
											? "font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] font-medium [overflow-wrap:anywhere]"
											: "font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] font-medium text-[color:var(--danger)] [overflow-wrap:anywhere]"
									}
								>
									{selected.installedPath ? shortenPath(selected.installedPath) : t("missingInstallPath")}
								</strong>
								<span>CWD</span>
								<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] font-medium [overflow-wrap:anywhere]">
									{cwdLabel}
								</strong>
							</div>
							<div className="grid gap-2">
								<strong>{t("resolvedResources")}</strong>
								<div>
									{RESOURCE_GROUPS.map(([kind, labelKey]) => {
										const paths = selected.resources[kind];
										if (!paths.length) return null;
										return (
											<div
												className="grid gap-1.5 border-t border-[var(--border-subtle)] py-3 first:border-t-0 first:pt-0 last:pb-0"
												key={kind}
											>
												<span className="text-[length:var(--text-2xs)] font-bold uppercase tracking-wide text-[color:var(--muted)]">
													{t(labelKey)}
												</span>
												{paths.map((resource) => (
													<span className="grid min-w-0 gap-px" key={resource.path} title={resource.path}>
														<code>{resource.name}</code>
														<small>{displayResourcePath(resource.relativePath, workspacePath)}</small>
													</span>
												))}
											</div>
										);
									})}
									{Object.values(selected.resources).every((paths) => paths.length === 0) ? (
										<p className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
											{selected.enabled ? t("noResourcesFound") : t("statusDisabled")}
										</p>
									) : null}
								</div>
							</div>
							{selected.diagnostics.length ? (
								<div className="grid gap-1.5">
									{selected.diagnostics.map((diagnostic, index) => (
										<p
											className={`m-0 rounded-[var(--radius-2xs)] bg-[var(--overlay-5)] px-2 py-1.5 text-[length:var(--text-xs)] text-[color:var(--text-dim)] ${diagnostic.type === "error" ? "text-[color:var(--danger)]" : diagnostic.type === "warning" ? "text-[color:var(--warning)]" : ""}`}
											key={`${diagnostic.message}-${index}`}
										>
											{diagnostic.message}
											{diagnostic.path ? <code>{diagnostic.path}</code> : null}
										</p>
									))}
								</div>
							) : null}
							{success ? (
								<p className="m-0 text-[length:var(--text-sm)] whitespace-pre-wrap text-[color:var(--success)]">
									{success}
								</p>
							) : null}
							{error ? (
								<p className="m-0 text-[length:var(--text-sm)] whitespace-pre-wrap text-[color:var(--danger)]">
									{error}
								</p>
							) : null}
						</div>
					) : (
						<div className="px-3 py-7 text-center text-[length:var(--text-sm)] text-[color:var(--muted)]">
							{t("selectPluginHint")}
						</div>
					)}
				</section>
			</div>
			<footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--accent)_4%,var(--surface-1))] px-4 py-2.5">
				<div className="mr-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[length:var(--text-xs)] text-[color:var(--muted)]">
					{error ? (
						<span className="text-[color:var(--danger)]">{error}</span>
					) : success ? (
						<span className="text-[color:var(--success)]">{success}</span>
					) : diagnosticCount ? (
						<span
							className={`text-[length:var(--text-xs)] ${diagnosticSummary.hasError ? "text-[color:var(--error-text)]" : "text-[color:var(--warning)]"}`}
							title={diagnosticSummary.title}
						>
							{t("diagnosticCount", { count: diagnosticCount })}
						</span>
					) : (
						<span>{`${resourceTotals.extensions} ext · ${resourceTotals.skills} skills · ${resourceTotals.prompts} prompts · ${resourceTotals.themes} themes`}</span>
					)}
				</div>
				<Button variant="outline" type="button" disabled={loading || busy} onClick={() => void load()}>
					{t("refresh")}
				</Button>
				<Button variant="outline" type="button" onClick={onClose}>
					{t("close")}
				</Button>
			</footer>
		</Modal>
	);
});
