import type { DesktopTranscriptBlock, DesktopTranscriptMessage } from "../shared/contracts.ts";

export type TranscriptRenderItem =
	| { type: "user"; message: DesktopTranscriptMessage }
	| { type: "assistant"; message: DesktopTranscriptMessage }
	| {
			type: "process";
			blocks: DesktopTranscriptBlock[];
			messages: DesktopTranscriptMessage[];
			messageCount: number;
			toolCallCount: number;
			durationMs?: number;
	  };

export interface ConversationTurn {
	messageId: string;
	question: string;
	answer: string;
}

export function splitAssistantBlocks(blocks: DesktopTranscriptBlock[]): {
	process: DesktopTranscriptBlock[];
	answer: DesktopTranscriptBlock[];
} {
	let lastProcess = -1;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (block?.type === "thinking" || block?.type === "toolCall") {
			lastProcess = index;
			break;
		}
	}
	if (lastProcess < 0) return { process: [], answer: blocks };
	return {
		process: blocks.slice(0, lastProcess + 1),
		answer: blocks.slice(lastProcess + 1),
	};
}

function countToolCalls(blocks: DesktopTranscriptBlock[], messages: DesktopTranscriptMessage[]): number {
	let count = 0;
	for (const block of blocks) if (block.type === "toolCall") count += 1;
	for (const message of messages) {
		if (message.role === "tool" || message.command) count += 1;
		for (const block of message.blocks ?? []) if (block.type === "toolCall") count += 1;
	}
	return count;
}

function toProcessItem(
	messages: DesktopTranscriptMessage[],
	blocks: DesktopTranscriptBlock[],
	turnStartedAt?: number,
	answerTimestamp?: number,
): TranscriptRenderItem {
	const timestamps = messages.flatMap((message) => (message.timestamp === undefined ? [] : [message.timestamp]));
	const completedAt = answerTimestamp ?? timestamps.at(-1);
	const startedAt = turnStartedAt ?? timestamps[0];
	const durationMs =
		startedAt !== undefined && completedAt !== undefined ? Math.max(0, completedAt - startedAt) : undefined;
	return {
		type: "process",
		blocks,
		messages,
		messageCount: Math.max(1, messages.length + (blocks.length > 0 ? 1 : 0)),
		toolCallCount: countToolCalls(blocks, messages),
		...(durationMs !== undefined ? { durationMs } : {}),
	};
}

export function partitionTranscript(messages: DesktopTranscriptMessage[]): TranscriptRenderItem[] {
	const items: TranscriptRenderItem[] = [];
	let index = 0;
	let turnStartedAt: number | undefined;
	while (index < messages.length) {
		const current = messages[index];
		if (!current) break;
		if (current.role === "user") {
			items.push({ type: "user", message: current });
			turnStartedAt = current.timestamp;
			index += 1;
			continue;
		}

		const slice: DesktopTranscriptMessage[] = [];
		while (index < messages.length && messages[index]?.role !== "user") {
			const entry = messages[index];
			if (entry) slice.push(entry);
			index += 1;
		}

		let answerIndex = -1;
		for (let cursor = slice.length - 1; cursor >= 0; cursor -= 1) {
			const entry = slice[cursor];
			if (entry?.role !== "assistant") continue;
			const split = splitAssistantBlocks(entry.blocks ?? []);
			if (split.answer.length > 0 || entry.text.trim().length > 0) {
				answerIndex = cursor;
				break;
			}
		}

		if (answerIndex < 0) {
			if (slice.length > 0) items.push(toProcessItem(slice, [], turnStartedAt));
			continue;
		}

		const answerMessage = slice[answerIndex];
		if (!answerMessage) continue;
		const split = splitAssistantBlocks(answerMessage.blocks ?? []);
		const processMessages = slice.filter((_, cursor) => cursor !== answerIndex);
		if (split.process.length > 0 || processMessages.length > 0) {
			items.push(toProcessItem(processMessages, split.process, turnStartedAt, answerMessage.timestamp));
		}
		items.push({
			type: "assistant",
			message: { ...answerMessage, blocks: split.answer.length > 0 ? split.answer : undefined },
		});
	}
	return items;
}

export function buildConversationTurns(messages: DesktopTranscriptMessage[]): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		let answer = "";
		for (let next = index + 1; next < messages.length; next += 1) {
			const candidate = messages[next];
			if (!candidate || candidate.role === "user") break;
			if (candidate.role === "assistant" && candidate.text.trim()) answer = candidate.text;
		}
		turns.push({
			messageId: message.id,
			question: message.text.trim(),
			answer: answer.trim(),
		});
	}
	return turns;
}
