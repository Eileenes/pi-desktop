import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(appDirectory, "package.json"), "utf8"));
const mainEntry = packageJson.main;

if (typeof mainEntry !== "string" || !mainEntry.startsWith("./dist/")) {
	throw new Error("Desktop package main must point to a relative dist artifact.");
}

const mainEntryPath = resolve(appDirectory, mainEntry);
if (relative(appDirectory, mainEntryPath).startsWith("..")) {
	throw new Error("Desktop package main resolves outside the application directory.");
}
await access(mainEntryPath);
await access(resolve(appDirectory, "dist/main/preload/index.cjs"));

const rendererDirectory = resolve(appDirectory, "dist/renderer");
const rendererHtml = await readFile(resolve(rendererDirectory, "index.html"), "utf8");
const assetReferences = Array.from(rendererHtml.matchAll(/(?:href|src)="([^"]+)"/gu), (match) => match[1]);

for (const assetReference of assetReferences) {
	if (!assetReference.startsWith("./") || isAbsolute(assetReference)) {
		throw new Error(`Renderer asset must use a file-relative URL: ${assetReference}`);
	}
	const assetPath = resolve(rendererDirectory, assetReference);
	if (relative(rendererDirectory, assetPath).startsWith("..")) {
		throw new Error(`Renderer asset resolves outside the renderer directory: ${assetReference}`);
	}
	await access(assetPath);
}
