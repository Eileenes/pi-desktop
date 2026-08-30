import { describe, expect, it } from "vitest";
import {
	formatExtensionStatusLine,
	getComposerThinkingLevels,
	getModelDisplayName,
	getPlainExtensionStatusLine,
	getThinkingDisplayLabel,
} from "../src/renderer/composer-controls.ts";

describe("composer control helpers", () => {
	it("keeps auto available while respecting the selected model's supported levels", () => {
		expect(getComposerThinkingLevels(["off", "low", "high"])).toEqual(["auto", "off", "low", "high"]);
	});

	it("uses the provider's mapped thinking label when one is available", () => {
		expect(getThinkingDisplayLabel("high", { high: "deep" })).toBe("deep");
		expect(getThinkingDisplayLabel("auto", { high: "deep" })).toBe("auto");
	});

	it("uses a configured display name for the selected model", () => {
		expect(
			getModelDisplayName([{ provider: "anthropic", id: "claude", name: "Claude Sonnet", supportsImages: true }], {
				provider: "anthropic",
				id: "claude",
			}),
		).toBe("Claude Sonnet");
	});

	it("sorts, compacts, and strips decoration from extension statuses", () => {
		const line = formatExtensionStatusLine([
			{ key: "zeta", text: "● Ready" },
			{ key: "alpha", text: "\u001b[32m• Connected\u001b[0m" },
		]);
		expect(getPlainExtensionStatusLine(line)).toBe("Connected Ready");
	});
});
