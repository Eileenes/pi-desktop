import { describe, expect, it } from "vitest";
import { buildConversationTurns, partitionTranscript, splitAssistantBlocks } from "../src/renderer/transcript-group.ts";
import type { DesktopTranscriptMessage } from "../src/shared/contracts.ts";

function message(
	partial: Pick<DesktopTranscriptMessage, "id" | "role"> & Partial<DesktopTranscriptMessage>,
): DesktopTranscriptMessage {
	return { text: "", ...partial };
}

describe("splitAssistantBlocks", () => {
	it("keeps text-only blocks as the answer", () => {
		expect(splitAssistantBlocks([{ type: "text", text: "done" }])).toEqual({
			process: [],
			answer: [{ type: "text", text: "done" }],
		});
	});

	it("splits thinking and tool calls from the trailing answer", () => {
		const blocks = [
			{ type: "thinking" as const, text: "plan" },
			{ type: "toolCall" as const, id: "1", name: "read", input: "{}" },
			{ type: "text" as const, text: "here" },
		];
		expect(splitAssistantBlocks(blocks)).toEqual({
			process: blocks.slice(0, 2),
			answer: [blocks[2]],
		});
	});
});

describe("partitionTranscript", () => {
	it("renders a user and plain assistant turn without a process group", () => {
		const items = partitionTranscript([
			message({ id: "u1", role: "user", text: "hi" }),
			message({ id: "a1", role: "assistant", text: "hello" }),
		]);
		expect(items.map((item) => item.type)).toEqual(["user", "assistant"]);
	});

	it("groups thinking and tool results ahead of the final answer", () => {
		const items = partitionTranscript([
			message({ id: "u1", role: "user", text: "inspect" }),
			message({
				id: "a1",
				role: "assistant",
				text: "ok",
				blocks: [
					{ type: "thinking", text: "look" },
					{ type: "toolCall", id: "t1", name: "read", input: "{}" },
					{ type: "text", text: "ok" },
				],
			}),
			message({ id: "tool1", role: "tool", text: "file contents", toolName: "read" }),
		]);
		expect(items.map((item) => item.type)).toEqual(["user", "process", "assistant"]);
		const process = items[1];
		if (process.type !== "process") throw new Error("expected process");
		expect(process.toolCallCount).toBeGreaterThan(0);
		expect(process.messageCount).toBeGreaterThan(0);
		const assistant = items[2];
		if (assistant.type !== "assistant") throw new Error("expected assistant");
		expect(assistant.message.blocks).toEqual([{ type: "text", text: "ok" }]);
	});

	it("keeps a tool result that arrives before the assistant answer in the process group", () => {
		const items = partitionTranscript([
			message({ id: "u1", role: "user", text: "run" }),
			message({ id: "tool1", role: "tool", text: "out", toolName: "bash" }),
			message({ id: "a1", role: "assistant", text: "done" }),
		]);
		expect(items.map((item) => item.type)).toEqual(["user", "process", "assistant"]);
	});

	it("reports the elapsed process duration from the user prompt to the answer", () => {
		const items = partitionTranscript([
			message({ id: "u1", role: "user", text: "run", timestamp: 1_000 }),
			message({ id: "tool1", role: "tool", text: "out", toolName: "bash", timestamp: 2_000 }),
			message({ id: "a1", role: "assistant", text: "done", timestamp: 3_500 }),
		]);
		const process = items[1];
		if (process.type !== "process") throw new Error("expected process");
		expect(process.durationMs).toBe(2_500);
	});
});

describe("buildConversationTurns", () => {
	it("pairs each user message with the last assistant answer before the next user", () => {
		const turns = buildConversationTurns([
			message({ id: "u1", role: "user", text: "one" }),
			message({ id: "a1", role: "assistant", text: "first" }),
			message({ id: "u2", role: "user", text: "two" }),
			message({ id: "a2", role: "assistant", text: "second" }),
		]);
		expect(turns).toEqual([
			{ messageId: "u1", question: "one", answer: "first" },
			{ messageId: "u2", question: "two", answer: "second" },
		]);
	});
});
