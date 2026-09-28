import { describe, expect, it } from "vitest";
import { appShortcutFor, isComposingInput } from "../src/renderer/keyboard-shortcuts.ts";

const shortcut = {
	key: "k",
	metaKey: true,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: false,
	repeat: false,
	defaultPrevented: false,
};

describe("application shortcut scopes", () => {
	it("separates search from composer focus", () => {
		expect(appShortcutFor(shortcut, false, false)).toBe("search");
		expect(appShortcutFor({ ...shortcut, key: "L" }, false, false)).toBe("focusComposer");
	});

	it("lets dialogs and terminals own their editing shortcuts", () => {
		expect(appShortcutFor(shortcut, true, false)).toBeUndefined();
		expect(appShortcutFor(shortcut, false, true)).toBeUndefined();
		expect(appShortcutFor({ ...shortcut, key: "j" }, false, true)).toBe("toggleTerminal");
		expect(appShortcutFor({ ...shortcut, defaultPrevented: true }, false, false)).toBeUndefined();
	});

	it("does not dispatch commands while choosing an IME candidate", () => {
		expect(appShortcutFor({ ...shortcut, isComposing: true }, false, false)).toBeUndefined();
		expect(isComposingInput({ isComposing: false, keyCode: 229 }, false)).toBe(true);
		expect(isComposingInput({ isComposing: false, keyCode: 13 }, true)).toBe(true);
		expect(isComposingInput({ isComposing: false, keyCode: 13 }, false)).toBe(false);
	});
});
