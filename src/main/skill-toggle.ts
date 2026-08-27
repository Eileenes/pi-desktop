import { readFile, writeFile } from "node:fs/promises";

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 修改 SKILL.md frontmatter 的 disable-model-invocation 字段。 */
export async function setSkillDisableModelInvocation(filePath: string, disable: boolean): Promise<void> {
	const content = await readFile(filePath, "utf8");
	const normalized = normalizeNewlines(content);
	const lines = normalized.split("\n");

	if (!lines[0]?.startsWith("---")) {
		throw new Error("该技能文件没有 frontmatter，无法修改。");
	}

	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (endIndex === -1) {
		throw new Error("该技能文件的 frontmatter 格式无效。");
	}

	const frontmatterLines = lines.slice(1, endIndex);
	const bodyLines = lines.slice(endIndex + 1);

	let found = false;
	const nextFrontmatter = frontmatterLines.map((line) => {
		if (/^disable-model-invocation\s*:/u.test(line)) {
			found = true;
			return `disable-model-invocation: ${disable}`;
		}
		return line;
	});
	if (!found) {
		nextFrontmatter.push(`disable-model-invocation: ${disable}`);
	}

	const output = ["---", ...nextFrontmatter, "---", ...bodyLines].join("\n");
	await writeFile(filePath, output, "utf8");
}
