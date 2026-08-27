import { describe, expect, it } from "vitest";
import { resolveWorkspaceFileHref } from "../src/renderer/file-links.ts";

describe("resolveWorkspaceFileHref", () => {
	it("recognizes relative and absolute local file links", () => {
		expect(resolveWorkspaceFileHref("src/renderer/app.tsx:42", "/project")).toBe("src/renderer/app.tsx");
		expect(resolveWorkspaceFileHref("/project/src/main.ts:2:8", "/project")).toBe("/project/src/main.ts");
	});

	it("rejects external, anchor, and protocol-relative links", () => {
		expect(resolveWorkspaceFileHref("https://example.com/file.ts", "/project")).toBeUndefined();
		expect(resolveWorkspaceFileHref("#section", "/project")).toBeUndefined();
		expect(resolveWorkspaceFileHref("//example.com/file.ts", "/project")).toBeUndefined();
	});
});
