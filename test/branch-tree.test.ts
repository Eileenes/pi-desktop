import { describe, expect, it } from "vitest";
import { buildBranchTree } from "../src/shared/branch-tree.ts";
import type { DesktopSessionTreeNode } from "../src/shared/contracts.ts";

function node(id: string, depth: number): DesktopSessionTreeNode {
	return { entry: { id, type: "message" }, depth };
}

function ids(nodes: ReturnType<typeof buildBranchTree>): string[] {
	return nodes.map((item) => item.entry.id);
}

describe("buildBranchTree", () => {
	it("rebuilds a chain in order", () => {
		const tree = buildBranchTree([node("a", 0), node("b", 1), node("c", 2)]);
		expect(ids(tree)).toEqual(["a"]);
		expect(ids(tree[0].children)).toEqual(["b"]);
		expect(ids(tree[0].children[0].children)).toEqual(["c"]);
	});

	it("attaches siblings to the closest shallower node", () => {
		const tree = buildBranchTree([
			node("root", 0),
			node("left", 1),
			node("left-child", 2),
			node("right", 1),
			node("right-child", 2),
		]);
		expect(ids(tree)).toEqual(["root"]);
		expect(ids(tree[0].children)).toEqual(["left", "right"]);
		expect(ids(tree[0].children[0].children)).toEqual(["left-child"]);
		expect(ids(tree[0].children[1].children)).toEqual(["right-child"]);
	});

	it("survives the depth a long session produces", () => {
		const flat = Array.from({ length: 2_000 }, (_item, index) => node(`n${index}`, index));
		let depth = 0;
		let current = buildBranchTree(flat);
		while (current.length > 0) {
			depth += 1;
			current = current[0].children;
		}
		expect(depth).toBe(2_000);
	});

	it("starts a new root when a level is missing", () => {
		const tree = buildBranchTree([node("a", 0), node("b", 3)]);
		expect(ids(tree)).toEqual(["a", "b"]);
	});
});
