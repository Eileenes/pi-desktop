import type { CSSProperties, ReactElement } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	DesktopApiKeyProvider,
	DesktopAuthenticationPrompt,
	DesktopProviderConfig,
	DesktopProviderModelConfig,
} from "../shared/contracts.ts";
import {
	discoverModels,
	getModelScope,
	getModelsConfig,
	logoutProvider,
	lookupModelCatalog,
	openExternalUrl,
	saveModelScope,
	saveModelsConfig,
	testModel,
} from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";
import { Modal } from "./modal.tsx";
import { ProviderIconMark } from "./provider-icons.tsx";

interface ModelsConfigModalProps {
	providers: DesktopApiKeyProvider[];
	selectedProviderId: string;
	providerSetupInProgress: boolean;
	settingUpProvider: boolean;
	authenticationPrompt?: DesktopAuthenticationPrompt;
	authenticationNotice?: string;
	authenticationUrl?: string;
	authenticationUserCode?: string;
	authenticationExpiresAt?: number;
	authenticationResponse: string;
	authenticationResolving: boolean;
	onChangeProvider: (providerId: string) => void;
	onStartProviderSetup: (providerId: string, authType: "api_key" | "oauth") => void;
	onChangeAuthenticationResponse: (response: string) => void;
	onSubmitAuthentication: (id: string, response: string) => Promise<void>;
	onCancelProviderSetup: () => void;
	onClose: () => void;
}

type Selection =
	| { type: "managed"; providerId: string }
	| { type: "provider"; providerId: string }
	| { type: "model"; providerId: string; modelIndex: number }
	| { type: "scope" };

type DiscoveryState =
	| { phase: "idle" }
	| { phase: "loading" }
	| { phase: "success"; models: string[] }
	| { phase: "error"; message: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_COLORS: Record<(typeof THINKING_LEVELS)[number], string> = {
	off: "var(--text-dim)",
	minimal: "#6b7280",
	low: "var(--accent)",
	medium: "#a78bfa",
	high: "#f472b6",
	xhigh: "#fb923c",
	max: "var(--danger)",
};

const PROVIDER_MARKS: Record<string, { label: string; color: string }> = {
	anthropic: { label: "A", color: "#d97757" },
	openai: { label: "O", color: "#10a37f" },
	"openai-codex": { label: "O", color: "#10a37f" },
	google: { label: "G", color: "#4285f4" },
	"google-vertex": { label: "G", color: "#4285f4" },
	deepseek: { label: "D", color: "#4b7bec" },
	groq: { label: "G", color: "#f55036" },
	mistral: { label: "M", color: "#f59e0b" },
	moonshotai: { label: "K", color: "#7c3aed" },
	minimax: { label: "M", color: "#ef4444" },
	openrouter: { label: "R", color: "#8b5cf6" },
	xai: { label: "X", color: "#111827" },
	qwen: { label: "Q", color: "#2563eb" },
	zhipu: { label: "Z", color: "#2563eb" },
	cohere: { label: "C", color: "#d946ef" },
	perplexity: { label: "P", color: "#20b8cd" },
	together: { label: "T", color: "#f97316" },
	grok: { label: "G", color: "#111827" },
};

function ProviderMark({ providerId, name }: { providerId: string; name: string }): ReactElement {
	const icon = ProviderIconMark({ providerId });
	if (icon) return icon;
	const mark = PROVIDER_MARKS[providerId.toLocaleLowerCase()] ?? {
		label: name.trim().slice(0, 1).toUpperCase() || "?",
		color: "var(--text)",
	};
	return (
		<span className="models-provider-mark" style={{ "--provider-color": mark.color } as CSSProperties}>
			{mark.label}
		</span>
	);
}

function hasDeepSeekThinkingCompat(model: DesktopProviderModelConfig): boolean {
	return model.compat?.thinkingFormat === "deepseek";
}

const DEEPSEEK_COMPAT = {
	thinkingFormat: "deepseek",
	requiresReasoningContentOnAssistantMessages: true,
} as const;

function setDeepSeekThinkingCompat(model: DesktopProviderModelConfig, enabled: boolean): DesktopProviderModelConfig {
	const compat = { ...(model.compat ?? {}) };
	if (enabled) Object.assign(compat, DEEPSEEK_COMPAT);
	else {
		delete compat.thinkingFormat;
		delete compat.requiresReasoningContentOnAssistantMessages;
	}
	return { ...model, compat: Object.keys(compat).length ? compat : undefined };
}

function ThinkingLevelMapEditor({
	value,
	onChange,
}: {
	value?: Record<string, string | null>;
	onChange: (value: Record<string, string | null> | undefined) => void;
}) {
	const { t } = useI18n();
	function setLevel(level: string, entry: string | null | "omit"): void {
		const next = { ...(value ?? {}) };
		if (entry === "omit") delete next[level];
		else next[level] = entry;
		onChange(Object.keys(next).length ? next : undefined);
	}

	return (
		<div className="models-thinking-map">
			{THINKING_LEVELS.map((level) => {
				const hasValue = value !== undefined && Object.hasOwn(value, level);
				const raw = value?.[level];
				const state = !hasValue ? "omit" : raw === null ? "null" : "string";
				const customValue = typeof raw === "string" ? raw : "";
				return (
					<label key={level}>
						<span className={`models-thinking-level-name is-${state}`}>
							<span
								className="models-thinking-level-dot"
								style={{ "--thinking-color": THINKING_LEVEL_COLORS[level] } as CSSProperties}
							/>
							{level}
						</span>
						<span className="models-thinking-level-presets">
							<button
								type="button"
								className={state === "omit" ? "is-active" : ""}
								onClick={() => setLevel(level, "omit")}
							>
								{t("defaultBtn")}
							</button>
							<button
								type="button"
								className={state === "null" ? "is-disabled" : ""}
								onClick={() => setLevel(level, null)}
							>
								{t("disabledBtn")}
							</button>
						</span>
						<span className={`models-thinking-custom ${state === "string" ? "is-active" : ""}`}>
							<button type="button" onClick={() => setLevel(level, customValue || level)}>
								{t("customBtn")}
							</button>
							<input
								value={customValue}
								placeholder={level}
								maxLength={10}
								onFocus={() => {
									if (state !== "string") setLevel(level, customValue || level);
								}}
								onChange={(event) => setLevel(level, event.target.value)}
							/>
						</span>
					</label>
				);
			})}
		</div>
	);
}

const AuthenticationDeviceCode = memo(function AuthenticationDeviceCode({
	code,
	expiresAt,
}: {
	code: string;
	expiresAt?: number;
}) {
	const { t } = useI18n();
	const [now, setNow] = useState(() => Date.now());
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!expiresAt) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [expiresAt]);
	const remainingSeconds = expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1000));
	const copyCode = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1_500);
		} catch {
			setCopied(false);
		}
	};
	return (
		<div className="models-auth-device-code">
			<div>
				<span>{t("deviceCode")}</span>
				<strong>{code}</strong>
			</div>
			<button type="button" className="models-auth-copy" onClick={() => void copyCode()}>
				{copied ? t("copied") : t("copy")}
			</button>
			{remainingSeconds !== undefined ? (
				<small className={remainingSeconds === 0 ? "is-expired" : ""}>
					{remainingSeconds === 0
						? t("codeExpired")
						: t("codeValidity", { minutes: Math.ceil(remainingSeconds / 60) })}
				</small>
			) : null}
		</div>
	);
});

