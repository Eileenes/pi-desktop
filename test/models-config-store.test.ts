import { describe, expect, it } from "vitest";
import { type ModelsJson, mergeModelsConfig } from "../src/main/models-config-store.ts";

describe("mergeModelsConfig", () => {
	it("preserves advanced provider, model, and top-level fields", () => {
		const current: ModelsJson = {
			version: 2,
			providers: {
				custom: {
					name: "Old name",
					apiKey: "stored-secret",
					headers: { "x-tenant": "tenant-a" },
					compat: { supportsDeveloperRole: false },
					models: [
						{
							id: "old-model",
							name: "Old model",
							thinkingLevelMap: { high: "deep" },
							compat: { maxTokensField: "max_completion_tokens" },
						},
					],
				},
			},
		};

		const merged = mergeModelsConfig(current, [
			{
				id: "renamed",
				sourceId: "custom",
				name: "New name",
				models: [
					{
						id: "new-model",
						sourceId: "old-model",
						name: "New model",
						maxTokens: 8192,
					},
				],
			},
		]);

		expect(merged).toEqual({
			version: 2,
			providers: {
				renamed: {
					name: "New name",
					apiKey: "stored-secret",
					headers: { "x-tenant": "tenant-a" },
					compat: { supportsDeveloperRole: false },
					models: [
						{
							id: "new-model",
							name: "New model",
							maxTokens: 8192,
							thinkingLevelMap: { high: "deep" },
							compat: { maxTokensField: "max_completion_tokens" },
						},
					],
				},
			},
		});
	});

	it("removes cleared editable fields and intentionally deleted entries", () => {
		const current: ModelsJson = {
			providers: {
				keep: { name: "Old", baseUrl: "https://old.example", models: [{ id: "old", name: "Old" }] },
				remove: { apiKey: "secret" },
			},
		};

		const merged = mergeModelsConfig(current, [{ id: "keep", sourceId: "keep", models: [] }]);

		expect(merged).toEqual({ providers: { keep: { models: [] } } });
	});
});
