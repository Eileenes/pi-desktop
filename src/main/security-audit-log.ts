import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type SecurityAuditEvent =
	| "credential.configure"
	| "credential.logout"
	| "models.scope"
	| "plugin.install"
	| "plugin.remove"
	| "plugin.toggle"
	| "plugin.filters"
	| "skill.install"
	| "skill.toggle"
	| "tool.approval"
	| "workspace.trust";

export interface SecurityAuditRecord {
	event: SecurityAuditEvent;
	outcome: "allowed" | "denied" | "failed" | "succeeded";
	timestamp: string;
	details?: Record<string, boolean | number | string>;
}

export class SecurityAuditLog {
	private readonly path: string;
	private queue: Promise<void> = Promise.resolve();

	constructor(path: string) {
		this.path = path;
	}

	write(
		event: SecurityAuditEvent,
		outcome: SecurityAuditRecord["outcome"],
		details?: SecurityAuditRecord["details"],
	): void {
		const record: SecurityAuditRecord = {
			event,
			outcome,
			timestamp: new Date().toISOString(),
			...(details ? { details } : {}),
		};
		this.queue = this.queue
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
				await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
			});
		this.queue.catch((error: unknown) => console.error("Failed to write desktop security audit log", error));
	}

	flush(): Promise<void> {
		return this.queue;
	}
}
