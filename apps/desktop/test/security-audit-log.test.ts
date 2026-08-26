import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecurityAuditLog } from "../src/main/security-audit-log.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SecurityAuditLog", () => {
	it("writes structured records without credential data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-audit-test-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "audit.jsonl");
		const log = new SecurityAuditLog(path);
		log.write("credential.configure", "succeeded", { providerId: "anthropic", authType: "oauth" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const record = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
		expect(record.event).toBe("credential.configure");
		expect(record.outcome).toBe("succeeded");
		expect(JSON.stringify(record)).not.toContain("token");
	});
});
