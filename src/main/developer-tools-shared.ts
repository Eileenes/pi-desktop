/** Tools that only change files, which the "auto edit" policy may pass through. */
export const AUTO_EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "str_replace", "apply_patch"]);
