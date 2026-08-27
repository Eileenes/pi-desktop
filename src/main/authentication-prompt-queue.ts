import { randomUUID } from "node:crypto";
import type { DesktopAuthenticationPrompt } from "../shared/contracts.ts";

interface PendingAuthenticationPrompt {
	prompt: DesktopAuthenticationPrompt;
	resolve: (response: string) => void;
	reject: (error: Error) => void;
	signal: AbortSignal | undefined;
	onAbort: (() => void) | undefined;
}

export interface AuthenticationPromptQueueOptions {
	createId?: () => string;
	now?: () => number;
	onChange?: () => void;
}

function createAbortError(): Error {
	const error = new Error("Authentication prompt was cancelled.");
	error.name = "AbortError";
	return error;
}

export class AuthenticationPromptQueue {
	private readonly createId: () => string;
	private readonly now: () => number;
	private readonly onChange: (() => void) | undefined;
	private readonly pending = new Map<string, PendingAuthenticationPrompt>();

	constructor(options: AuthenticationPromptQueueOptions = {}) {
		this.createId = options.createId ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.onChange = options.onChange;
	}

	getPendingPrompts(): DesktopAuthenticationPrompt[] {
		return Array.from(this.pending.values(), (pending) => pending.prompt);
	}

	request(
		input: Omit<DesktopAuthenticationPrompt, "id" | "requestedAt">,
		signal: AbortSignal | undefined,
	): Promise<string> {
		if (signal?.aborted) return Promise.reject(createAbortError());

		const prompt: DesktopAuthenticationPrompt = {
			...input,
			id: this.createId(),
			requestedAt: this.now(),
		};

		return new Promise((resolve, reject) => {
			const onAbort = () => this.cancel(prompt.id);
			this.pending.set(prompt.id, { prompt, resolve, reject, signal, onAbort });
			signal?.addEventListener("abort", onAbort, { once: true });
			this.onChange?.();
		});
	}

	resolve(id: string, response: string): boolean {
		const pending = this.pending.get(id);
		if (!pending) return false;

		this.delete(id, pending);
		pending.resolve(response);
		this.onChange?.();
		return true;
	}

	cancelAll(): void {
		if (this.pending.size === 0) return;

		const pendingPrompts = Array.from(this.pending.entries());
		this.pending.clear();
		for (const [_id, pending] of pendingPrompts) {
			if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
			pending.reject(createAbortError());
		}
		this.onChange?.();
	}

	private cancel(id: string): void {
		const pending = this.pending.get(id);
		if (!pending) return;

		this.delete(id, pending);
		pending.reject(createAbortError());
		this.onChange?.();
	}

	private delete(id: string, pending: PendingAuthenticationPrompt): void {
		this.pending.delete(id);
		if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
	}
}
