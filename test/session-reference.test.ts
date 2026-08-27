import { describe, expect, it } from "vitest";
import { expandSessionReferences, formatSessionReference } from "../src/shared/session-reference.ts";

describe("formatSessionReference", () => {
	it("quotes labels containing spaces and escapes quotes", () => {
		expect(formatSessionReference("Deploy notes")).toBe('#"Deploy notes"');
		expect(formatSessionReference('The "fix"')).toBe('#"The \\"fix\\""');
		expect(formatSessionReference("Build")).toBe("#Build");
	});
});

describe("expandSessionReferences", () => {
	it("expands exact plain and quoted labels", () => {
		const candidates = [
			{ label: "Build", path: "/sessions/build.jsonl" },
			{ label: "Deploy notes", path: "/sessions/deploy.jsonl" },
		];
		const expanded = expandSessionReferences('Compare #Build with #"Deploy notes"', {
			candidates,
			load: (path) => (path.includes("build") ? "USER: build it" : "ASSISTANT: deploy it"),
		});

		expect(expanded).toContain('<session_reference name="Build" trust="untrusted-history">');
		expect(expanded).toContain('<session_reference name="Deploy notes" trust="untrusted-history">');
	});

	it("leaves unknown and ambiguous labels untouched", () => {
		const text = "See #Unknown and #Duplicate";
		expect(
			expandSessionReferences(text, {
				candidates: [
					{ label: "Duplicate", path: "/one" },
					{ label: "duplicate", path: "/two" },
				],
				load: () => "content",
			}),
		).toBe(text);
	});

	it("enforces the aggregate context limit", () => {
		const expanded = expandSessionReferences("#One #Two", {
			candidates: [
				{ label: "One", path: "/one" },
				{ label: "Two", path: "/two" },
			],
			load: () => "12345",
			maxCharacters: 6,
		});

		expect(expanded).toContain("12345");
		expect(expanded).toContain("\n1\n</session_reference>");
	});
});
