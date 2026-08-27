import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopApiKeyProvider, DesktopProviderConfig, DesktopProviderModelConfig } from "../shared/contracts.ts";
import { discoverModels, getModelsConfig, logoutProvider, saveModelsConfig, testModel } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface ModelsConfigModalProps {
	providers: DesktopApiKeyProvider[];
	selectedProviderId: string;
	providerSetupInProgress: boolean;
	settingUpProvider: boolean;
	onChangeProvider: (providerId: string) => void;
	onStartProviderSetup: (providerId: string, authType: "api_key" | "oauth") => void;
	onClose: () => void;
}

type Selection =
	| { type: "managed"; providerId: string }
	| { type: "provider"; providerId: string }
	| { type: "model"; providerId: string; modelIndex: number };

type DiscoveryState =
	| { phase: "idle" }
	| { phase: "loading" }
	| { phase: "success"; models: string[] }
	| { phase: "error"; message: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function emptyCost(): NonNullable<DesktopProviderModelConfig["cost"]> {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export const ModelsConfigModal = memo(function ModelsConfigModal({
	providers,
	selectedProviderId,
	providerSetupInProgress,
	settingUpProvider,
	onChangeProvider,
	onStartProviderSetup,
	onClose,
}: ModelsConfigModalProps) {
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
	const [authProvider, setAuthProvider] = useState<DesktopApiKeyProvider>();
	const [modelTest, setModelTest] = useState<{ phase: "idle" | "loading" | "success" | "error"; message?: string }>({
		phase: "idle",
	});
	const hasChanges = JSON.stringify(config) !== JSON.stringify(savedConfig);
	const requestClose = useCallback(() => {
		if (hasChanges) setConfirmDiscard(true);
		else onClose();
	}, [hasChanges, onClose]);

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

	const managedProvider =
		selection?.type === "managed" ? providers.find((provider) => provider.id === selection.providerId) : undefined;
	const selectedProvider =
		selection && selection.type !== "managed"
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
		if (!selectedProvider || !window.confirm(`删除服务商“${selectedProvider.id}”及其全部模型？`)) return;
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
		if (!window.confirm(`删除模型“${selectedModel.name ?? selectedModel.id}”？`)) return;
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
							message: `连接成功 · ${result.latencyMs ?? 0}ms${result.responseText ? ` · ${result.responseText}` : ""}`,
						}
					: { phase: "error", message: result.error ?? "连接失败" },
			);
		} catch (error) {
			setModelTest({ phase: "error", message: error instanceof Error ? error.message : String(error) });
		}
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

	return (
		<Modal title="模型" subtitle="~/.pi/agent/models.json" className="models-modal" onClose={requestClose}>
			<div className="models-layout">
				<aside className="models-tree">
					<div className="models-tree-scroll">
						{providers.map((provider) => (
							<button
								key={provider.id}
								className={`models-tree-item provider ${selectedProviderId === provider.id ? "is-connected" : ""}`}
								type="button"
								onClick={() => {
									onChangeProvider(provider.id);
									if (provider.configured) setSelection({ type: "managed", providerId: provider.id });
									else requestProviderSetup(provider);
								}}
							>
								<span className="models-provider-mark">{provider.name.slice(0, 1).toUpperCase()}</span>
								<span>{provider.name}</span>
								{provider.configured ? <span className="models-connected-dot" title="已连接" /> : null}
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
									<span className="models-provider-mark">
										{(provider.name ?? provider.id).slice(0, 1).toUpperCase()}
									</span>
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
						{!loading && config.length === 0 ? <p className="modal-empty">尚未添加自定义服务商。</p> : null}
					</div>
					<button
						className="outline-button models-add-provider"
						type="button"
						onClick={() => setProviderPickerOpen(true)}
					>
						＋ 添加服务商
					</button>
				</aside>

				<section className="models-detail">
					{managedProvider ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>{managedProvider.name}</span>
								<span className="models-auth-badge">
									{managedProvider.credentialType === "oauth" ? "OAuth" : "API Key"}
								</span>
							</div>
							<p className="models-managed-description">
								该服务商已连接。断开后会移除本地保存的认证信息，不会删除模型配置。
							</p>
							<button
								className="danger-button"
								type="button"
								onClick={() => {
									setSaveError(undefined);
									void logoutProvider(managedProvider.id).catch((error: unknown) =>
										setSaveError(error instanceof Error ? error.message : String(error)),
									);
								}}
							>
								断开连接
							</button>
						</div>
					) : selectedProvider && selection?.type === "provider" ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>服务商</span>
								<button className="danger-text-button" type="button" onClick={removeProvider}>
									删除
								</button>
							</div>
							<label>
								服务商名称
								<input
									defaultValue={selectedProvider.id}
									key={selectedProvider.id}
									onBlur={(event) => renameProvider(event.target.value)}
								/>
							</label>
							<label>
								显示名称
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
								<input
									className="mono"
									type="password"
									value={selectedProvider.apiKey ?? ""}
									placeholder="留空以保留已保存的密钥"
									autoComplete="new-password"
									onChange={(event) => {
										updateProvider(selectedProvider.id, (provider) => ({
											...provider,
											apiKey: event.target.value || undefined,
										}));
										resetDiscovery();
									}}
								/>
								<small>已保存的密钥不会显示。输入新值会替换它；留空会保留原值。</small>
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
										{discovery.phase === "loading" ? "正在获取模型…" : "从服务商获取模型"}
									</button>
								) : null}
								{discovery.phase === "error" ? <p className="sidebar-error">{discovery.message}</p> : null}
								{discovery.phase === "success" ? (
									<>
										<input
											value={discoveryQuery}
											placeholder={`筛选 ${discovery.models.length} 个模型`}
											onChange={(event) => setDiscoveryQuery(event.target.value)}
										/>
										<div className="discovery-results">
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
														{added ? <span>已添加</span> : null}
													</label>
												);
											})}
										</div>
										<div className="discovery-footer">
											<span>已获取 {discovery.models.length} 个模型</span>
											<button
												className="accent-button"
												type="button"
												disabled={selectedDiscovered.length === 0}
												onClick={addDiscoveredModels}
											>
												添加选中项{selectedDiscovered.length ? ` (${selectedDiscovered.length})` : ""}
											</button>
										</div>
									</>
								) : null}
							</div>
							<button className="outline-button" type="button" onClick={addModel}>
								＋ 手动添加模型
							</button>
						</div>
					) : selectedProvider && selectedModel ? (
						<div className="models-detail-form">
							<div className="models-detail-heading">
								<span>模型</span>
								<div className="models-heading-actions">
									<button
										className="outline-button"
										type="button"
										disabled={modelTest.phase === "loading" || !selectedModel.id.trim()}
										onClick={() => void handleModelTest()}
									>
										{modelTest.phase === "loading" ? "测试中…" : "测试连接"}
									</button>
									<button className="danger-text-button" type="button" onClick={removeModel}>
										移除
									</button>
								</div>
							</div>
							{modelTest.phase !== "idle" && modelTest.phase !== "loading" ? (
								<p className={`model-test-result is-${modelTest.phase}`}>{modelTest.message}</p>
							) : null}
							<div className="models-form-grid">
								<label>
									ID *
									<input
										className="mono"
										value={selectedModel.id}
										onChange={(event) => updateModel((model) => ({ ...model, id: event.target.value }))}
									/>
								</label>
								<label>
									名称
									<input
										value={selectedModel.name ?? ""}
										placeholder="显示名称"
										onChange={(event) =>
											updateModel((model) => ({ ...model, name: event.target.value || undefined }))
										}
									/>
								</label>
							</div>
							<label>
								API 覆盖
								<select
									value={selectedModel.api ?? ""}
									onChange={(event) =>
										updateModel((model) => ({ ...model, api: event.target.value || undefined }))
									}
								>
									<option value="">默认</option>
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
									推理 / thinking
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
									图片输入
								</label>
							</div>
							<div className="models-form-grid">
								<label>
									上下文窗口（tokens）
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
									最大输出 tokens
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
								<p className="models-field-title">费用（每百万 tokens）</p>
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
							<strong>配置模型服务商</strong>
							<p>添加服务商，然后配置连接信息和模型。</p>
							<button className="accent-button" type="button" onClick={addProvider}>
								添加服务商
							</button>
						</div>
					)}
				</section>
			</div>

			<footer className="models-footer">
				{saveError ? (
					<span className="sidebar-error">{saveError}</span>
				) : (
					<span>{hasChanges ? "有未保存的更改" : "配置已保存"}</span>
				)}
				<button className="outline-button" type="button" onClick={requestClose}>
					取消
				</button>
				<button
					className="accent-button"
					type="button"
					disabled={!hasChanges || saving}
					onClick={() => void handleSave()}
				>
					{saving ? "保存中…" : "保存更改"}
				</button>
			</footer>
			{providerPickerOpen ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭嵌套对话框
				<div
					className="models-nested-backdrop"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setProviderPickerOpen(false);
					}}
				>
					<div className="models-provider-picker" role="dialog" aria-modal="true" aria-label="添加服务商">
						<div className="models-provider-picker-search">添加服务商</div>
						<div className="models-provider-picker-grid">
							<button
								type="button"
								onClick={() => {
									addProvider();
									setProviderPickerOpen(false);
								}}
							>
								<span>
									<strong>OpenAI / Anthropic compatible</strong>
									<small>自定义端点</small>
								</span>
								<b>＋</b>
							</button>
							{providers.map((provider) => (
								<button
									key={provider.id}
									type="button"
									disabled={settingUpProvider || providerSetupInProgress}
									onClick={() => {
										onChangeProvider(provider.id);
										setProviderPickerOpen(false);
										requestProviderSetup(provider);
									}}
								>
									<span>
										<strong>{provider.name}</strong>
										<small>API Key / OAuth</small>
									</span>
									<b>{provider.name.slice(0, 1).toUpperCase()}</b>
								</button>
							))}
						</div>
					</div>
				</div>
			) : null}
			{authProvider ? (
				<div className="models-nested-backdrop">
					<div className="models-discard-dialog" role="dialog" aria-modal="true" aria-label="选择认证方式">
						<strong>连接 {authProvider.name}</strong>
						<p>选择用于该服务商的认证方式。</p>
						<div>
							<button className="outline-button" type="button" onClick={() => setAuthProvider(undefined)}>
								取消
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
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) setConfirmDiscard(false);
					}}
				>
					<div className="models-discard-dialog" role="alertdialog" aria-modal="true">
						<strong>放弃未保存的更改？</strong>
						<p>关闭后，本次模型配置修改不会保存。</p>
						<div>
							<button className="outline-button" type="button" onClick={() => setConfirmDiscard(false)}>
								继续编辑
							</button>
							<button className="danger-button" type="button" onClick={onClose}>
								放弃更改
							</button>
						</div>
					</div>
				</div>
			) : null}
		</Modal>
	);
});
