import { describe, expect, it } from "vitest";
import { type ModelsJson, mergeModelsConfig } from "../src/main/models-config-store.ts";

describe("mergeModelsConfig", () => {
	it("preserves provider-level advanced fields and unknown model fields across renames", () => {
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
							rates: { currency: "usd" },
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
							rates: { currency: "usd" },
						},
					],
				},
			},
		});
	});

	it("clears editor-managed model fields that the edit omits", () => {
		const current: ModelsJson = {
			providers: {
				custom: {
					models: [
						{
							id: "model",
							name: "Old name",
							thinkingLevelMap: { high: "deep" },
							compat: { maxTokensField: "max_completion_tokens" },
						},
					],
				},
			},
		};

		const merged = mergeModelsConfig(current, [
			{
				id: "custom",
				sourceId: "custom",
				models: [{ id: "model", sourceId: "model", name: "Kept name" }],
			},
		]);

		expect(merged).toEqual({
			providers: {
				custom: {
					models: [{ id: "model", name: "Kept name" }],
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
