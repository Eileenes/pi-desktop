import type { DesktopSessionTreeNode } from "./contracts.ts";

/** The nested shape the branch navigator renders. */
export interface BranchNode {
	entry: DesktopSessionTreeNode["entry"];
	children: BranchNode[];
}

/**
 * Rebuilds the branch tree from the pre-order list the host sends: a node's
 * parent is the closest preceding node one level shallower.
 *
 * The tree crosses the IPC bridge flat on purpose. Sending it nested broke long
 * sessions outright — a few hundred entries nest deeper than the Electron
 * bridge allows, and the whole snapshot stopped crossing it — so the nesting
 * happens here, where depth costs nothing.
 */
export function buildBranchTree(flat: DesktopSessionTreeNode[]): BranchNode[] {
	const roots: BranchNode[] = [];
	const lastAtDepth: BranchNode[] = [];
	for (const item of flat) {
		const node: BranchNode = { entry: item.entry, children: [] };
		const parent = item.depth > 0 ? lastAtDepth[item.depth - 1] : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
		lastAtDepth[item.depth] = node;
		lastAtDepth.length = item.depth + 1;
	}
	return roots;
}
