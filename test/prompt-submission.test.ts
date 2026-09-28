import { describe, expect, it, vi } from "vitest";
import { startPromptSubmission } from "../src/main/prompt-submission.ts";

describe("Pi prompt acceptance", () => {
	it("acknowledges accepted input while the run is still executing", async () => {
		let finish!: () => void;
		const running = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const submission = startPromptSubmission(async (preflight) => {
			preflight(true);
			await running;
		});
		const complete = vi.fn();
		void submission.completed.then(complete);
		await submission.accepted;
		expect(complete).not.toHaveBeenCalled();
		finish();
		await submission.completed;
		expect(complete).toHaveBeenCalledOnce();
	});

	it("rejects acceptance with the original preflight error so the draft can be retained", async () => {
		const failure = new Error("Missing model credentials");
		const submission = startPromptSubmission(async (preflight) => {
			preflight(false);
			throw failure;
		});
		await Promise.all([
			expect(submission.accepted).rejects.toBe(failure),
			expect(submission.completed).rejects.toBe(failure),
		]);
	});

	it("reports a later execution failure without retracting accepted input", async () => {
		let fail!: (error: Error) => void;
		const running = new Promise<void>((_resolve, reject) => {
			fail = reject;
		});
		const submission = startPromptSubmission(async (preflight) => {
			preflight(true);
			await running;
		});
		const completion = expect(submission.completed).rejects.toThrow("Disconnected");
		await expect(submission.accepted).resolves.toBeUndefined();
		fail(new Error("Disconnected"));
		await completion;
	});

	it("also accepts an extension command that completes without a preflight callback", async () => {
		const submission = startPromptSubmission(async () => {});
		await Promise.all([submission.accepted, submission.completed]);
	});
});
