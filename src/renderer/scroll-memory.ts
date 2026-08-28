const STORAGE_KEY = "pi-desktop-scroll-memory";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 30;

export interface ScrollMemoryEntry {
	scrollTop: number;
	visibleItemCount: number;
}

interface ScrollMemoryPayload {
	version: number;
	order: string[];
	entries: Record<string, ScrollMemoryEntry>;
}

function readPayload(): ScrollMemoryPayload {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (
			!raw ||
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			(raw as ScrollMemoryPayload).version !== SCHEMA_VERSION ||
			!Array.isArray((raw as ScrollMemoryPayload).order)
		) {
			return { version: SCHEMA_VERSION, order: [], entries: {} };
		}
		const payload = raw as ScrollMemoryPayload;
		const entries: Record<string, ScrollMemoryEntry> = {};
		for (const [key, entry] of Object.entries(payload.entries ?? {})) {
			if (
				typeof entry === "object" &&
				entry !== null &&
				Number.isFinite((entry as ScrollMemoryEntry).scrollTop) &&
				Number.isInteger((entry as ScrollMemoryEntry).visibleItemCount)
			) {
				entries[key] = {
					scrollTop: (entry as ScrollMemoryEntry).scrollTop,
					visibleItemCount: (entry as ScrollMemoryEntry).visibleItemCount,
				};
			}
		}
		return {
			version: SCHEMA_VERSION,
			order: payload.order.filter((key): key is string => typeof key === "string" && key in entries),
			entries,
		};
	} catch {
		return { version: SCHEMA_VERSION, order: [], entries: {} };
	}
}

function writePayload(payload: ScrollMemoryPayload): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Persistence is best-effort; quota errors are ignored.
	}
}

export function readScrollPosition(sessionId: string): ScrollMemoryEntry | undefined {
	return readPayload().entries[sessionId];
}

export function writeScrollPosition(sessionId: string, entry: ScrollMemoryEntry): void {
	const payload = readPayload();
	payload.entries[sessionId] = entry;
	payload.order = [sessionId, ...payload.order.filter((key) => key !== sessionId)].slice(0, MAX_ENTRIES);
	for (const stale of Object.keys(payload.entries)) {
		if (!payload.order.includes(stale)) delete payload.entries[stale];
	}
	writePayload(payload);
}

export function forgetScrollPosition(sessionId: string): void {
	const payload = readPayload();
	if (!(sessionId in payload.entries)) return;
	delete payload.entries[sessionId];
	payload.order = payload.order.filter((key) => key !== sessionId);
	writePayload(payload);
}
