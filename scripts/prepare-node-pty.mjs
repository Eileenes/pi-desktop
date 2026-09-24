/*
 * node-pty ships prebuilt binaries, and the macOS `spawn-helper` in that
 * prebuild is published without its executable bit. Every PTY spawn then fails
 * with "posix_spawnp failed". Fixing the mode here covers development; the
 * packaged app re-applies it at runtime because unpacking from asar can reset it.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const prebuildsDirectory = join(appDirectory, "node_modules", "node-pty", "prebuilds");

if (!existsSync(prebuildsDirectory)) {
	console.log("node-pty prebuilds not present; skipping spawn-helper permissions.");
	process.exit(0);
}

let repaired = 0;
for (const platformKey of readdirSync(prebuildsDirectory)) {
	const helperPath = join(prebuildsDirectory, platformKey, "spawn-helper");
	if (!existsSync(helperPath)) continue;
	const mode = statSync(helperPath).mode;
	if ((mode & 0o111) === 0o111) continue;
	chmodSync(helperPath, 0o755);
	repaired += 1;
}

console.log(
	repaired === 0
		? "node-pty spawn-helper already executable."
		: `Made ${repaired} node-pty spawn-helper binaries executable.`,
);
