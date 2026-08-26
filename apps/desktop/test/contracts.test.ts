import { describe, expect, it } from "vitest";
import {
	isDesktopAuthenticationPromptResponseInput,
	isDesktopModelSelectionInput,
	isDesktopProjectTrustInput,
	isDesktopPromptInput,
	isDesktopProviderSetupInput,
	isDesktopToolApprovalDecisionInput,
	isDesktopWorkspaceFileInput,
} from "../src/shared/contracts.ts";

describe("isDesktopPromptInput", () => {
	it("accepts text with optional selected image ids", () => {
		expect(isDesktopPromptInput({ text: "Inspect this project" })).toBe(true);
		expect(isDesktopPromptInput({ text: "", attachmentIds: ["image-1"] })).toBe(true);
	});

	it("rejects extra or invalid fields", () => {
		expect(isDesktopPromptInput({ text: "Inspect this project", cwd: "/tmp" })).toBe(false);
		expect(isDesktopPromptInput({ text: "Inspect", attachmentIds: [42] })).toBe(false);
		expect(isDesktopPromptInput({ text: "Inspect", attachmentIds: Array.from({ length: 6 }, () => "image") })).toBe(
			false,
		);
		expect(isDesktopPromptInput({ text: 42 })).toBe(false);
		expect(isDesktopPromptInput(null)).toBe(false);
	});
});

describe("isDesktopModelSelectionInput", () => {
	it("accepts an available model reference", () => {
		expect(isDesktopModelSelectionInput({ provider: "anthropic", modelId: "claude-sonnet-4-5" })).toBe(true);
	});

	it("rejects malformed or extra model references", () => {
		expect(isDesktopModelSelectionInput({ provider: "", modelId: "model" })).toBe(false);
		expect(isDesktopModelSelectionInput({ provider: "anthropic", modelId: "", persist: true })).toBe(false);
	});
});

describe("isDesktopProjectTrustInput", () => {
	it("accepts an exact trust payload", () => {
		expect(isDesktopProjectTrustInput({ trusted: true })).toBe(true);
	});

	it("rejects extra or invalid fields", () => {
		expect(isDesktopProjectTrustInput({ trusted: true, workspace: "/tmp" })).toBe(false);
		expect(isDesktopProjectTrustInput({ trusted: "yes" })).toBe(false);
	});
});

describe("isDesktopToolApprovalDecisionInput", () => {
	it("accepts a one-time decision", () => {
		expect(isDesktopToolApprovalDecisionInput({ id: "approval-1", approved: false })).toBe(true);
	});

	it("requires an id and an explicit boolean decision", () => {
		expect(isDesktopToolApprovalDecisionInput({ id: "", approved: true })).toBe(false);
		expect(isDesktopToolApprovalDecisionInput({ id: "approval-1", approved: 1 })).toBe(false);
		expect(isDesktopToolApprovalDecisionInput({ id: "approval-1" })).toBe(false);
	});
});

describe("isDesktopProviderSetupInput", () => {
	it("accepts an exact provider setup payload", () => {
		expect(isDesktopProviderSetupInput({ providerId: "anthropic" })).toBe(true);
	});

	it("rejects malformed, oversized, and extra fields", () => {
		expect(isDesktopProviderSetupInput({ providerId: "" })).toBe(false);
		expect(isDesktopProviderSetupInput({ providerId: "anthropic", persist: true })).toBe(false);
		expect(isDesktopProviderSetupInput({ providerId: "x".repeat(201) })).toBe(false);
	});
});

describe("isDesktopAuthenticationPromptResponseInput", () => {
	it("accepts an empty response for prompts that use Enter to continue", () => {
		expect(isDesktopAuthenticationPromptResponseInput({ id: "auth-1", response: "" })).toBe(true);
	});

	it("rejects malformed and oversized responses", () => {
		expect(isDesktopAuthenticationPromptResponseInput({ id: "", response: "value" })).toBe(false);
		expect(isDesktopAuthenticationPromptResponseInput({ id: "auth-1", response: 42 })).toBe(false);
		expect(isDesktopAuthenticationPromptResponseInput({ id: "auth-1", response: "x".repeat(10_001) })).toBe(false);
		expect(isDesktopAuthenticationPromptResponseInput({ id: "auth-1", response: "value", extra: true })).toBe(false);
	});
});

describe("isDesktopWorkspaceFileInput", () => {
	it("accepts a relative workspace file path", () => {
		expect(isDesktopWorkspaceFileInput({ path: "src/main.ts" })).toBe(true);
	});

	it("rejects absolute, parent-traversal, and malformed paths", () => {
		expect(isDesktopWorkspaceFileInput({ path: "/private/file" })).toBe(false);
		expect(isDesktopWorkspaceFileInput({ path: "../private/file" })).toBe(false);
		expect(isDesktopWorkspaceFileInput({ path: "src\\main.ts" })).toBe(false);
		expect(isDesktopWorkspaceFileInput({ path: "src/main.ts", extra: true })).toBe(false);
	});
});
