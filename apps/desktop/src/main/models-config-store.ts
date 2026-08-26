import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ModelsJsonModel {
	id: string;
	name?: string;
	api?: string;
	contextWindow?: number;
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

export async function discoverModels(baseUrl: string, apiKey?: string): Promise<DiscoveredModel[]> {
	const endpoint = baseUrl.replace(/\/+$/u, "");
	const response = await fetch(`${endpoint}/models`, {
		headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
	});
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
