import { describe, expect, it, vi } from "vitest";
import {
	createHeadlessCustomUiTui,
	ExtensionCustomUiController,
	ExtensionDialogQueue,
} from "../src/main/extension-ui-controller.ts";
import type { DesktopExtensionUiEvent } from "../src/shared/contracts.ts";

describe("ExtensionDialogQueue", () => {
	it("emits a session-scoped dialog and resolves its response", async () => {
		const events: DesktopExtensionUiEvent[] = [];
		const queue = new ExtensionDialogQueue((event) => events.push(event));
		const response = queue.request("session-a", { kind: "input", title: "Name" });
		const opened = events[0];
		expect(opened?.type).toBe("dialog");
		if (opened?.type !== "dialog") throw new Error("dialog was not emitted");
		expect(opened.sessionId).toBe("session-a");
		expect(queue.resolve(opened.dialog.id, "Pi")).toBe(true);
		await expect(response).resolves.toBe("Pi");
		expect(events.at(-1)).toEqual({ type: "dialogClosed", sessionId: "session-a", id: opened.dialog.id });
	});

	it("cancels when its AbortSignal fires", async () => {
		const queue = new ExtensionDialogQueue(() => undefined);
		const controller = new AbortController();
		const response = queue.request(
			"session-a",
			{ kind: "confirm", title: "Stop", message: "Sure?" },
			{
				signal: controller.signal,
			},
		);
		controller.abort();
		await expect(response).resolves.toBe("");
	});
});

describe("ExtensionCustomUiController", () => {
	it("renders a headless component and forwards terminal input", async () => {
		const events: DesktopExtensionUiEvent[] = [];
		const controller = new ExtensionCustomUiController("session-a", (event) => events.push(event), {}, {});
		const result = controller.request<string>(
			(_tui: unknown, _theme: unknown, _keys: unknown, done: (value: string) => void) => ({
				render: () => ["Choose"],
				handleInput: (data: string) => {
					if (data === "\r") done("selected");
				},
			}),
		);
		await Promise.resolve();
		const opened = events.find((event) => event.type === "custom");
		expect(opened).toMatchObject({ type: "custom", sessionId: "session-a", lines: ["Choose"] });
		if (!opened || opened.type !== "custom") throw new Error("custom UI was not emitted");
		expect(controller.input(opened.id, "\r")).toBe(true);
		await expect(result).resolves.toBe("selected");
		expect(events.at(-1)).toMatchObject({ type: "custom", id: opened.id, closed: true });
	});

	it("exposes stable terminal dimensions", () => {
		const render = vi.fn();
		const tui = createHeadlessCustomUiTui(render, 72, 24);
		expect(tui.terminal).toEqual({ columns: 72, rows: 24, kittyProtocolActive: false });
		tui.requestRender(true);
		expect(render).toHaveBeenCalledWith(true);
	});
});
