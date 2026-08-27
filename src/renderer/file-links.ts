function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function stripLineSuffix(filePath: string): string {
	return filePath.replace(/:\d+(?::\d+)?$/u, "");
}

function looksLikeFile(href: string): boolean {
	if (href.startsWith("./") || href.startsWith("../")) return true;
	if (href.includes("/") || href.includes("\\")) return true;
	return /(^|\/)\.?[^/]+\.[^/.]+$/u.test(href);
}

export function resolveWorkspaceFileHref(href: string | undefined, workspacePath?: string): string | undefined {
	if (!href || !workspacePath) return undefined;
	const clean = safeDecode(href.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "").replaceAll("\\", "/");
	if (!clean || clean.startsWith("#") || clean.startsWith("//")) return undefined;
	if (/^[a-z][a-z0-9+.-]*:/iu.test(clean) && !clean.startsWith("file:")) return undefined;
	if (clean.startsWith("file:")) {
		try {
			const url = new URL(clean);
			if (url.protocol !== "file:") return undefined;
			return stripLineSuffix(safeDecode(url.pathname));
		} catch {
			return undefined;
		}
	}
	if (clean.startsWith("/")) return stripLineSuffix(clean);
	if (!looksLikeFile(clean)) return undefined;
	return stripLineSuffix(clean);
}
