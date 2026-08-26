import { describe, expect, it } from "vitest";
import { isNewerVersion } from "../src/shared/version.ts";

describe("isNewerVersion", () => {
	it("only reports versions newer than the installed version", () => {
		expect(isNewerVersion("0.85.0", "0.84.3")).toBe(true);
		expect(isNewerVersion("0.84.3", "0.84.3")).toBe(false);
		expect(isNewerVersion("0.84.2", "0.84.3")).toBe(false);
	});

	it("orders stable releases after prereleases", () => {
		expect(isNewerVersion("0.85.0", "0.85.0-beta.1")).toBe(true);
		expect(isNewerVersion("0.85.0-beta.1", "0.85.0")).toBe(false);
	});
});
