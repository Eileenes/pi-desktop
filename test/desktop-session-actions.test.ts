import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAgentHost } from "../src/main/desktop-agent-host.ts";
import { SecurityAuditLog } from "../src/main/security-audit-log.ts";
import { ToolApprovalQueue } from "../src/main/tool-approval-queue.ts";
import type { DesktopPermissionMode, DesktopSnapshot } from "../src/shared/contracts.ts";

vi.mock("electron", () => ({ nativeImage: {}, shell: {} }));
vi.mock("node-pty", () => ({ spawn: vi.fn() }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	vi.restoreAllMocks();
});

function managedSession(id: string) {
	return {
		id,
		lifecycleId: id,
		permissionMode: "ask" as DesktopPermissionMode,
		submitting: false,
		lastUsedAt: 0,
		projectTrusted: true,
		cwd: "/workspace",
		workspacePath: "/workspace",
		session: {
			sessionName: id,
			isStreaming: false,
			isCompacting: false,
			prompt: vi.fn(
				async (
					_text: string,
					options: { preflightResult?: (disposition: "started" | "queued" | "handled") => void },
				) => {
					options.preflightResult?.("started");
				},
			),
			abort: vi.fn(async () => {}),
			clearQueue: vi.fn(() => ({ steering: ["Use TypeScript"], followUp: ["Check the result"] })),
			executeBash: vi.fn(async () => ({ exitCode: 0, output: "" })),
		},
	};
}

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "pi-session-actions-"));
	const host = new DesktopAgentHost(directory);
	const audit = new SecurityAuditLog(join(directory, "audit.jsonl"));
	const queue = new ToolApprovalQueue();
	const first = managedSession("first");
	const second = managedSession("second");
	// Inject sessions at the SDK boundary: no credentials, models, or shell commands are used.
	Object.assign(host, {
		managedSessions: new Map([
			[first.id, first],
			[second.id, second],
		]),
		activeSessionId: second.id,
		session: second.session,
		approvalQueue: queue,
		auditLog: audit,
	});
	const snapshot: DesktopSnapshot = {
		projectTrusted: true,
		pendingToolApprovals: [],
		pendingAuthenticationPrompts: [],
		apiKeyProviders: [],
		availableModels: [],
		skills: [],
		plugins: [],
		providerSetupInProgress: false,
		sessions: [],
	};
	vi.spyOn(host, "getSnapshot").mockReturnValue(snapshot);
	cleanups.push(async () => {
		queue.cancelAll();
		await audit.flush();
		await rm(directory, { recursive: true, force: true });
	});
	return { host, first, second, queue };
}

