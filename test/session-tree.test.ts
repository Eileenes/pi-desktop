import { describe, expect, it } from "vitest";
import type { DesktopSessionInfo } from "../src/shared/contracts.ts";
import { flattenSessionTree } from "../src/shared/session-tree.ts";

function session(path: string, modified: number, parentSessionPath?: string): DesktopSessionInfo {
	return {
		path,
		id: path,
		cwd: "/project",
		created: modified,
		modified,
		messageCount: 1,
		firstMessage: path,
		...(parentSessionPath ? { parentSessionPath } : {}),
	};
}

describe("flattenSessionTree", () => {
	it("places forked sessions below their parent with stable depth", () => {
		const flattened = flattenSessionTree([
			session("/sessions/root.jsonl", 3),
			session("/sessions/child.jsonl", 2, "/sessions/root.jsonl"),
			session("/sessions/grandchild.jsonl", 1, "/sessions/child.jsonl"),
		]);

		expect(flattened.map(({ info, depth }) => [info.id, depth])).toEqual([
			["/sessions/root.jsonl", 0],
			["/sessions/child.jsonl", 1],
			["/sessions/grandchild.jsonl", 2],
		]);
	});

	it("keeps orphaned and cyclic metadata visible", () => {
		const flattened = flattenSessionTree([
			session("/sessions/orphan.jsonl", 3, "/sessions/missing.jsonl"),
			session("/sessions/a.jsonl", 2, "/sessions/b.jsonl"),
			session("/sessions/b.jsonl", 1, "/sessions/a.jsonl"),
		]);

		expect(new Set(flattened.map(({ info }) => info.id))).toEqual(
			new Set(["/sessions/orphan.jsonl", "/sessions/a.jsonl", "/sessions/b.jsonl"]),
		);
	});
});
