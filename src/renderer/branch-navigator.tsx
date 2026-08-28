import { memo, useCallback, useMemo } from "react";
import type { DesktopSessionTreeNode } from "../shared/contracts.ts";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";

interface BranchNavigatorProps {
	tree: DesktopSessionTreeNode[];
	activeLeafId?: string | null;
	hasSession: boolean;
	onLeafChange: (entryId: string) => void;
	onFork: () => void;
	open: boolean;
	onToggle: () => void;
}

function buildActivePath(nodes: DesktopSessionTreeNode[], targetId: string | null | undefined): Set<string> {
	if (!targetId) return new Set();
	function search(items: DesktopSessionTreeNode[], path: string[]): string[] | undefined {
		for (const node of items) {
			const next = [...path, node.entry.id];
			if (node.entry.id === targetId) return next;
			const found = search(node.children, next);
			if (found) return found;
		}
		return undefined;
	}
	return new Set(search(nodes, []) ?? []);
}

function compress(node: DesktopSessionTreeNode): { node: DesktopSessionTreeNode; skipped: number } {
	let current = node;
	let skipped = 0;
	while (current.children.length === 1) {
		current = current.children[0];
		skipped += 1;
	}
	return { node: current, skipped };
}

function hasBranch(nodes: DesktopSessionTreeNode[]): boolean {
	return nodes.some((node) => node.children.length > 1 || hasBranch(node.children));
}

function labelFor(node: DesktopSessionTreeNode): string {
	if (node.entry.text) return node.entry.text;
	if (node.entry.type === "message" && node.entry.role === "assistant") return "[assistant]";
	return node.entry.type.replace(/_/gu, " ");
}

function TreeNodeView({
	node,
	activePath,
	depth,
	isLast,
	parentLines,
	onSelect,
}: {
	node: DesktopSessionTreeNode;
	activePath: Set<string>;
	depth: number;
	isLast: boolean;
	parentLines: boolean[];
	onSelect: (entryId: string) => void;
}) {
	const compressed = compress(node);
	const representative = compressed.node;
	const isActive = activePath.has(representative.entry.id);
	const isOnPath = activePath.has(node.entry.id) || isActive;
	const role = representative.entry.role;
	return (
		<div>
			<button
				className={`branch-tree-node ${isActive ? "is-active" : ""}`}
				type="button"
				onClick={() => onSelect(representative.entry.id)}
			>
				<span className="branch-tree-guides" aria-hidden="true">
					{parentLines.map((hasLine, index) => (
						<span className={hasLine ? "is-line" : ""} key={`${index}-${hasLine}`} />
					))}
					<span className={`branch-tree-connector ${isLast ? "is-last" : ""}`} />
				</span>
				<span className={`branch-tree-dot ${isActive ? "is-active" : isOnPath ? "is-path" : ""}`} />
				{role === "user" || role === "assistant" ? (
					<span className={`branch-tree-role ${role === "user" ? "is-user" : ""}`}>
						{role === "user" ? "U" : "A"}
					</span>
				) : null}
				{compressed.skipped > 0 ? <span className="branch-tree-skipped">+{compressed.skipped}</span> : null}
				<span className={`branch-tree-label ${isActive ? "is-active" : isOnPath ? "is-path" : ""}`}>
					{labelFor(representative)}
				</span>
			</button>
			{representative.children.map((child, index) => (
				<TreeNodeView
					key={child.entry.id}
					node={child}
					activePath={activePath}
					depth={depth + 1}
					isLast={index === representative.children.length - 1}
					parentLines={[...parentLines, !isLast]}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

export const BranchNavigator = memo(function BranchNavigator({
	tree,
	activeLeafId,
	hasSession,
	onLeafChange,
	onFork,
	open,
	onToggle,
}: BranchNavigatorProps) {
	const { t } = useI18n();
	const activePath = useMemo(() => buildActivePath(tree, activeLeafId), [tree, activeLeafId]);
	const first = tree[0] ? compress(tree[0]).node : undefined;
	const hasContent = hasSession && first !== undefined && (first.children.length > 1 || hasBranch(tree));
	const reason = !hasSession ? t("noActiveSession") : t("noBranchesYet");
	const select = useCallback((entryId: string) => onLeafChange(entryId), [onLeafChange]);

	return (
		<div className="branch-navigator">
			<button
				className={`native-toolbar-button ${open ? "is-active" : ""}`}
				type="button"
				disabled={!hasContent || !hasSession}
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={onToggle}
			>
				<Icon name="branch" size={12} />
				<span>{t("branches")}</span>
			</button>
			{open ? (
				<div className="branch-popover" role="menu" aria-label={t("branches")}>
					<div className="branch-popover-header">
						<strong>{t("sessionBranchTree")}</strong>
						<small>{t("branchTreeHint")}</small>
					</div>
					<div className="branch-list">
						{hasContent && first ? (
							(first.children.length > 1 ? first.children : [first]).map((node, index, nodes) => (
								<TreeNodeView
									key={node.entry.id}
									node={node}
									activePath={activePath}
									depth={0}
									isLast={index === nodes.length - 1}
									parentLines={[]}
									onSelect={select}
								/>
							))
						) : (
							<p className="branch-tree-empty">{reason}</p>
						)}
					</div>
					<div className="branch-popover-footer">
						<button type="button" onClick={onFork}>
							{t("forkAsSession")}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
});
