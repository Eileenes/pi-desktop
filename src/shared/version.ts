function parseVersion(value: string): [number, number, number, string | undefined] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim());
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

export function isNewerVersion(latest: string, current: string): boolean {
	const next = parseVersion(latest);
	const installed = parseVersion(current);
	if (!next || !installed) return false;
	const nextCore = next.slice(0, 3) as [number, number, number];
	const installedCore = installed.slice(0, 3) as [number, number, number];
	for (let index = 0; index < nextCore.length; index += 1) {
		if (nextCore[index] !== installedCore[index]) return nextCore[index] > installedCore[index];
	}
	if (next[3] === installed[3]) return false;
	if (next[3] === undefined) return true;
	if (installed[3] === undefined) return false;
	return next[3].localeCompare(installed[3], undefined, { numeric: true }) > 0;
}
