import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { memo, useMemo } from "react";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);

const EXTENSION_LANGUAGES: Record<string, string> = {
	bash: "bash",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	css: "css",
	go: "go",
	h: "c",
	html: "xml",
	htm: "xml",
	java: "java",
	js: "javascript",
	jsx: "javascript",
	json: "json",
	md: "markdown",
	markdown: "markdown",
	mjs: "javascript",
	py: "python",
	rs: "rust",
	scss: "scss",
	sh: "bash",
	sql: "sql",
	swift: "swift",
	toml: "ini",
	ts: "typescript",
	tsx: "typescript",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
};

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function getLanguageForPath(path: string): string | undefined {
	const base = path.split(/[\\/]/u).at(-1) ?? "";
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return undefined;
	return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()];
}

function highlightCode(code: string, language?: string): string {
	const normalizedLanguage = language?.toLowerCase();
	if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
		try {
			return hljs.highlight(normalizedLanguage, code).value;
		} catch {
			return escapeHtml(code);
		}
	}
	return escapeHtml(code);
}

export const HighlightedCode = memo(function HighlightedCode({ code, language }: { code: string; language?: string }) {
	const html = useMemo(() => highlightCode(code, language), [code, language]);
	// biome-ignore lint/security/noDangerouslySetInnerHtml: hljs 输出已对代码内容转义，仅包含高亮 span
	return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
});
