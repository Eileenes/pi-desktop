export interface SessionReferenceCandidate {
	label: string;
	path: string;
}

export interface SessionReferenceExpansionOptions {
	candidates: SessionReferenceCandidate[];
	load: (path: string) => string;
	maxCharacters?: number;
}

const SESSION_REFERENCE_PATTERN = /#(?:"((?:\\.|[^"\\])*)"|([^\s#]+))/gu;

function unescapeQuotedLabel(value: string): string {
	return value.replace(/\\(["\\])/gu, "$1");
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function formatSessionReference(label: string): string {
	return /\s/u.test(label) ? `#"${label.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : `#${label}`;
}

/** Expands exact, unambiguous session labels into bounded untrusted context blocks. */
export function expandSessionReferences(text: string, options: SessionReferenceExpansionOptions): string {
	const maxCharacters = options.maxCharacters ?? 120_000;
	let remaining = maxCharacters;
	const byLabel = new Map<string, SessionReferenceCandidate[]>();
	for (const candidate of options.candidates) {
		const key = candidate.label.trim().toLocaleLowerCase();
		if (!key) continue;
		const matches = byLabel.get(key) ?? [];
		matches.push(candidate);
		byLabel.set(key, matches);
	}

	return text.replace(SESSION_REFERENCE_PATTERN, (original, quoted: string | undefined, plain: string | undefined) => {
		const label = quoted === undefined ? plain : unescapeQuotedLabel(quoted);
		if (!label) return original;
		const matches = byLabel.get(label.toLocaleLowerCase());
		if (matches?.length !== 1 || remaining <= 0) return original;
		const content = options.load(matches[0].path).slice(0, remaining);
		if (!content) return original;
		remaining -= content.length;
		return `<session_reference name="${escapeAttribute(matches[0].label)}" trust="untrusted-history">\n${content}\n</session_reference>`;
	});
}
