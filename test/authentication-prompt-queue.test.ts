import { describe, expect, it, vi } from "vitest";
import { AuthenticationPromptQueue } from "../src/main/authentication-prompt-queue.ts";

describe("AuthenticationPromptQueue", () => {
	it("publishes a prompt and resolves the submitted response", async () => {
		const onChange = vi.fn();
		const queue = new AuthenticationPromptQueue({ createId: () => "auth-1", now: () => 42, onChange });
		const response = queue.request(
			{
				type: "select",
				message: "Choose a region",
				options: [{ id: "us-east-1", label: "US East" }],
			},
			undefined,
		);

		expect(queue.getPendingPrompts()).toEqual([
			{
				id: "auth-1",
				type: "select",
				message: "Choose a region",
				options: [{ id: "us-east-1", label: "US East" }],
				requestedAt: 42,
			},
		]);
		expect(queue.resolve("auth-1", "us-east-1")).toBe(true);
		await expect(response).resolves.toBe("us-east-1");
		expect(queue.getPendingPrompts()).toEqual([]);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("rejects a pending prompt when its signal aborts", async () => {
		const queue = new AuthenticationPromptQueue({ createId: () => "auth-2" });
		const controller = new AbortController();
		const response = queue.request({ type: "secret", message: "Enter a key" }, controller.signal);

		controller.abort();

		await expect(response).rejects.toMatchObject({ name: "AbortError" });
		expect(queue.getPendingPrompts()).toEqual([]);
	});

	it("rejects all pending prompts when the host is disposed", async () => {
		const queue = new AuthenticationPromptQueue({ createId: () => "auth-3" });
		const response = queue.request({ type: "text", message: "Enter a project ID" }, undefined);

		queue.cancelAll();

		await expect(response).rejects.toMatchObject({ name: "AbortError" });
	});
});
