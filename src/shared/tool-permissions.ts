import type { DesktopPermissionMode } from "./contracts.ts";

export const AUTO_EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "str_replace", "apply_patch"]);

export function permitsTool(mode: DesktopPermissionMode, toolName: string): boolean {
	return mode === "full" || (mode === "autoEdit" && AUTO_EDIT_TOOLS.has(toolName));
}
