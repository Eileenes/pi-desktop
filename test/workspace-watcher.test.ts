import { describe, expect, it } from "vitest";
import { normalizeWorkspaceChangePath } from "../src/main/workspace-watcher.ts";

describe("normalizeWorkspaceChangePath", () => {
	it("keeps fs.watch relative filenames relative to the workspace", () => {
		expect(normalizeWorkspaceChangePath("src/app.tsx")).toBe("src/app.tsx");
		expect(normalizeWorkspaceChangePath(".\\src\\app.tsx")).toBe("src/app.tsx");
	});

	it("rejects absolute and parent-traversal paths", () => {
		expect(normalizeWorkspaceChangePath("/tmp/outside.ts")).toBeUndefined();
		expect(normalizeWorkspaceChangePath("C:\\tmp\\outside.ts")).toBeUndefined();
		expect(normalizeWorkspaceChangePath("../outside.ts")).toBeUndefined();
	});
});
