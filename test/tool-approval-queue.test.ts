import { describe, expect, it, vi } from "vitest";
import { ToolApprovalQueue } from "../src/main/tool-approval-queue.ts";

describe("ToolApprovalQueue", () => {
	it("publishes a pending approval and resolves the explicit decision", async () => {
		const onChange = vi.fn();
		const queue = new ToolApprovalQueue({ createId: () => "approval-1", now: () => 42, onChange });
		const decision = queue.request({
			toolCallId: "call-1",
			toolName: "read",
			input: { path: "README.md" },
		});

		expect(queue.getPendingApprovals()).toEqual([
			{
				id: "approval-1",
				toolCallId: "call-1",
				toolName: "read",
				input: { path: "README.md" },
				requestedAt: 42,
			},
		]);
		expect(queue.resolve("approval-1", true)).toBe(true);
		await expect(decision).resolves.toBe(true);
		expect(queue.getPendingApprovals()).toEqual([]);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("rejects pending calls when a session is disposed", async () => {
		const queue = new ToolApprovalQueue({ createId: () => "approval-2" });
		const decision = queue.request({ toolCallId: "call-2", toolName: "bash", input: { command: "pwd" } });

		queue.cancelAll();

		await expect(decision).resolves.toBe(false);
		expect(queue.resolve("approval-2", true)).toBe(false);
	});

	it("denies approvals that outlive the approval window", async () => {
		vi.useFakeTimers();
		try {
			const queue = new ToolApprovalQueue({ createId: () => "approval-3", timeoutMs: 10 });
			const decision = queue.request({ toolCallId: "call-3", toolName: "write", input: { path: "note.txt" } });

			await vi.advanceTimersByTimeAsync(10);

			await expect(decision).resolves.toBe(false);
			expect(queue.getPendingApprovals()).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});
