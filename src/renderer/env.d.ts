import type { DesktopApi } from "../shared/contracts.ts";

declare global {
	interface Window {
		piDesktop: DesktopApi;
	}

	/** Injected by Vite from package.json (see vite.config.ts). */
	const __APP_VERSION__: string;
}
