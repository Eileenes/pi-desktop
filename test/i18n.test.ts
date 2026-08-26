import { describe, expect, it } from "vitest";
import { translate } from "../src/renderer/i18n.ts";

describe("renderer translations", () => {
	it("provides both supported languages for every public key", () => {
		const keys = [
			"newChat",
			"sessions",
			"models",
			"skills",
			"plugins",
			"sourceControl",
			"settings",
			"recentProjects",
			"welcomeTitle",
			"welcomeBody",
			"openFiles",
			"openPreview",
			"selectModel",
			"addImage",
			"languageName",
		] as const;
		for (const key of keys) {
			expect(translate("zh-CN", key).trim()).not.toBe("");
			expect(translate("en", key).trim()).not.toBe("");
		}
	});
});
