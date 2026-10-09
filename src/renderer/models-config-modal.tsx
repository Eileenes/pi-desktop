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
import { ProviderIconMark } from "./provider-icons.tsx";
import { Button } from "./ui/button.tsx";
import { Field } from "./ui/field.tsx";
import { Modal } from "./ui/modal.tsx";
import { Segment, Segmented } from "./ui/segmented.tsx";

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
		<span
			className="grid size-5 shrink-0 place-items-center rounded-[var(--radius-2xs)] border border-[color-mix(in_srgb,var(--provider-color,var(--text))_30%,transparent)] bg-[color-mix(in_srgb,var(--provider-color,var(--surface-3))_12%,var(--surface-3))] text-[length:var(--text-2xs)] font-bold text-[var(--provider-color,var(--text))]"
			style={{ "--provider-color": mark.color } as CSSProperties}
		>
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
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{THINKING_LEVELS.map((level) => {
				const hasValue = value !== undefined && Object.hasOwn(value, level);
				const raw = value?.[level];
				const state = !hasValue ? "omit" : raw === null ? "null" : "string";
				const customValue = typeof raw === "string" ? raw : "";
				return (
					<label className="grid gap-1 text-[length:var(--text-sm)] font-medium" key={level}>
						<span
							className={`inline-flex items-center gap-1.5 ${state === "null" ? "text-[color:var(--text-dim)] line-through" : "text-[color:var(--muted)]"}`}
						>
							<span
								className={`size-1.5 shrink-0 rounded-full ${state === "null" ? "opacity-30" : ""}`}
								style={{ background: THINKING_LEVEL_COLORS[level] }}
							/>
							{level}
						</span>
						<Segmented>
							<Segment active={state === "omit"} onClick={() => setLevel(level, "omit")}>
								{t("defaultBtn")}
							</Segment>
							<Segment active={state === "null"} onClick={() => setLevel(level, null)}>
								{t("disabledBtn")}
							</Segment>
						</Segmented>
						<span
							className={`flex min-w-0 overflow-hidden rounded-[var(--radius-s)] border ${state === "string" ? "border-[var(--accent-strong)]" : "border-[var(--border-subtle)]"}`}
						>
							<Button
								variant="bare"
								className={`shrink-0 whitespace-nowrap px-2 py-1 text-[length:var(--text-2xs)] ${state === "string" ? "bg-[var(--accent)] font-semibold text-[color:var(--on-accent)]" : "bg-[var(--surface-recessed)] text-[color:var(--muted)]"}`}
								onClick={() => setLevel(level, customValue || level)}
							>
								{t("customBtn")}
							</Button>
							<Field
								className="min-w-0 w-[12ch] rounded-none border-0 border-l border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-2 py-1 text-[length:var(--text-2xs)]"
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
		<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.75 rounded-[var(--radius-s)] border border-[color-mix(in_srgb,var(--accent)_30%,var(--border-subtle))] px-2.75 py-2.5">
			<div className="grid min-w-0 gap-0.5">
				<span className="text-[length:var(--text-2xs)] text-[color:var(--text-dim)]">{t("deviceCode")}</span>
				<strong className="font-[family-name:var(--font-mono)] text-[length:var(--text-md)] leading-tight tracking-[var(--tracking-normal)] text-[color:var(--text)]">
					{code}
				</strong>
			</div>
			<Button size="sm" variant="outline" type="button" onClick={() => void copyCode()}>
				{copied ? t("copied") : t("copy")}
			</Button>
			{remainingSeconds !== undefined ? (
				<small
					className={
						remainingSeconds === 0
							? "col-span-full text-[length:var(--text-2xs)] text-[color:var(--danger)]"
							: "col-span-full text-[length:var(--text-2xs)] text-[color:var(--text-dim)]"
					}
				>
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
			className="h-[min(78vh,760px)] max-h-[calc(100dvh-16px)] w-[min(900px,100%)] overflow-hidden"
			bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
			onClose={providerSetupInProgress || settingUpProvider ? () => undefined : requestClose}
		>
			<div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 px-6 pt-2 pb-4 max-md:grid-cols-1">
				<aside className="flex min-h-0 flex-col overflow-hidden max-md:max-h-[220px]">
					<div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 py-2">
						<Button
							variant="bare"
							className="flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5! py-2.5! min-h-9! text-left text-[length:var(--text-sm)] font-medium text-[color:var(--text)] hover:bg-[var(--hover)]"
							onClick={() => setSelection({ type: "scope" })}
						>
							<span className="min-w-0 flex-1 truncate">{t("modelScopeTitle")}</span>
							<small className="ml-auto font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--muted)]">
								enabledModels
							</small>
						</Button>
						{providers.map((provider) => (
							<Button
								variant="bare"
								key={provider.id}
								className={`flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5! py-2.5! min-h-9! text-left text-[length:var(--text-sm)] text-[color:var(--text)] hover:bg-[var(--hover)] ${
									selectedProviderId === provider.id ? "font-semibold" : "font-medium"
								}`}
								onClick={() => {
									onChangeProvider(provider.id);
									setSelection({ type: "managed", providerId: provider.id });
									if (!provider.configured) requestProviderSetup(provider);
								}}
							>
								<ProviderMark providerId={provider.id} name={provider.name} />
								<span className="min-w-0 flex-1 truncate">{provider.name}</span>
								{provider.configured ? (
									<span
										className="ml-auto size-1.5 rounded-full bg-[var(--success)]"
										title={t("connectedDot")}
									/>
								) : null}
							</Button>
						))}
						{config.map((provider) => (
							<div key={provider.id} className="grid gap-2.5">
								<Button
									variant="bare"
									className="flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5! py-2.5! min-h-9! text-left text-[length:var(--text-sm)] font-medium text-[color:var(--text)] hover:bg-[var(--hover)]"
									onClick={() => {
										setSelection({ type: "provider", providerId: provider.id });
										resetDiscovery();
									}}
								>
									<ProviderMark providerId={provider.id} name={provider.name ?? provider.id} />
									<span className="min-w-0 flex-1 truncate">{provider.name ?? provider.id}</span>
								</Button>
								{provider.models?.map((model, index) => (
									<Button
										variant="bare"
										key={`${model.id}-${index}`}
										className="flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] py-2.5! pr-2.5! pl-8! min-h-9! text-left text-[length:var(--text-sm)] font-medium text-[color:var(--text)] hover:bg-[var(--hover)]"
										onClick={() =>
											setSelection({ type: "model", providerId: provider.id, modelIndex: index })
										}
									>
										<span className="min-w-0 flex-1 truncate">{model.name ?? model.id}</span>
										{model.reasoning ? (
											<span className="shrink-0 rounded-[var(--radius-3xs)] bg-[color-mix(in_oklab,var(--ds-purple)_12%,transparent)] px-1 py-px text-[length:var(--text-2xs)] font-bold text-[color-mix(in_oklab,var(--ds-purple)_80%,transparent)]">
												T
											</span>
										) : null}
									</Button>
								))}
							</div>
						))}
						{!loading && config.length === 0 ? (
							<p className="m-0 text-[length:var(--text-sm)] leading-[1.55] text-[color:var(--muted)]">
								{t("noCustomProviders")}
							</p>
						) : null}
					</div>
					<div className="shrink-0 px-2.5 pt-2">
						<Button
							size="sm"
							variant="outline"
							type="button"
							className="h-8 w-full"
							onClick={() => {
								setProviderPickerQuery("");
								setProviderPickerOpen(true);
							}}
						>
							{t("addProvider")}
						</Button>
					</div>
				</aside>

				<section className="min-h-0 min-w-0 overflow-y-auto">
					{selection?.type === "scope" ? (
						<div className="grid content-start gap-3 rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
							<div className="flex items-center justify-between text-[length:var(--text-md)] font-semibold text-[color:var(--text)]">
								<span>{t("modelScopeTitle")}</span>
								<span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[color:var(--accent)]">
									{t("globalSetting")}
								</span>
							</div>
							<p className="mt-1 mb-0 text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
								{t("scopeDescription1")} <code>:thinking</code> {t("scopeDescription2")}
								<code>anthropic/*:high</code>
								{t("scopeDescription3")}
							</p>
							<Field
								as="textarea"
								className="min-h-[164px] font-[family-name:var(--font-mono)] leading-[1.55]"
								value={modelScopeText}
								placeholder={"anthropic/*:high\nopenai/gpt-5*"}
								spellCheck={false}
								onChange={(event) => setModelScopeText(event.target.value)}
							/>
							{modelScopeWarnings.length ? (
								<output className="grid gap-1.5 rounded-[var(--radius-s)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-2.5 py-2 text-[color:var(--warning)]">
									{modelScopeWarnings.map((warning) => (
										<p key={warning}>{warning}</p>
									))}
								</output>
							) : null}
							{modelScopeError ? (
								<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">
									{modelScopeError}
								</p>
							) : null}
							<Button
								variant="primary"
								type="button"
								disabled={
									!hasModelScopeChanges || modelScopeSaving || providerSetupInProgress || settingUpProvider
								}
								onClick={() => void handleSaveModelScope()}
							>
								{modelScopeSaving ? t("saving") : t("saveModelScope")}
							</Button>
						</div>
					) : managedProvider ? (
						<div className="grid content-start gap-3 rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
							<div className="flex items-center justify-between text-[length:var(--text-md)] font-semibold text-[color:var(--text)]">
								<span>{managedProvider.name}</span>
								<span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[color:var(--accent)]">
									{managedProvider.credentialType === "oauth" ? "OAuth" : "API Key"}
								</span>
							</div>
							<p className="mt-1 mb-0 text-[length:var(--text-xs)] leading-normal text-[color:var(--muted)]">
								{t("connectedProviderDescription")}
							</p>
							<div className="flex flex-wrap gap-2">
								{managedProvider.supportsApiKey && managedProvider.supportsOAuth ? (
									<Button variant="outline" type="button" onClick={() => setAuthProvider(managedProvider)}>
										{t("switchAuthMethod")}
									</Button>
								) : null}
								<Button
									variant="outline"
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
								</Button>
								{confirmDisconnectProviderId === managedProvider.id ? (
									<>
										<Button
											variant="danger"
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
										</Button>
										<Button
											variant="outline"
											type="button"
											onClick={() => setConfirmDisconnectProviderId(undefined)}
										>
											{t("cancel")}
										</Button>
									</>
								) : (
									<Button
										variant="danger"
										type="button"
										onClick={() => setConfirmDisconnectProviderId(managedProvider.id)}
									>
										{t("disconnect")}
									</Button>
								)}
							</div>
						</div>
					) : selectedProvider && selection?.type === "provider" ? (
						<div className="grid content-start gap-3 rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
							<div className="flex items-center justify-between text-[length:var(--text-md)] font-semibold text-[color:var(--text)]">
								<span>{t("provider")}</span>
								<Button size="sm" type="button" onClick={removeProvider}>
									{t("delete")}
								</Button>
							</div>
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								{t("providerName")}
								<Field
									defaultValue={selectedProvider.id}
									key={selectedProvider.id}
									onBlur={(event) => renameProvider(event.target.value)}
								/>
							</label>
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								{t("displayName")}
								<Field
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
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								Base URL
								<Field
									className="font-[family-name:var(--font-mono)]"
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
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								API Key
								<div className="relative">
									<Field
										className="pr-11 font-[family-name:var(--font-mono)]"
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
									<Button
										size="sm"
										className="absolute top-1/2 right-1.5 min-w-[34px] -translate-y-1/2 rounded-[var(--radius-3xs)] border-0 bg-transparent px-1 py-0.5 text-[length:var(--text-2xs)] text-[color:var(--text-dim)]"
										aria-label={showProviderApiKey ? t("hideApiKey") : t("showApiKey")}
										title={showProviderApiKey ? t("hideApiKey") : t("showApiKey")}
										onClick={() => setShowProviderApiKey((visible) => !visible)}
									>
										{showProviderApiKey ? t("hide") : t("show")}
									</Button>
								</div>
								<small>{t("apiKeyHint")}</small>
							</label>
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								API
								<Field
									as="select"
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
								</Field>
							</label>
							<div className="grid gap-2 border-t border-[var(--border-subtle)] pt-3.5">
								{discovery.phase !== "success" ? (
									<Button
										variant="outline"
										type="button"
										disabled={!selectedProvider.baseUrl?.trim() || discovery.phase === "loading"}
										onClick={() => void handleDiscover()}
									>
										{discovery.phase === "loading" ? t("fetchingModels") : t("fetchModelsFromProvider")}
									</Button>
								) : null}
								{discovery.phase === "error" ? (
									<p className="mx-4 mb-2 text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">
										{discovery.message}
									</p>
								) : null}
								{discovery.phase === "success" ? (
									<>
										<Field
											value={discoveryQuery}
											placeholder={t("filterModelsCount", { count: discovery.models.length })}
											onChange={(event) => setDiscoveryQuery(event.target.value)}
										/>
										<div className="max-h-[200px] overflow-auto rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] text-[length:var(--text-xs)]">
											<label className="flex items-center gap-1.5">
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
													<label
														className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--text-dim)]"
														key={id}
													>
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
										<div className="flex items-center justify-between gap-2 text-[length:var(--text-xs)] text-[color:var(--muted)]">
											<span>{t("fetchedModelsCount", { count: discovery.models.length })}</span>
											<Button
												variant="primary"
												type="button"
												disabled={selectedDiscovered.length === 0}
												onClick={addDiscoveredModels}
											>
												{selectedDiscovered.length
													? t("addSelectedCount", { count: selectedDiscovered.length })
													: t("addSelected")}
											</Button>
										</div>
									</>
								) : null}
							</div>
							<Button variant="outline" type="button" onClick={addModel}>
								{t("addModelManually")}
							</Button>
						</div>
					) : selectedProvider && selectedModel ? (
						<div className="grid content-start gap-3 rounded-[var(--radius-lg)] bg-[var(--ds-tile)] px-4 py-3.5">
							<div className="flex items-center justify-between text-[length:var(--text-md)] font-semibold text-[color:var(--text)]">
								<span>{t("models")}</span>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										type="button"
										disabled={modelTest.phase === "loading" || !selectedModel.id.trim()}
										onClick={() => void handleModelTest()}
									>
										{modelTest.phase === "loading" ? t("testing") : t("testConnection")}
									</Button>
									<Button size="sm" type="button" onClick={removeModel}>
										{t("remove")}
									</Button>
								</div>
							</div>
							{modelTest.phase !== "idle" && modelTest.phase !== "loading" ? (
								<p
									className={
										modelTest.phase === "error"
											? "text-[length:var(--text-xs)] text-[color:var(--danger)]"
											: "text-[length:var(--text-xs)] text-[color:var(--success)]"
									}
								>
									{modelTest.message}
								</p>
							) : null}
							<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
									{t("idLabel")}
									<Field
										className="font-[family-name:var(--font-mono)]"
										value={selectedModel.id}
										onChange={(event) => updateModel((model) => ({ ...model, id: event.target.value }))}
									/>
								</label>
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
									{t("nameLabel")}
									<Field
										value={selectedModel.name ?? ""}
										placeholder={t("displayNamePlaceholder")}
										onChange={(event) =>
											updateModel((model) => ({ ...model, name: event.target.value || undefined }))
										}
									/>
								</label>
							</div>
							<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
								{t("apiOverride")}
								<Field
									as="select"
									value={selectedModel.api ?? ""}
									onChange={(event) =>
										updateModel((model) => ({ ...model, api: event.target.value || undefined }))
									}
								>
									<option value="">{t("default")}</option>
									{API_OPTIONS.map((option) => (
										<option key={option}>{option}</option>
									))}
								</Field>
							</label>
							<div className="flex gap-3">
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
									<input
										type="checkbox"
										checked={selectedModel.reasoning ?? false}
										onChange={(event) =>
											updateModel((model) => ({ ...model, reasoning: event.target.checked || undefined }))
										}
									/>
									{t("reasoningLabel")}
								</label>
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
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
									<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
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
								<Button
									size="sm"
									variant="outline"
									disabled={catalogFill.state === "loading"}
									onClick={() => void handleCatalogFill()}
								>
									{catalogFill.state === "loading" ? t("querying") : t("fillFromCatalog")}
								</Button>
								<a
									className="text-[length:var(--text-2xs)] text-[color:var(--muted)] no-underline hover:text-[color:var(--accent)]"
									href="https://github.com/anomalyco/models.dev"
									onClick={(event) => {
										event.preventDefault();
										void window.piDesktop.openExternalUrl("https://github.com/anomalyco/models.dev");
									}}
								>
									{t("catalogSource")}
								</a>
								{catalogUndo ? (
									<Button size="sm" variant="outline" onClick={undoCatalogFill}>
										{t("undoFill")}
									</Button>
								) : null}
							</div>
							{catalogFill.state === "success" ? (
								<p className="text-[length:var(--text-xs)] text-[color:var(--success)]">{t("catalogFilled")}</p>
							) : catalogFill.state === "error" ? (
								<p className="text-[length:var(--text-xs)] text-[color:var(--danger)]">{catalogFill.message}</p>
							) : null}
							{selectedModel.reasoning ? (
								<div className="border-t border-[var(--border-subtle)] pt-3.5">
									<div className="mb-2 flex items-center justify-between text-[length:var(--text-xs)] font-semibold text-[color:var(--muted)]">
										<span>Thinking level map</span>
										{selectedModel.thinkingLevelMap ? (
											<Button
												size="sm"
												variant="outline"
												onClick={() => updateModel((model) => ({ ...model, thinkingLevelMap: undefined }))}
											>
												{t("clear")}
											</Button>
										) : null}
									</div>
									<ThinkingLevelMapEditor
										value={selectedModel.thinkingLevelMap}
										onChange={(value) => updateModel((model) => ({ ...model, thinkingLevelMap: value }))}
									/>
								</div>
							) : null}
							<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
									{t("contextWindowLabel")}
									<Field
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
								<label className="grid gap-1 text-[length:var(--text-sm)] font-medium">
									{t("maxTokensLabel")}
									<Field
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
								<p className="mb-2 text-[length:var(--text-xs)] font-semibold text-[color:var(--muted)]">
									{t("costLabel")}
								</p>
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
									{COST_FIELDS.map((field) => (
										<label className="grid gap-1 text-[length:var(--text-sm)] font-medium" key={field}>
											{field}
											<Field
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
						<div className="grid justify-items-start gap-2 px-5 py-12 text-[color:var(--muted)]">
							<strong className="text-[length:var(--text-md)] font-semibold">{t("setupProvidersTitle")}</strong>
							<p>{t("setupProvidersHint")}</p>
							<Button variant="primary" type="button" onClick={addProvider}>
								{t("addProvider")}
							</Button>
						</div>
					)}
				</section>
			</div>
			{providerSetupInProgress || settingUpProvider ? (
				<div className="absolute inset-0 z-[12] grid place-items-center bg-black/40 p-[18px]">
					<div
						className="grid w-[min(460px,100%)] gap-3.5 rounded-[var(--radius-l)] border border-[var(--border-strong)] bg-[var(--surface-1)] p-[18px] shadow-[var(--shadow-float)]"
						role="dialog"
						aria-modal="true"
						aria-label={t("connectProviderTitle")}
					>
						<div className="grid gap-1">
							<strong className="text-[length:var(--text-base)] text-[color:var(--text)]">
								{t("connectProviderTitle")}
							</strong>
							<span className="text-[length:var(--text-xs)] text-[color:var(--muted)]">
								{t("connectProviderHint")}
							</span>
						</div>
						{authenticationPrompt ? (
							<form
								className="grid gap-2"
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
									<Button size="sm" type="button" onClick={() => void openExternalUrl(authenticationUrl)}>
										{t("openAuthPage")}
									</Button>
								) : null}
								<p>{authenticationPrompt.message}</p>
								{authenticationPrompt.type === "select" ? (
									<Field
										as="select"
										disabled={authenticationResolving}
										value={authenticationResponse}
										onChange={(event) => onChangeAuthenticationResponse(event.target.value)}
									>
										{authenticationPrompt.options?.map((option) => (
											<option key={option.id} value={option.id}>
												{option.label}
											</option>
										))}
									</Field>
								) : (
									<Field
										disabled={authenticationResolving}
										placeholder={authenticationPrompt.placeholder}
										type={authenticationPrompt.type === "secret" ? "password" : "text"}
										value={authenticationResponse}
										onChange={(event) => onChangeAuthenticationResponse(event.target.value)}
									/>
								)}
								<Button variant="primary" type="submit" disabled={authenticationResolving}>
									{authenticationResolving ? t("processingDots") : t("continue")}
								</Button>
							</form>
						) : (
							<div className="grid gap-2">
								{authenticationNotice ? <p>{authenticationNotice}</p> : <p>{t("waitingForProvider")}</p>}
								{authenticationUserCode ? (
									<AuthenticationDeviceCode
										code={authenticationUserCode}
										expiresAt={authenticationExpiresAt}
									/>
								) : null}
								{authenticationUrl ? (
									<Button size="sm" type="button" onClick={() => void openExternalUrl(authenticationUrl)}>
										{t("openAuthPage")}
									</Button>
								) : null}
							</div>
						)}
						<Button variant="outline" type="button" onClick={onCancelProviderSetup}>
							{t("cancelConnect")}
						</Button>
					</div>
				</div>
			) : null}

			<footer className="flex items-center gap-2 border-t border-[var(--ds-border-subtle)] px-4 py-3">
				{saveError ? (
					<span className="mr-auto text-[length:var(--text-xs)] leading-[1.45] text-[color:var(--danger)]">
						{saveError}
					</span>
				) : (
					<span className="mr-auto text-[length:var(--text-xs)] text-[color:var(--muted)]">
						{hasChanges ? t("unsavedChanges") : t("configSaved")}
					</span>
				)}
				<Button
					variant="outline"
					type="button"
					disabled={providerSetupInProgress || settingUpProvider}
					onClick={requestClose}
				>
					{t("cancel")}
				</Button>
				<Button
					variant="primary"
					type="button"
					disabled={!hasChanges || saving || providerSetupInProgress || settingUpProvider}
					onClick={() => void handleSave()}
				>
					{saving ? t("saving") : t("saveChanges")}
				</Button>
			</footer>
			{providerPickerOpen ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭嵌套对话框
				<div
					className="absolute inset-0 z-10 grid place-items-center bg-black/35 p-4"
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
					<div
						className="max-h-[72%] w-[min(820px,100%)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg)] shadow-[0_8px_32px_rgb(0_0_0_/_22%)]"
						role="dialog"
						aria-modal="true"
						aria-label={t("addProvider")}
					>
						<div className="border-b border-[var(--border-subtle)] px-3.5 py-2.5 text-[length:var(--text-md)] text-[color:var(--text)]">
							{t("addProvider")}
						</div>
						<Field
							className="mx-3.5 mt-3 w-[calc(100%-28px)]"
							ref={providerPickerInputRef}
							value={providerPickerQuery}
							placeholder={t("filterProviders")}
							onChange={(event) => setProviderPickerQuery(event.target.value)}
						/>
						<div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-auto p-3.5">
							<Button
								variant="bare"
								className="flex min-w-0 items-center gap-2 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2.5 text-left text-[color:var(--text)] hover:border-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-50"
								onClick={() => {
									addProvider();
									setProviderPickerOpen(false);
								}}
							>
								<span>
									<strong className="text-[length:var(--text-md)] font-semibold">
										{t("customEndpointTitle")}
									</strong>
									<small>{t("customEndpointSubtitle")}</small>
								</span>
								<b className="grid size-[26px] place-items-center rounded-[var(--radius-2xs)] bg-[var(--hover)] text-[length:var(--text-2xs)] text-[color:var(--text-dim)]">
									＋
								</b>
							</Button>
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
									<Button
										variant="bare"
										className="flex min-w-0 items-center gap-2 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2.5 text-left text-[color:var(--text)] hover:border-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-50"
										key={provider.id}
										disabled={settingUpProvider || providerSetupInProgress}
										onClick={() => {
											onChangeProvider(provider.id);
											setProviderPickerOpen(false);
											setSelection({ type: "managed", providerId: provider.id });
											if (!provider.configured) requestProviderSetup(provider);
										}}
									>
										<span>
											<strong className="text-[length:var(--text-md)] font-semibold">{provider.name}</strong>
											<small>
												{provider.supportsApiKey && provider.supportsOAuth
													? "API Key / OAuth"
													: provider.supportsOAuth
														? (provider.oauthName ?? "OAuth")
														: "API Key"}
											</small>
										</span>
										<ProviderMark providerId={provider.id} name={provider.name} />
									</Button>
								))}
						</div>
					</div>
				</div>
			) : null}
			{authProvider ? (
				<Modal
					title={t("connectAuthTitle", { name: authProvider.name })}
					className="w-[min(420px,100%)] max-h-none"
					footerClassName="is-end"
					onClose={() => setAuthProvider(undefined)}
					footer={
						<>
							<Button variant="outline" autoFocus type="button" onClick={() => setAuthProvider(undefined)}>
								{t("cancel")}
							</Button>
							<Button
								variant="outline"
								type="button"
								onClick={() => {
									const provider = authProvider;
									setAuthProvider(undefined);
									onStartProviderSetup(provider.id, "api_key");
								}}
							>
								API Key
							</Button>
							<Button
								variant="primary"
								type="button"
								onClick={() => {
									const provider = authProvider;
									setAuthProvider(undefined);
									onStartProviderSetup(provider.id, "oauth");
								}}
							>
								{authProvider.oauthName ?? "OAuth"}
							</Button>
						</>
					}
				>
					<p>{t("chooseAuthMethod")}</p>
				</Modal>
			) : null}
			{confirmDiscard ? (
				<Modal
					title={t("discardChangesTitle")}
					className="w-[min(420px,100%)] max-h-none"
					footerClassName="is-end"
					onClose={() => setConfirmDiscard(false)}
					footer={
						<>
							<Button variant="outline" autoFocus type="button" onClick={() => setConfirmDiscard(false)}>
								{t("keepEditing")}
							</Button>
							<Button variant="danger" type="button" onClick={onClose}>
								{t("discardChanges")}
							</Button>
						</>
					}
				>
					<p>{t("discardChangesHint")}</p>
				</Modal>
			) : null}
		</Modal>
	);
});
