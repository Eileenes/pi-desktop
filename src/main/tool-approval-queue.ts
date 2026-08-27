import { randomUUID } from "node:crypto";
import type { DesktopToolApproval } from "../shared/contracts.ts";

interface PendingToolApproval {
	approval: DesktopToolApproval;
	groupKey: string | undefined;
	resolve: (approved: boolean) => void;
	timeout: ReturnType<typeof setTimeout>;
}

export interface ToolApprovalQueueOptions {
	onChange?: () => void;
	createId?: () => string;
	now?: () => number;
	timeoutMs?: number;
}

export class ToolApprovalQueue {
	private readonly createId: () => string;
	private readonly now: () => number;
	private readonly onChange: (() => void) | undefined;
	private readonly timeoutMs: number;
	private readonly pending = new Map<string, PendingToolApproval>();

	constructor(options: ToolApprovalQueueOptions = {}) {
		this.createId = options.createId ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.onChange = options.onChange;
		this.timeoutMs = options.timeoutMs ?? 120_000;
	}

	getPendingApprovals(): DesktopToolApproval[] {
		return Array.from(this.pending.values(), (pending) => pending.approval);
	}

	request(input: Omit<DesktopToolApproval, "id" | "requestedAt">, groupKey?: string): Promise<boolean> {
		const approval: DesktopToolApproval = {
			...input,
			id: this.createId(),
			requestedAt: this.now(),
		};

		return new Promise((resolve) => {
			const timeout = setTimeout(() => this.resolve(approval.id, false), this.timeoutMs);
			this.pending.set(approval.id, { approval, groupKey, resolve, timeout });
			this.onChange?.();
		});
	}

	resolve(id: string, approved: boolean): boolean {
		const pending = this.pending.get(id);
		if (!pending) return false;

		clearTimeout(pending.timeout);
		this.pending.delete(id);
		pending.resolve(approved);
		this.onChange?.();
		return true;
	}

	cancelAll(): void {
		this.cancelWhere(() => true);
	}

	cancelGroup(groupKey: string): void {
		this.cancelWhere((pending) => pending.groupKey === groupKey);
	}

	private cancelWhere(predicate: (pending: PendingToolApproval) => boolean): void {
		const pendingApprovals = Array.from(this.pending.entries()).filter(([, pending]) => predicate(pending));
		if (pendingApprovals.length === 0) return;

		for (const [id, pending] of pendingApprovals) {
			this.pending.delete(id);
			clearTimeout(pending.timeout);
			pending.resolve(false);
		}
		this.onChange?.();
	}
}
