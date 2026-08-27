import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Response as FetchResponse } from "undici-types";

export interface ModelsJsonModel {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
}

export interface ModelsJsonProvider {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	oauth?: "radius";
	models?: ModelsJsonModel[];
}

export interface ModelsJson {
	providers: Record<string, ModelsJsonProvider>;
}

function stripJsonComments(content: string): string {
	return content.replace(/^\s*\/\/.*$/gmu, "").replace(/^\s*\/\*[\s\S]*?\*\//gmu, "");
}

export async function readModelsConfig(modelsPath: string): Promise<ModelsJson> {
	try {
		const content = await readFile(modelsPath, "utf8");
		const parsed = JSON.parse(stripJsonComments(content)) as ModelsJson;
		if (typeof parsed !== "object" || parsed === null || typeof parsed.providers !== "object") {
			return { providers: {} };
		}
		return parsed;
	} catch {
		return { providers: {} };
	}
}

export async function writeModelsConfig(modelsPath: string, config: ModelsJson): Promise<void> {
	const content = `${JSON.stringify(config, null, 2)}\n`;
	await writeFile(modelsPath, content, "utf8");
}

export interface DiscoveredModel {
	id: string;
}

export interface ModelCatalogEntry {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const MODEL_CATALOG_URL = process.env.MODEL_CATALOG_URL ?? "https://models.dev/api.json";

let catalogCache: { at: number; data: Record<string, unknown> } | undefined;

async function loadModelCatalog(): Promise<Record<string, unknown>> {
	if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.data;
	const response = (await fetch(MODEL_CATALOG_URL, { signal: AbortSignal.timeout(12_000) })) as FetchResponse;
	if (!response.ok) throw new Error(`模型目录获取失败：HTTP ${response.status}`);
	const data = (await response.json()) as Record<string, unknown>;
	catalogCache = { at: Date.now(), data };
	return data;
}

function toCatalogEntry(raw: Record<string, unknown>): ModelCatalogEntry | undefined {
	if (typeof raw.id !== "string" || !raw.id) return undefined;
	const cost = typeof raw.cost === "object" && raw.cost !== null ? (raw.cost as Record<string, unknown>) : undefined;
	const numberOr = (value: unknown): number | undefined =>
		typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
	return {
		id: raw.id,
		...(typeof raw.name === "string" && raw.name ? { name: raw.name } : {}),
		...(raw.reasoning === true ? { reasoning: true } : {}),
		...(Array.isArray(raw.input)
			? { input: raw.input.filter((item): item is string => typeof item === "string") }
			: {}),
		...(numberOr(raw.context_window) || numberOr(raw.contextWindow)
			? { contextWindow: numberOr(raw.context_window) ?? numberOr(raw.contextWindow) }
			: {}),
		...(numberOr(raw.max_tokens) || numberOr(raw.maxTokens)
			? { maxTokens: numberOr(raw.max_tokens) ?? numberOr(raw.maxTokens) }
			: {}),
		...(cost
			? {
					cost: {
						input: numberOr(cost.input) ?? 0,
						output: numberOr(cost.output) ?? 0,
						cacheRead: numberOr(cost.cache_read) ?? numberOr(cost.cacheRead) ?? 0,
						cacheWrite: numberOr(cost.cache_write) ?? numberOr(cost.cacheWrite) ?? 0,
					},
				}
			: {}),
	};
}

/** 从 models.dev 目录查找模型元数据，用于自动填充表单。 */
export async function lookupModelCatalog(providerId: string, modelId: string): Promise<ModelCatalogEntry | undefined> {
	const catalog = await loadModelCatalog();
	const provider = catalog[providerId];
	if (typeof provider !== "object" || provider === null) return undefined;
	const models = (provider as Record<string, unknown>).models;
	if (typeof models !== "object" || models === null) return undefined;
	const exact = (models as Record<string, unknown>)[modelId];
	if (typeof exact !== "object" || exact === null) return undefined;
	return toCatalogEntry({ ...(exact as Record<string, unknown>), id: modelId });
}

export async function discoverModels(baseUrl: string, apiKey?: string): Promise<DiscoveredModel[]> {
	const endpoint = baseUrl.replace(/\/+$/u, "");
	const response = (await fetch(`${endpoint}/models`, {
		headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
	})) as FetchResponse;
	if (!response.ok) {
		throw new Error(`模型发现失败：HTTP ${response.status}`);
	}
	const data = (await response.json()) as { data?: Array<{ id?: string }> };
	const models = (data.data ?? [])
		.filter((model): model is { id: string } => typeof model.id === "string" && model.id.length > 0)
		.map((model) => ({ id: model.id }));
	return models;
}

export function modelsJsonPathFor(agentDir: string): string {
	return join(agentDir, "models.json");
}