describe("desktop session action boundaries", () => {
	it("returns acceptance before completion and keeps prompts on their originating session", async () => {
		const { host, first, second } = await fixture();
		let finish!: () => void;
		const run = new Promise<void>((resolve) => {
			finish = resolve;
		});
		first.session.prompt.mockImplementation(async (_text, options) => {
			options.preflightResult?.("started");
			await run;
		});
		await expect(host.prompt("first", "request-1", "Inspect the code")).resolves.toEqual({
			sessionId: "first",
			requestId: "request-1",
		});
		expect(first.submitting).toBe(false);
		expect(second.session.prompt).not.toHaveBeenCalled();
		finish();
		await run;
	});

	it("propagates rejected input instead of treating it as a completed submission", async () => {
		const { host, first } = await fixture();
		first.session.prompt.mockImplementation(async () => {
			throw new Error("No model configured");
		});
		await expect(host.prompt("first", "request-1", "hello")).rejects.toThrow("No model configured");
		expect(first.submitting).toBe(false);
	});

	it("rejects duplicate submissions while Pi is still validating the first input", async () => {
		const { host, first } = await fixture();
		let finishPreflight!: () => void;
		const preflight = new Promise<void>((resolve) => {
			finishPreflight = resolve;
		});
		first.session.prompt.mockImplementation(async (_text, options) => {
			await preflight;
			options.preflightResult?.("started");
		});
		const original = host.prompt(first.id, "original", "hello");
		await expect(host.prompt(first.id, "duplicate", "hello")).rejects.toThrow("确认中");
		finishPreflight();
		await original;
		expect(first.session.prompt).toHaveBeenCalledOnce();
	});

	it("records failures after acceptance on the originating background task", async () => {
		const { host, first, second } = await fixture();
		let fail!: (error: Error) => void;
		const run = new Promise<void>((_resolve, reject) => {
			fail = reject;
		});
		first.session.prompt.mockImplementation(async (_text, options) => {
			options.preflightResult?.("started");
			await run;
		});
		const receipt = await host.prompt(first.id, "request", "hello");
		fail(new Error("Disconnected"));
		await vi.waitFor(() => expect(first).toHaveProperty("error", "Disconnected"));
		expect(second).toHaveProperty("error", undefined);
		expect(receipt).toEqual({ sessionId: first.id, requestId: "request" });
	});

	it("keeps accepted input accepted even if saving the generated task name fails", async () => {
		const { host, first } = await fixture();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		Object.assign(first.session, {
			sessionName: undefined,
			sessionManager: {
				appendSessionInfo: () => {
					throw new Error("Disk is full");
				},
			},
		});
		await expect(host.prompt(first.id, "request", "hello")).resolves.toEqual({
			sessionId: first.id,
			requestId: "request",
		});
		expect(log).toHaveBeenCalledWith("Failed to publish accepted prompt", expect.any(Error));
	});

	it("forwards steering to Pi and rejects running image inputs before consuming them", async () => {
		const { host, first } = await fixture();
		first.session.isStreaming = true;
		await host.prompt("first", "request-1", "Use TypeScript", [], "steer");
		expect(first.session.prompt).toHaveBeenCalledWith(
			"Use TypeScript",
			expect.objectContaining({ streamingBehavior: "steer" }),
		);
		await expect(
			host.prompt("first", "request-2", "look", [{ data: "image", mimeType: "image/png" }], "followUp"),
		).rejects.toThrow("附加图片");
		expect(first.session.prompt).toHaveBeenCalledTimes(1);
	});

	it("changing a session policy never releases another session's approvals", async () => {
		const { host, first, second, queue } = await fixture();
		const firstDecision = queue.request(
			{ sessionId: first.id, toolCallId: "1", toolName: "bash", input: {} },
			first.id,
		);
		const secondDecision = queue.request(
			{ sessionId: second.id, toolCallId: "2", toolName: "bash", input: {} },
			second.id,
		);
		host.setPermissionMode(first.id, "full");
		await expect(firstDecision).resolves.toBe(true);
		expect(second.permissionMode).toBe("ask");
		expect(queue.getPendingApprovals().map((approval) => approval.sessionId)).toEqual([second.id]);
		queue.cancelAll();
		await expect(secondDecision).resolves.toBe(false);
	});

	it("auto-edit releases only edits, keeping reads and commands for individual approval", async () => {
		const { host, first, queue } = await fixture();
		const decisions = ["edit", "read", "bash"].map((toolName) =>
			queue.request({ sessionId: first.id, toolCallId: toolName, toolName, input: {} }, first.id),
		);
		host.setPermissionMode(first.id, "autoEdit");
		expect(queue.getPendingApprovals().map((approval) => approval.toolName)).toEqual(["read", "bash"]);
		queue.cancelAll();
		await expect(Promise.all(decisions)).resolves.toEqual([true, false, false]);
	});

	it("refuses composer shell commands until a trusted project is selected", async () => {
		const { host, second } = await fixture();
		second.session.executeBash = vi.fn();
		await expect(host.executeBashCommand("ls", false)).rejects.toThrow("请先选择项目");
		Object.assign(host, { workspacePath: "/workspace", projectTrusted: false });
		await expect(host.executeBashCommand("ls", false)).rejects.toThrow("请先信任该项目");
		expect(second.session.executeBash).not.toHaveBeenCalled();
	});

	it("runs composer shell commands only inside a trusted project", async () => {
		const { host, second } = await fixture();
		second.session.executeBash = vi.fn(async () => ({ exitCode: 0, output: "ok" }));
		Object.assign(host, { workspacePath: "/workspace", projectTrusted: true });
		await expect(host.executeBashCommand("ls", true)).resolves.toBe("ok");
		expect(second.session.executeBash).toHaveBeenCalledWith("ls", undefined, { excludeFromContext: true });
	});

	it("stops and retrieves the specified task even after the active task changes", async () => {
		const { host, first, second } = await fixture();
		await host.abort(first.id);
		await expect(host.clearQueue(first.id)).resolves.toEqual({
			sessionId: first.id,
			messages: [
				{ behavior: "steer", text: "Use TypeScript" },
				{ behavior: "followUp", text: "Check the result" },
			],
		});
		expect(first.session.abort).toHaveBeenCalledOnce();
		expect(first.session.clearQueue).toHaveBeenCalledOnce();
		expect(second.session.abort).not.toHaveBeenCalled();
		expect(second.session.clearQueue).not.toHaveBeenCalled();
		await expect(host.prompt("closed", "request", "hello")).rejects.toThrow("已关闭");
	});
});
