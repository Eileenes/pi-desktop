import { memo, useCallback, useMemo } from "react";
import { type BranchNode, buildBranchTree } from "../shared/branch-tree.ts";
import type { DesktopSessionTreeNode } from "../shared/contracts.ts";
import { NATIVE_TOOLBAR_ACTIVE, NATIVE_TOOLBAR_BUTTON } from "./chrome-classes.ts";
import { useI18n } from "./i18n.ts";
import { Icon } from "./icons.tsx";
import { Button } from "./ui/button.tsx";

interface BranchNavigatorProps {
	tree: DesktopSessionTreeNode[];
	activeLeafId?: string | null;
	hasSession: boolean;
	onLeafChange: (entryId: string) => void;
	onFork: () => void;
	open: boolean;
	onToggle: () => void;
}

function buildActivePath(nodes: BranchNode[], targetId: string | null | undefined): Set<string> {
	if (!targetId) return new Set();
	function search(items: BranchNode[], path: string[]): string[] | undefined {
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

function compress(node: BranchNode): { node: BranchNode; skipped: number } {
	let current = node;
	let skipped = 0;
	while (current.children.length === 1) {
		current = current.children[0];
		skipped += 1;
	}
	return { node: current, skipped };
}

function hasBranch(nodes: BranchNode[]): boolean {
	return nodes.some((node) => node.children.length > 1 || hasBranch(node.children));
}

function labelFor(node: BranchNode): string {
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
	node: BranchNode;
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
			<Button
				variant="bare"
				className="relative flex w-full min-h-[26px] items-center rounded-[var(--radius-2xs)] border-0 bg-transparent px-2 py-[3px] text-left text-[length:var(--text-xs)] text-[color:var(--text-dim)] hover:bg-[var(--hover)] hover:text-[color:var(--text)] focus-visible:bg-[var(--hover)] focus-visible:text-[color:var(--text)]"
				onClick={() => onSelect(representative.entry.id)}
			>
				<span className="inline-flex min-w-4 self-stretch" aria-hidden="true">
					{parentLines.map((hasLine, index) => (
						<span
							className={`relative block w-4 ${hasLine ? "after:absolute after:inset-y-0 after:left-[7px] after:w-px after:bg-[var(--border-subtle)] after:content-['']" : ""}`}
							key={`${index}-${hasLine}`}
						/>
					))}
					<span
						className={`relative w-4 before:absolute before:top-1/2 before:left-[7px] before:h-px before:w-2.5 before:bg-[var(--border-subtle)] before:content-[''] after:absolute after:left-[7px] after:w-px after:bg-[var(--border-subtle)] after:content-[''] ${isLast ? "after:top-0 after:bottom-1/2" : "after:inset-y-0"}`}
					/>
				</span>
				<span
					className={`mr-1.5 size-[7px] shrink-0 rounded-full border ${isActive ? "border-[var(--accent)] bg-[var(--accent)]" : isOnPath ? "border-[var(--text-dim)] bg-[var(--text-muted)]" : "border-[var(--text-dim)] bg-transparent"}`}
				/>
				{role === "user" || role === "assistant" ? (
					<span
						className={`mr-[5px] rounded-[var(--radius-3xs)] border px-1 font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] leading-4 ${role === "user" ? "border-[color-mix(in_srgb,var(--accent)_35%,var(--border-subtle))] text-[color:var(--accent)]" : "border-[var(--border-subtle)] text-[color:var(--muted)]"}`}
					>
						{role === "user" ? "U" : "A"}
					</span>
				) : null}
				{compressed.skipped > 0 ? (
					<span className="mr-[5px] text-[length:var(--text-2xs)] text-[color:var(--muted)]">
						+{compressed.skipped}
					</span>
				) : null}
				<span
					className={`min-w-0 truncate ${isActive ? "font-medium text-[color:var(--text)]" : isOnPath ? "text-[color:var(--text-muted)]" : ""}`}
				>
					{labelFor(representative)}
				</span>
			</Button>
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
	const nodes = useMemo(() => buildBranchTree(tree), [tree]);
	const activePath = useMemo(() => buildActivePath(nodes, activeLeafId), [nodes, activeLeafId]);
	const first = nodes[0] ? compress(nodes[0]).node : undefined;
	const hasContent = hasSession && first !== undefined && (first.children.length > 1 || hasBranch(nodes));
	const reason = !hasSession ? t("noActiveSession") : t("noBranchesYet");
	const select = useCallback((entryId: string) => onLeafChange(entryId), [onLeafChange]);

	return (
		<div className="relative">
			<Button
				size="sm"
				className={`${NATIVE_TOOLBAR_BUTTON} ${open ? NATIVE_TOOLBAR_ACTIVE : ""}`}
				aria-label={t("branches")}
				title={t("branches")}
				disabled={!hasContent || !hasSession}
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={onToggle}
			>
				<Icon name="branch" size={12} />
				<span>{t("branches")}</span>
			</Button>
			{open ? (
				<div
					className="absolute top-full right-0 left-0 z-40 min-w-[280px] max-h-[min(70vh,680px)] overflow-hidden rounded-[var(--radius-m)] border border-[var(--border-subtle)] bg-[var(--surface-2)] shadow-[var(--shadow-float)]"
					role="menu"
					aria-label={t("branches")}
				>
					<div className="flex items-baseline justify-between gap-4 border-b border-[var(--border-subtle)] px-4 pt-3.5 pb-2.5 [&>strong]:text-[length:var(--text-sm)] [&>strong]:font-semibold [&>strong]:text-[color:var(--text)] [&>small]:text-[length:var(--text-xs)] [&>small]:text-[color:var(--muted)]">
						<strong>{t("sessionBranchTree")}</strong>
						<small>{t("branchTreeHint")}</small>
					</div>
					<div className="grid max-h-[min(56vh,540px)] overflow-auto px-3.5 py-2.5">
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
							<p className="m-0 p-2.5 text-[length:var(--text-xs)] text-[color:var(--muted)] italic">{reason}</p>
						)}
					</div>
					<div className="border-t border-[var(--border-subtle)] px-2.5 py-1.5">
						<Button size="sm" variant="outline" type="button" onClick={onFork}>
							{t("forkAsSession")}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
});
