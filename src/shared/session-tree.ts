import type { DesktopSessionInfo } from "./contracts.ts";

export interface FlattenedSession {
	info: DesktopSessionInfo;
	depth: number;
}

function normalizeSessionPath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function flattenSessionTree(items: DesktopSessionInfo[]): FlattenedSession[] {
	const byPath = new Map(items.map((item) => [normalizeSessionPath(item.path), item]));
	const children = new Map<string, DesktopSessionInfo[]>();
	const childPaths = new Set<string>();
	for (const item of items) {
		if (!item.parentSessionPath) continue;
		const parentPath = normalizeSessionPath(item.parentSessionPath);
		if (!byPath.has(parentPath)) continue;
		const entries = children.get(parentPath) ?? [];
		entries.push(item);
		children.set(parentPath, entries);
		childPaths.add(normalizeSessionPath(item.path));
	}
	for (const entries of children.values()) entries.sort((left, right) => right.modified - left.modified);

	const result: FlattenedSession[] = [];
	const visited = new Set<string>();
	const visit = (item: DesktopSessionInfo, depth: number): void => {
		const path = normalizeSessionPath(item.path);
		if (visited.has(path)) return;
		visited.add(path);
		result.push({ info: item, depth });
		for (const child of children.get(path) ?? []) visit(child, depth + 1);
	};
	for (const root of items.filter((item) => !childPaths.has(normalizeSessionPath(item.path)))) visit(root, 0);
	for (const item of items) visit(item, 0);
	return result;
}