function emptyCost(): NonNullable<DesktopProviderModelConfig["cost"]> {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export const ModelsConfigModal = memo(function ModelsConfigModal({
	providers,
	selectedProviderId,
	providerSetupInProgress,
	settingUpProvider,
	authenticationPrompt,
	authenticationNotice,
	authenticationUrl,
	authenticationUserCode,
	authenticationExpiresAt,
	authenticationResponse,
	authenticationResolving,
	onChangeProvider,
	onStartProviderSetup,
	onChangeAuthenticationResponse,
	onSubmitAuthentication,
	onCancelProviderSetup,
	onClose,
}: ModelsConfigModalProps) {
	const { t } = useI18n();
	const [config, setConfig] = useState<DesktopProviderConfig[]>([]);
	const [savedConfig, setSavedConfig] = useState<DesktopProviderConfig[]>([]);
	const [selection, setSelection] = useState<Selection>();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string>();
	const [discovery, setDiscovery] = useState<DiscoveryState>({ phase: "idle" });
	const [discoveryQuery, setDiscoveryQuery] = useState("");
	const [selectedDiscovered, setSelectedDiscovered] = useState<string[]>([]);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const [providerPickerOpen, setProviderPickerOpen] = useState(false);
	const [confirmDisconnectProviderId, setConfirmDisconnectProviderId] = useState<string>();
	const [providerPickerQuery, setProviderPickerQuery] = useState("");
	const providerPickerInputRef = useRef<HTMLInputElement>(null);
	const [authProvider, setAuthProvider] = useState<DesktopApiKeyProvider>();
	const [modelTest, setModelTest] = useState<{ phase: "idle" | "loading" | "success" | "error"; message?: string }>({
		phase: "idle",
	});
	const [catalogFill, setCatalogFill] = useState<{
		state: "idle" | "loading" | "success" | "error";
		message?: string;
	}>({
		state: "idle",
	});
	const [catalogUndo, setCatalogUndo] = useState<DesktopProviderModelConfig>();
	const [showProviderApiKey, setShowProviderApiKey] = useState(false);
	const [modelScopeText, setModelScopeText] = useState("");
	const [savedModelScopeText, setSavedModelScopeText] = useState("");
	const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
	const [modelScopeSaving, setModelScopeSaving] = useState(false);
	const [modelScopeError, setModelScopeError] = useState<string>();
	const hasChanges = JSON.stringify(config) !== JSON.stringify(savedConfig);
	const hasModelScopeChanges = modelScopeText !== savedModelScopeText;
	const requestClose = useCallback(() => {
		if (hasChanges || hasModelScopeChanges) setConfirmDiscard(true);
		else onClose();
	}, [hasChanges, hasModelScopeChanges, onClose]);

	useEffect(() => {
		let cancelled = false;
		void getModelsConfig()
			.then((next) => {
				if (cancelled) return;
				setConfig(next);
				setSavedConfig(next);
				if (next[0]) setSelection({ type: "provider", providerId: next[0].id });
			})
			.catch((error) => {
				if (!cancelled) setSaveError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void getModelScope()
			.then((scope) => {
				if (cancelled) return;
				const text = scope.patterns.join("\n");
				setModelScopeText(text);
				setSavedModelScopeText(text);
				setModelScopeWarnings(scope.warnings);
			})
			.catch((error) => {
				if (!cancelled) setModelScopeError(error instanceof Error ? error.message : String(error));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const selectionIdentity = selection
		? selection.type === "model"
			? `model:${selection.providerId}:${selection.modelIndex}`
			: selection.type === "scope"
				? "scope"
				: `${selection.type}:${selection.providerId}`
		: "none";

	// Reset transient catalog state whenever the selected provider/model changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selection identity intentionally coalesces the union.
	useEffect(() => {
		setCatalogUndo(undefined);
		setCatalogFill({ state: "idle" });
		setShowProviderApiKey(false);
	}, [selectionIdentity]);

	useEffect(() => {
		if (providerPickerOpen) window.requestAnimationFrame(() => providerPickerInputRef.current?.focus());
	}, [providerPickerOpen]);

	const managedProvider =
		selection?.type === "managed"
			? providers.find((provider) => provider.id === selection.providerId && provider.configured)
			: undefined;
	const selectedProvider =
		selection && selection.type !== "managed" && selection.type !== "scope"
			? config.find((provider) => provider.id === selection.providerId)
			: undefined;
	const selectedModel = selection?.type === "model" ? selectedProvider?.models?.[selection.modelIndex] : undefined;

	const resetDiscovery = useCallback(() => {
		setDiscovery({ phase: "idle" });
		setDiscoveryQuery("");
		setSelectedDiscovered([]);
	}, []);

	function updateProvider(
		providerId: string,
		update: (provider: DesktopProviderConfig) => DesktopProviderConfig,
	): void {
		setConfig((current) => current.map((provider) => (provider.id === providerId ? update(provider) : provider)));
	}

	function addProvider(): void {
		let id = "new-provider";
		let suffix = 2;
		while (config.some((provider) => provider.id === id)) id = `new-provider-${suffix++}`;
		setConfig((current) => [...current, { id, api: "openai-completions", models: [] }]);
		setSelection({ type: "provider", providerId: id });
		resetDiscovery();
	}

	function renameProvider(nextId: string): void {
		if (!selectedProvider || !nextId.trim() || config.some((provider) => provider.id === nextId.trim())) return;
		const id = nextId.trim();
		setConfig((current) =>
			current.map((provider) => (provider.id === selectedProvider.id ? { ...provider, id } : provider)),
		);
		setSelection({ type: "provider", providerId: id });
	}

	function removeProvider(): void {
		if (!selectedProvider || !window.confirm(t("removeProviderConfirm", { id: selectedProvider.id }))) return;
		const remaining = config.filter((provider) => provider.id !== selectedProvider.id);
		setConfig(remaining);
		setSelection(remaining[0] ? { type: "provider", providerId: remaining[0].id } : undefined);
	}

	function addModel(): void {
		if (!selectedProvider) return;
		const nextIndex = selectedProvider.models?.length ?? 0;
		updateProvider(selectedProvider.id, (provider) => ({
			...provider,
			models: [...(provider.models ?? []), { id: "new-model", cost: emptyCost() }],
		}));
		setSelection({ type: "model", providerId: selectedProvider.id, modelIndex: nextIndex });
	}

	function updateModel(update: (model: DesktopProviderModelConfig) => DesktopProviderModelConfig): void {
		if (!selectedProvider || !selectedModel || selection?.type !== "model") return;
		updateProvider(selectedProvider.id, (provider) => ({
			...provider,
			models: provider.models?.map((model, index) => (index === selection.modelIndex ? update(model) : model)),
		}));
	}

	function removeModel(): void {
		if (!selectedProvider || !selectedModel || selection?.type !== "model") return;
		if (!window.confirm(t("removeModelConfirm", { id: selectedModel.name ?? selectedModel.id }))) return;
		updateProvider(selectedProvider.id, (provider) => ({
			...provider,
			models: provider.models?.filter((_, index) => index !== selection.modelIndex),
		}));
		setSelection({ type: "provider", providerId: selectedProvider.id });
	}

	async function handleDiscover(): Promise<void> {
		if (!selectedProvider?.baseUrl?.trim()) return;
		setDiscovery({ phase: "loading" });
		setSelectedDiscovered([]);
		try {
			const found = await discoverModels(
				selectedProvider.id,
				selectedProvider.baseUrl.trim(),
				selectedProvider.apiKey,
			);
			setDiscovery({ phase: "success", models: found.map((model) => model.id) });
		} catch (error) {
			setDiscovery({ phase: "error", message: error instanceof Error ? error.message : String(error) });
		}
	}

	const shownDiscovered = useMemo(() => {
		if (discovery.phase !== "success") return [];
		const query = discoveryQuery.trim().toLocaleLowerCase();
		return discovery.models.filter((id) => !query || id.toLocaleLowerCase().includes(query)).slice(0, 300);
	}, [discovery, discoveryQuery]);
	const selectableShownDiscovered = useMemo(
		() => shownDiscovered.filter((id) => !(selectedProvider?.models?.some((model) => model.id === id) ?? false)),
		[shownDiscovered, selectedProvider?.models],
	);
	const allShownDiscoveredSelected =
		selectableShownDiscovered.length > 0 && selectableShownDiscovered.every((id) => selectedDiscovered.includes(id));

	function toggleShownDiscovered(): void {
		const shown = new Set(selectableShownDiscovered);
		setSelectedDiscovered((current) =>
			allShownDiscoveredSelected
				? current.filter((id) => !shown.has(id))
				: [...new Set([...current, ...selectableShownDiscovered])],
		);
	}

	function addDiscoveredModels(): void {
		if (!selectedProvider || selectedDiscovered.length === 0) return;
		const existing = new Set(selectedProvider.models?.map((model) => model.id));
		updateProvider(selectedProvider.id, (provider) => ({
			...provider,
			models: [
				...(provider.models ?? []),
				...selectedDiscovered.filter((id) => !existing.has(id)).map((id) => ({ id, cost: emptyCost() })),
			],
		}));
		setSelectedDiscovered([]);
	}

	function requestProviderSetup(provider: DesktopApiKeyProvider): void {
		if (provider.supportsApiKey && provider.supportsOAuth) {
			setAuthProvider(provider);
			return;
		}
		onStartProviderSetup(provider.id, provider.supportsOAuth ? "oauth" : "api_key");
	}

	async function handleModelTest(): Promise<void> {
		if (!selectedProvider || !selectedModel) return;
		setModelTest({ phase: "loading" });
		try {
			const result = await testModel(selectedProvider, selectedModel);
			setModelTest(
				result.ok
					? {
							phase: "success",
							message: `${t("connected")} · ${result.latencyMs ?? 0}ms${result.responseText ? ` · ${result.responseText}` : ""}`,
						}
					: { phase: "error", message: result.error ?? t("connectionFailed") },
			);
		} catch (error) {
			setModelTest({ phase: "error", message: error instanceof Error ? error.message : String(error) });
		}
	}

	async function handleCatalogFill(): Promise<void> {
		if (!selectedProvider || !selectedModel) return;
		setCatalogFill({ state: "loading" });
		setCatalogUndo(undefined);
		try {
			const entry = await lookupModelCatalog(selectedProvider.id, selectedModel.id);
			if (!entry) {
				setCatalogFill({ state: "error", message: t("catalogNotFound") });
				return;
			}
			setCatalogUndo(selectedModel);
			updateModel((model) => ({
				...model,
				name: model.name ?? entry.name,
				reasoning: model.reasoning ?? entry.reasoning,
				thinkingLevelMap: model.thinkingLevelMap ?? entry.thinkingLevelMap,
				compat: model.compat ?? entry.compat,
				input: model.input ?? entry.input,
				contextWindow: model.contextWindow ?? entry.contextWindow,
				maxTokens: model.maxTokens ?? entry.maxTokens,
				cost:
					model.cost ??
					(entry.cost
						? { ...entry.cost, cacheRead: entry.cost.cacheRead ?? 0, cacheWrite: entry.cost.cacheWrite ?? 0 }
						: undefined),
			}));
			setCatalogFill({ state: "success" });
		} catch (error) {
			setCatalogFill({ state: "error", message: error instanceof Error ? error.message : String(error) });
		}
	}

	function undoCatalogFill(): void {
		if (!catalogUndo) return;
		updateModel(() => catalogUndo);
		setCatalogUndo(undefined);
		setCatalogFill({ state: "idle" });
	}

	async function handleSave(): Promise<void> {
		setSaving(true);
		setSaveError(undefined);
		try {
			await saveModelsConfig(config);
			setSavedConfig(config);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveModelScope(): Promise<void> {
		setModelScopeSaving(true);
		setModelScopeError(undefined);
		try {
			const patterns = [
				...new Set(
					modelScopeText
						.split("\n")
						.map((pattern) => pattern.trim())
						.filter(Boolean),
				),
			];
			const scope = await saveModelScope(patterns);
			const text = scope.patterns.join("\n");
			setModelScopeText(text);
			setSavedModelScopeText(text);
			setModelScopeWarnings(scope.warnings);
		} catch (error) {
			setModelScopeError(error instanceof Error ? error.message : String(error));
		} finally {
			setModelScopeSaving(false);
		}
	}

	return (
		<Modal
			title={t("models")}
			subtitle="~/.pi/agent/models.json"
			className="models-modal"
			onClose={providerSetupInProgress || settingUpProvider ? () => undefined : requestClose}
		>
			<div className="models-layout">
				<aside className="models-tree">
					<div className="models-tree-scroll">
						<button
							className={`models-tree-item scope ${selection?.type === "scope" ? "is-active" : ""}`}
							type="button"
							onClick={() => setSelection({ type: "scope" })}
						>
							<span>{t("modelScopeTitle")}</span>
							<small>enabledModels</small>
						</button>
						<div className="models-tree-divider" />
						{providers.map((provider) => (
							<button
								key={provider.id}
								className={`models-tree-item provider ${selectedProviderId === provider.id ? "is-connected" : ""}`}
								type="button"
								onClick={() => {
									onChangeProvider(provider.id);
									setSelection({ type: "managed", providerId: provider.id });
									if (!provider.configured) requestProviderSetup(provider);
								}}
							>
								<ProviderMark providerId={provider.id} name={provider.name} />
								<span>{provider.name}</span>
								{provider.configured ? (
									<span className="models-connected-dot" title={t("connectedDot")} />
								) : null}
							</button>
						))}
						{providers.length && config.length ? <div className="models-tree-divider" /> : null}
						{config.map((provider) => (
							<div key={provider.id} className="models-tree-group">
								<button
									className={`models-tree-item provider ${selection?.type === "provider" && selection.providerId === provider.id ? "is-active" : ""}`}
									type="button"
									onClick={() => {
										setSelection({ type: "provider", providerId: provider.id });
										resetDiscovery();
									}}
								>
									<ProviderMark providerId={provider.id} name={provider.name ?? provider.id} />
									<span>{provider.name ?? provider.id}</span>
								</button>
								{provider.models?.map((model, index) => (
									<button
										key={`${model.id}-${index}`}
										className={`models-tree-item model ${selection?.type === "model" && selection.providerId === provider.id && selection.modelIndex === index ? "is-active" : ""}`}
										type="button"
										onClick={() =>
											setSelection({ type: "model", providerId: provider.id, modelIndex: index })
										}
									>
										<span>{model.name ?? model.id}</span>
										{model.reasoning ? <span className="models-reasoning-badge">T</span> : null}
									</button>
								))}
							</div>
						))}
						{!loading && config.length === 0 ? <p className="modal-empty">{t("noCustomProviders")}</p> : null}
					</div>
					<button
						className="outline-button models-add-provider"
						type="button"
						onClick={() => {
							setProviderPickerQuery("");
							setProviderPickerOpen(true);
						}}
					>
						{t("addProvider")}
					</button>
				</aside>

				<section className="models-detail">
					{selection?.type === "scope" ? (
						<div className="models-detail-form models-scope-form">
							<div className="models-detail-heading">
								<span>{t("modelScopeTitle")}</span>
								<span className="models-auth-badge">{t("globalSetting")}</span>
							</div>
							<p className="models-managed-description">
								{t("scopeDescription1")} <code>:thinking</code> {t("scopeDescription2")}
								<code>anthropic/*:high</code>
								{t("scopeDescription3")}
							</p>
							<textarea
								value={modelScopeText}
								placeholder={"anthropic/*:high\nopenai/gpt-5*"}
								spellCheck={false}
								onChange={(event) => setModelScopeText(event.target.value)}
							/>
							{modelScopeWarnings.length ? (
								<output className="models-scope-warnings">
									{modelScopeWarnings.map((warning) => (
										<p key={warning}>{warning}</p>
									))}
								</output>
							) : null}
							{modelScopeError ? <p className="sidebar-error">{modelScopeError}</p> : null}
							<button
								className="accent-button"
								type="button"
								disabled={
									!hasModelScopeChanges || modelScopeSaving || providerSetupInProgress || settingUpProvider
								}
								onClick={() => void handleSaveModelScope()}
							>
								{modelScopeSaving ? t("saving") : t("saveModelScope")}
							</button>
						</div>
					) : managedProvider ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>{managedProvider.name}</span>
								<span className="models-auth-badge">
									{managedProvider.credentialType === "oauth" ? "OAuth" : "API Key"}
								</span>
							</div>
							<p className="models-managed-description">{t("connectedProviderDescription")}</p>
							<div className="models-managed-actions">
								{managedProvider.supportsApiKey && managedProvider.supportsOAuth ? (
									<button
										className="outline-button"
										type="button"
										onClick={() => setAuthProvider(managedProvider)}
									>
										{t("switchAuthMethod")}
									</button>
								) : null}
								<button
									className="outline-button"
									type="button"
									disabled={providerSetupInProgress || settingUpProvider}
									onClick={() =>
										onStartProviderSetup(
											managedProvider.id,
											managedProvider.credentialType === "oauth" ? "oauth" : "api_key",
										)
									}
								>
									{managedProvider.credentialType === "oauth" ? t("relogin") : t("updateApiKey")}
								</button>
								{confirmDisconnectProviderId === managedProvider.id ? (
									<>
										<button
											className="danger-button"
											type="button"
											onClick={() => {
												setSaveError(undefined);
												void logoutProvider(managedProvider.id)
													.catch((error: unknown) =>
														setSaveError(error instanceof Error ? error.message : String(error)),
													)
													.finally(() => setConfirmDisconnectProviderId(undefined));
											}}
										>
											{t("confirmDisconnect")}
										</button>
										<button
											type="button"
											className="outline-button"
											onClick={() => setConfirmDisconnectProviderId(undefined)}
										>
											{t("cancel")}
										</button>
									</>
								) : (
									<button
										className="danger-button"
										type="button"
										onClick={() => setConfirmDisconnectProviderId(managedProvider.id)}
									>
										{t("disconnect")}
									</button>
								)}
							</div>
						</div>
					) : selectedProvider && selection?.type === "provider" ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>{t("provider")}</span>
								<button className="danger-text-button" type="button" onClick={removeProvider}>
									{t("delete")}
								</button>
							</div>
							<label>
								{t("providerName")}
								<input
									defaultValue={selectedProvider.id}
									key={selectedProvider.id}
									onBlur={(event) => renameProvider(event.target.value)}
								/>
							</label>
							<label>
								{t("displayName")}
								<input
									value={selectedProvider.name ?? ""}
									placeholder={selectedProvider.id}
									onChange={(event) =>
										updateProvider(selectedProvider.id, (provider) => ({
											...provider,
											name: event.target.value || undefined,
										}))
									}
								/>
							</label>
							<label>
								Base URL
								<input
									className="mono"
									value={selectedProvider.baseUrl ?? ""}
									placeholder="https://api.example.com/v1"
									onChange={(event) => {
										updateProvider(selectedProvider.id, (provider) => ({
											...provider,
											baseUrl: event.target.value || undefined,
										}));
										resetDiscovery();
									}}
								/>
							</label>
							<label>
								API Key
								<div className="models-secret-input">
									<input
										className="mono"
										type={showProviderApiKey ? "text" : "password"}
										value={selectedProvider.apiKey ?? ""}
										placeholder={t("apiKeyPlaceholder")}
										autoComplete="new-password"
										onChange={(event) => {
											updateProvider(selectedProvider.id, (provider) => ({
												...provider,
												apiKey: event.target.value || undefined,
											}));
											resetDiscovery();
										}}
									/>
									<button
										className="models-secret-toggle"
										type="button"
										aria-label={showProviderApiKey ? t("hideApiKey") : t("showApiKey")}
										title={showProviderApiKey ? t("hideApiKey") : t("showApiKey")}
										onClick={() => setShowProviderApiKey((visible) => !visible)}
									>
										{showProviderApiKey ? t("hide") : t("show")}
									</button>
								</div>
								<small>{t("apiKeyHint")}</small>
							</label>
							<label>
								API
								<select
									value={selectedProvider.api ?? "openai-completions"}
									onChange={(event) =>
										updateProvider(selectedProvider.id, (provider) => ({
											...provider,
											api: event.target.value,
										}))
									}
								>
									{API_OPTIONS.map((option) => (
										<option key={option}>{option}</option>
									))}
								</select>
							</label>
							<div className="models-discovery">
								{discovery.phase !== "success" ? (
									<button
										className="outline-button"
										type="button"
										disabled={!selectedProvider.baseUrl?.trim() || discovery.phase === "loading"}
										onClick={() => void handleDiscover()}
									>
										{discovery.phase === "loading" ? t("fetchingModels") : t("fetchModelsFromProvider")}
									</button>
								) : null}
								{discovery.phase === "error" ? <p className="sidebar-error">{discovery.message}</p> : null}
								{discovery.phase === "success" ? (
									<>
										<input
											value={discoveryQuery}
											placeholder={t("filterModelsCount", { count: discovery.models.length })}
											onChange={(event) => setDiscoveryQuery(event.target.value)}
										/>
										<div className="discovery-results">
											<label className="discovery-select-all">
												<input
													type="checkbox"
													checked={allShownDiscoveredSelected}
													disabled={selectableShownDiscovered.length === 0}
													onChange={toggleShownDiscovered}
												/>
												{t("selectAllShown")}
											</label>
											{shownDiscovered.map((id) => {
												const added = selectedProvider.models?.some((model) => model.id === id) ?? false;
												return (
													<label key={id}>
														<input
															type="checkbox"
															disabled={added}
															checked={added || selectedDiscovered.includes(id)}
															onChange={() =>
																setSelectedDiscovered((current) =>
																	current.includes(id)
																		? current.filter((item) => item !== id)
																		: [...current, id],
																)
															}
														/>
														<code>{id}</code>
														{added ? <span>{t("added")}</span> : null}
													</label>
												);
											})}
										</div>
										<div className="discovery-footer">
											<span>{t("fetchedModelsCount", { count: discovery.models.length })}</span>
											<button
												className="accent-button"
												type="button"
												disabled={selectedDiscovered.length === 0}
												onClick={addDiscoveredModels}
											>
												{selectedDiscovered.length
													? t("addSelectedCount", { count: selectedDiscovered.length })
													: t("addSelected")}
											</button>
										</div>
									</>
								) : null}
							</div>
							<button className="outline-button" type="button" onClick={addModel}>
								{t("addModelManually")}
							</button>
						</div>
					) : selectedProvider && selectedModel ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>{t("models")}</span>
								<div className="models-heading-actions">
									<button
										className="outline-button"
										type="button"
										disabled={modelTest.phase === "loading" || !selectedModel.id.trim()}
										onClick={() => void handleModelTest()}
									>
										{modelTest.phase === "loading" ? t("testing") : t("testConnection")}
									</button>
									<button className="danger-text-button" type="button" onClick={removeModel}>
										{t("remove")}
									</button>
								</div>
							</div>
							{modelTest.phase !== "idle" && modelTest.phase !== "loading" ? (
								<p className={`model-test-result is-${modelTest.phase}`}>{modelTest.message}</p>
							) : null}
							<div className="models-form-grid">
								<label>
									{t("idLabel")}
									<input
										className="mono"
										value={selectedModel.id}
										onChange={(event) => updateModel((model) => ({ ...model, id: event.target.value }))}
									/>
								</label>
								<label>
									{t("nameLabel")}
									<input
										value={selectedModel.name ?? ""}
										placeholder={t("displayNamePlaceholder")}
										onChange={(event) =>
											updateModel((model) => ({ ...model, name: event.target.value || undefined }))
										}
									/>
								</label>
							</div>
							<label>
								{t("apiOverride")}
								<select
									value={selectedModel.api ?? ""}
									onChange={(event) =>
										updateModel((model) => ({ ...model, api: event.target.value || undefined }))
									}
								>
									<option value="">{t("default")}</option>
									{API_OPTIONS.map((option) => (
										<option key={option}>{option}</option>
									))}
								</select>
							</label>
							<div className="models-checks">
								<label>
									<input
										type="checkbox"
										checked={selectedModel.reasoning ?? false}
										onChange={(event) =>
											updateModel((model) => ({ ...model, reasoning: event.target.checked || undefined }))
										}
									/>
									{t("reasoningLabel")}
								</label>
								<label>
									<input
										type="checkbox"
										checked={selectedModel.input?.includes("image") ?? false}
										onChange={(event) =>
											updateModel((model) => ({
												...model,
												input: event.target.checked ? ["text", "image"] : undefined,
											}))
										}
									/>
									{t("imageInputLabel")}
								</label>
								{selectedModel.reasoning ? (
									<label>
										<input
											type="checkbox"
											checked={hasDeepSeekThinkingCompat(selectedModel)}
											onChange={(event) =>
												updateModel((model) => setDeepSeekThinkingCompat(model, event.target.checked))
											}
										/>
										{t("deepseekCompatLabel")}
									</label>
								) : null}
								<button
									className="skill-version-button"
									type="button"
									disabled={catalogFill.state === "loading"}
									onClick={() => void handleCatalogFill()}
								>
									{catalogFill.state === "loading" ? t("querying") : t("fillFromCatalog")}
								</button>
								<a
									className="models-catalog-source"
									href="https://github.com/anomalyco/models.dev"
									onClick={(event) => {
										event.preventDefault();
										void window.piDesktop.openExternalUrl("https://github.com/anomalyco/models.dev");
									}}
								>
									{t("catalogSource")}
								</a>
								{catalogUndo ? (
									<button className="skill-version-button" type="button" onClick={undoCatalogFill}>
										{t("undoFill")}
									</button>
								) : null}
							</div>
							{catalogFill.state === "success" ? (
								<p className="model-test-result is-success">{t("catalogFilled")}</p>
							) : catalogFill.state === "error" ? (
								<p className="model-test-result is-error">{catalogFill.message}</p>
							) : null}
							{selectedModel.reasoning ? (
								<div className="models-thinking-map-section">
									<div className="models-field-title models-thinking-map-heading">
										<span>Thinking level map</span>
										{selectedModel.thinkingLevelMap ? (
											<button
												className="skill-version-button"
												type="button"
												onClick={() => updateModel((model) => ({ ...model, thinkingLevelMap: undefined }))}
											>
												{t("clear")}
											</button>
										) : null}
									</div>
									<ThinkingLevelMapEditor
										value={selectedModel.thinkingLevelMap}
										onChange={(value) => updateModel((model) => ({ ...model, thinkingLevelMap: value }))}
									/>
								</div>
							) : null}
							<div className="models-form-grid">
								<label>
									{t("contextWindowLabel")}
									<input
										type="number"
										value={selectedModel.contextWindow ?? ""}
										placeholder="128000"
										onChange={(event) =>
											updateModel((model) => ({
												...model,
												contextWindow: event.target.value ? Number(event.target.value) : undefined,
											}))
										}
									/>
								</label>
								<label>
									{t("maxTokensLabel")}
									<input
										type="number"
										value={selectedModel.maxTokens ?? ""}
										placeholder="16384"
										onChange={(event) =>
											updateModel((model) => ({
												...model,
												maxTokens: event.target.value ? Number(event.target.value) : undefined,
											}))
										}
									/>
								</label>
							</div>
							<div>
								<p className="models-field-title">{t("costLabel")}</p>
								<div className="models-cost-grid">
									{COST_FIELDS.map((field) => (
										<label key={field}>
											{field}
											<input
												type="number"
												min="0"
												step="0.01"
												value={selectedModel.cost?.[field] ?? 0}
												onChange={(event) =>
													updateModel((model) => ({
														...model,
														cost: { ...(model.cost ?? emptyCost()), [field]: Number(event.target.value) },
													}))
												}
											/>
										</label>
									))}
								</div>
							</div>
						</div>
					) : (
						<div className="models-empty-detail">
							<strong>{t("setupProvidersTitle")}</strong>
							<p>{t("setupProvidersHint")}</p>
							<button className="accent-button" type="button" onClick={addProvider}>
								{t("addProvider")}
							</button>
						</div>
					)}
				</section>
			</div>
			{providerSetupInProgress || settingUpProvider ? (
				<div className="models-auth-overlay">
					<div
						className="models-auth-panel"
						role="dialog"
						aria-modal="true"
						aria-label={t("connectProviderTitle")}
					>
						<div className="models-auth-heading">
							<strong>{t("connectProviderTitle")}</strong>
							<span>{t("connectProviderHint")}</span>
						</div>
						{authenticationPrompt ? (
							<form
								className="models-auth-prompt"
								onSubmit={(event) => {
									event.preventDefault();
									void onSubmitAuthentication(authenticationPrompt.id, authenticationResponse);
								}}
							>
								{authenticationNotice ? <p>{authenticationNotice}</p> : null}
								{authenticationUserCode ? (
									<AuthenticationDeviceCode
										code={authenticationUserCode}
										expiresAt={authenticationExpiresAt}
									/>
								) : null}
								{authenticationUrl ? (
									<button
										className="models-auth-link"
										type="button"
										onClick={() => void openExternalUrl(authenticationUrl)}
									>
										{t("openAuthPage")}
									</button>
								) : null}
								<p>{authenticationPrompt.message}</p>
								{authenticationPrompt.type === "select" ? (
									<select
										disabled={authenticationResolving}
										value={authenticationResponse}
										onChange={(event) => onChangeAuthenticationResponse(event.target.value)}
									>
										{authenticationPrompt.options?.map((option) => (
											<option key={option.id} value={option.id}>
												{option.label}
											</option>
										))}
									</select>
								) : (
									<input
										disabled={authenticationResolving}
										placeholder={authenticationPrompt.placeholder}
										type={authenticationPrompt.type === "secret" ? "password" : "text"}
										value={authenticationResponse}
										onChange={(event) => onChangeAuthenticationResponse(event.target.value)}
									/>
								)}
								<button className="accent-button" type="submit" disabled={authenticationResolving}>
									{authenticationResolving ? t("processingDots") : t("continue")}
								</button>
							</form>
						) : (
							<div className="models-auth-waiting">
								{authenticationNotice ? <p>{authenticationNotice}</p> : <p>{t("waitingForProvider")}</p>}
								{authenticationUserCode ? (
									<AuthenticationDeviceCode
										code={authenticationUserCode}
										expiresAt={authenticationExpiresAt}
									/>
								) : null}
								{authenticationUrl ? (
									<button
										className="models-auth-link"
										type="button"
										onClick={() => void openExternalUrl(authenticationUrl)}
									>
										{t("openAuthPage")}
									</button>
								) : null}
							</div>
						)}
						<button className="outline-button" type="button" onClick={onCancelProviderSetup}>
							{t("cancelConnect")}
						</button>
					</div>
				</div>
			) : null}

			<footer className="models-footer">
				{saveError ? (
					<span className="sidebar-error">{saveError}</span>
				) : (
					<span>{hasChanges ? t("unsavedChanges") : t("configSaved")}</span>
				)}
				<button
					className="outline-button"
					type="button"
					disabled={providerSetupInProgress || settingUpProvider}
					onClick={requestClose}
				>
					{t("cancel")}
				</button>
				<button
					className="accent-button"
					type="button"
					disabled={!hasChanges || saving || providerSetupInProgress || settingUpProvider}
					onClick={() => void handleSave()}
				>
					{saving ? t("saving") : t("saveChanges")}
				</button>
			</footer>
			{providerPickerOpen ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭嵌套对话框
				<div
					className="models-nested-backdrop"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setProviderPickerOpen(false);
						}
					}}
					tabIndex={-1}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setProviderPickerOpen(false);
					}}
				>
					<div className="models-provider-picker" role="dialog" aria-modal="true" aria-label={t("addProvider")}>
						<div className="models-provider-picker-search">{t("addProvider")}</div>
						<input
							className="models-provider-picker-input"
							ref={providerPickerInputRef}
							value={providerPickerQuery}
							placeholder={t("filterProviders")}
							onChange={(event) => setProviderPickerQuery(event.target.value)}
						/>
						<div className="models-provider-picker-grid">
							<button
								type="button"
								onClick={() => {
									addProvider();
									setProviderPickerOpen(false);
								}}
							>
								<span>
									<strong>{t("customEndpointTitle")}</strong>
									<small>{t("customEndpointSubtitle")}</small>
								</span>
								<b>＋</b>
							</button>
							{providers
								.filter((provider) => {
									if (provider.configured) return false;
									const query = providerPickerQuery.trim().toLocaleLowerCase();
									return (
										!query ||
										provider.name.toLocaleLowerCase().includes(query) ||
										provider.id.toLocaleLowerCase().includes(query)
									);
								})
								.map((provider) => (
									<button
										key={provider.id}
										type="button"
										disabled={settingUpProvider || providerSetupInProgress}
										onClick={() => {
											onChangeProvider(provider.id);
											setProviderPickerOpen(false);
											setSelection({ type: "managed", providerId: provider.id });
											if (!provider.configured) requestProviderSetup(provider);
										}}
									>
										<span>
											<strong>{provider.name}</strong>
											<small>
												{provider.supportsApiKey && provider.supportsOAuth
													? "API Key / OAuth"
													: provider.supportsOAuth
														? (provider.oauthName ?? "OAuth")
														: "API Key"}
											</small>
										</span>
										<ProviderMark providerId={provider.id} name={provider.name} />
									</button>
								))}
						</div>
					</div>
				</div>
			) : null}
			{authProvider ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: nested dialog captures Escape
				<div
					className="models-nested-backdrop"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setAuthProvider(undefined);
						}
					}}
					tabIndex={-1}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setAuthProvider(undefined);
					}}
				>
					<div
						className="models-discard-dialog"
						role="dialog"
						aria-modal="true"
						aria-label={t("chooseAuthMethodAria")}
					>
						<strong>{t("connectAuthTitle", { name: authProvider.name })}</strong>
						<p>{t("chooseAuthMethod")}</p>
						<div>
							<button
								// biome-ignore lint/a11y/noAutofocus: 嵌套认证对话框打开后应立即聚焦可取消操作
								autoFocus
								className="outline-button"
								type="button"
								onClick={() => setAuthProvider(undefined)}
							>
								{t("cancel")}
							</button>
							<button
								className="outline-button"
								type="button"
								onClick={() => {
									const provider = authProvider;
									setAuthProvider(undefined);
									onStartProviderSetup(provider.id, "api_key");
								}}
							>
								API Key
							</button>
							<button
								className="accent-button"
								type="button"
								onClick={() => {
									const provider = authProvider;
									setAuthProvider(undefined);
									onStartProviderSetup(provider.id, "oauth");
								}}
							>
								{authProvider.oauthName ?? "OAuth"}
							</button>
						</div>
					</div>
				</div>
			) : null}
			{confirmDiscard ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭确认框
				<div
					className="models-nested-backdrop"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setConfirmDiscard(false);
						}
					}}
					tabIndex={-1}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setConfirmDiscard(false);
					}}
				>
					<div className="models-discard-dialog" role="alertdialog" aria-modal="true">
						<strong>{t("discardChangesTitle")}</strong>
						<p>{t("discardChangesHint")}</p>
						<div>
							<button
								// biome-ignore lint/a11y/noAutofocus: 确认弹窗打开后先聚焦安全的继续编辑操作
								autoFocus
								className="outline-button"
								type="button"
								onClick={() => setConfirmDiscard(false)}
							>
								{t("keepEditing")}
							</button>
							<button className="danger-button" type="button" onClick={onClose}>
								{t("discardChanges")}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</Modal>
	);
});
