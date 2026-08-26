import { memo, useCallback, useEffect, useState } from "react";
import type { DesktopApiKeyProvider, DesktopModel, DesktopProviderConfig } from "../shared/contracts.ts";
import { discoverModels, getModelsConfig, saveModelsConfig } from "./desktop-store.ts";
import { Modal } from "./modal.tsx";

interface ModelsConfigModalProps {
	providers: DesktopApiKeyProvider[];
	models: DesktopModel[];
	selectedProviderId: string;
	selectedModelKey: string;
	providerSetupInProgress: boolean;
	settingUpProvider: boolean;
	settingModel: boolean;
	onChangeProvider: (providerId: string) => void;
	onChangeModel: (modelKey: string) => void;
	onStartProviderSetup: () => void;
	onClose: () => void;
}

function modelKeyOf(provider: string, id: string): string {
	return `${provider}\u0000${id}`;
}

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages"];

export const ModelsConfigModal = memo(function ModelsConfigModal({
	providers,
	models,
	selectedProviderId,
	selectedModelKey,
	providerSetupInProgress,
	settingUpProvider,
	settingModel,
	onChangeProvider,
	onChangeModel,
	onStartProviderSetup,
	onClose,
}: ModelsConfigModalProps) {
	const [customProviders, setCustomProviders] = useState<DesktopProviderConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedCustomId, setSelectedCustomId] = useState<string>();
	const [editing, setEditing] = useState<DesktopProviderConfig>({ id: "" });
	const [discovery, setDiscovery] = useState<Array<{ id: string; selected: boolean }>>([]);
	const [discovering, setDiscovering] = useState(false);
	const [discoveryError, setDiscoveryError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string>();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const config = await getModelsConfig();
			setCustomProviders(config);
			if (config.length > 0 && !selectedCustomId) {
				setSelectedCustomId(config[0]?.id);
				setEditing(config[0] ?? { id: "" });
			}
		} catch {
			setCustomProviders([]);
		} finally {
			setLoading(false);
		}
	}, [selectedCustomId]);

	useEffect(() => {
		void load();
	}, [load]);

	function selectCustom(id: string): void {
		setSelectedCustomId(id);
		const provider = customProviders.find((item) => item.id === id);
		setEditing(provider ?? { id });
		setDiscovery([]);
		setDiscoveryError(undefined);
	}

	function addProvider(): void {
		let id = "new-provider";
		let index = 1;
		while (customProviders.some((provider) => provider.id === id)) {
			id = `new-provider-${index}`;
			index += 1;
		}
		const provider: DesktopProviderConfig = { id, api: "openai-completions" };
		setCustomProviders((current) => [...current, provider]);
		setSelectedCustomId(id);
		setEditing(provider);
	}

	function removeProvider(id: string): void {
		setCustomProviders((current) => current.filter((provider) => provider.id !== id));
		if (selectedCustomId === id) {
			setSelectedCustomId(undefined);
			setEditing({ id: "" });
		}
	}

	function updateEditing(patch: Partial<DesktopProviderConfig>): void {
		setEditing((current) => ({ ...current, ...patch }));
		setCustomProviders((current) =>
			current.map((provider) => (provider.id === editing.id ? { ...provider, ...patch } : provider)),
		);
	}

	async function handleDiscover(): Promise<void> {
		if (!editing.baseUrl?.trim()) return;
		setDiscovering(true);
		setDiscoveryError(undefined);
		try {
			const found = await discoverModels(editing.baseUrl.trim(), editing.apiKey);
			setDiscovery(found.map((model) => ({ id: model.id, selected: false })));
		} catch (error) {
			setDiscoveryError(error instanceof Error ? error.message : String(error));
		} finally {
			setDiscovering(false);
		}
	}

	function toggleDiscovered(id: string): void {
		setDiscovery((current) =>
			current.map((model) => (model.id === id ? { ...model, selected: !model.selected } : model)),
		);
	}

	function addSelectedModels(): void {
		const selected = discovery.filter((model) => model.selected).map((model) => ({ id: model.id }));
		if (selected.length === 0) return;
		updateEditing({ models: [...(editing.models ?? []), ...selected] });
		setDiscovery([]);
	}

	async function handleSave(): Promise<void> {
		setSaving(true);
		setSaveError(undefined);
		try {
			await saveModelsConfig(customProviders);
			onClose();
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal title="模型" onClose={onClose}>
			<div className="models-config">
				<div className="models-config-sidebar">
					<div className="models-provider-list">
						{customProviders.map((provider) => (
							<button
								key={provider.id}
								className={`models-provider-item ${selectedCustomId === provider.id ? "is-active" : ""}`}
								type="button"
								onClick={() => selectCustom(provider.id)}
							>
								<span>{provider.name ?? provider.id}</span>
							</button>
						))}
						{!loading && customProviders.length === 0 ? <p className="modal-empty">暂无自定义服务商。</p> : null}
					</div>
					<button className="outline-button" type="button" onClick={addProvider}>
						添加服务商
					</button>
				</div>
				<div className="models-config-main">
					{selectedCustomId ? (
						<div className="settings-modal-sections">
							<section className="settings-group">
								<p className="section-kicker">服务商</p>
								<div className="provider-form">
									<label htmlFor="provider-name">名称</label>
									<input
										id="provider-name"
										value={editing.name ?? ""}
										placeholder="provider-name"
										onChange={(event) => updateEditing({ name: event.target.value || undefined })}
									/>
									<label htmlFor="provider-base-url">Base URL</label>
									<input
										id="provider-base-url"
										value={editing.baseUrl ?? ""}
										placeholder="https://api.example.com/v1"
										onChange={(event) => updateEditing({ baseUrl: event.target.value || undefined })}
									/>
									<label htmlFor="provider-api-key">API Key</label>
									<input
										id="provider-api-key"
										value={editing.apiKey ?? ""}
										placeholder="API key"
										onChange={(event) => updateEditing({ apiKey: event.target.value || undefined })}
									/>
									<label htmlFor="provider-api">API 类型</label>
									<select
										id="provider-api"
										value={editing.api ?? "openai-completions"}
										onChange={(event) => updateEditing({ api: event.target.value })}
									>
										{API_OPTIONS.map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
								</div>
							</section>
							<section className="settings-group">
								<p className="section-kicker">模型发现</p>
								<button
									className="outline-button"
									type="button"
									disabled={!editing.baseUrl?.trim() || discovering}
									onClick={() => void handleDiscover()}
								>
									{discovering ? "正在发现…" : "从 Base URL 发现模型"}
								</button>
								{discoveryError ? <p className="sidebar-error">{discoveryError}</p> : null}
								{discovery.length ? (
									<div className="discovery-list">
										{discovery.map((model) => (
											<label key={model.id} className="discovery-row">
												<input
													type="checkbox"
													checked={model.selected}
													onChange={() => toggleDiscovered(model.id)}
												/>
												<span>{model.id}</span>
											</label>
										))}
										<button className="accent-button" type="button" onClick={addSelectedModels}>
											添加选中模型
										</button>
									</div>
								) : null}
							</section>
							{editing.models?.length ? (
								<section className="settings-group">
									<p className="section-kicker">已配置模型</p>
									<ul className="resource-list">
										{editing.models.map((model) => (
											<li key={model.id}>
												<code>{model.id}</code>
											</li>
										))}
									</ul>
								</section>
							) : null}
							<div className="models-actions">
								<button className="quiet-button" type="button" onClick={() => removeProvider(selectedCustomId)}>
									删除
								</button>
								<button
									className="accent-button"
									type="button"
									disabled={saving}
									onClick={() => void handleSave()}
								>
									{saving ? "保存中…" : "保存"}
								</button>
							</div>
							{saveError ? <p className="sidebar-error">{saveError}</p> : null}
						</div>
					) : (
						<p className="modal-empty">选择或添加一个服务商。</p>
					)}
				</div>
			</div>
			<div className="settings-modal-sections models-builtin">
				<section className="settings-group">
					<p className="section-kicker">模型访问</p>
					{providers.length ? (
						<div className="provider-form">
							<label htmlFor="api-key-provider">服务商</label>
							<select
								id="api-key-provider"
								value={selectedProviderId}
								disabled={settingUpProvider || providerSetupInProgress}
								onChange={(event) => onChangeProvider(event.target.value)}
							>
								{providers.map((provider) => (
									<option key={provider.id} value={provider.id}>
										{provider.name}
										{provider.configured ? " · 已连接" : ""}
									</option>
								))}
							</select>
							<button
								className="accent-button"
								type="button"
								disabled={!selectedProviderId || settingUpProvider || providerSetupInProgress}
								onClick={onStartProviderSetup}
							>
								{settingUpProvider || providerSetupInProgress ? "正在配置" : "配置服务商"}
							</button>
						</div>
					) : (
						<p>正在加载可配置的模型服务商。</p>
					)}
				</section>
				<section className="settings-group">
					<p className="section-kicker">当前模型</p>
					<select
						aria-label="选择具体模型"
						disabled={settingModel || models.length === 0}
						value={selectedModelKey}
						onChange={(event) => onChangeModel(event.target.value)}
					>
						<option value="">{models.length ? "选择具体模型" : "请先配置服务商"}</option>
						{models.map((model) => (
							<option key={modelKeyOf(model.provider, model.id)} value={modelKeyOf(model.provider, model.id)}>
								{model.provider} / {model.name}
							</option>
						))}
					</select>
					<p>{settingModel ? "正在切换模型…" : `当前可选择 ${models.length} 个已认证模型。`}</p>
				</section>
			</div>
		</Modal>
	);
});
