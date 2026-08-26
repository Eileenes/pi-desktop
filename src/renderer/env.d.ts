import type { DesktopApi } from "../shared/contracts.ts";

declare global {
	interface Window {
		piDesktop: DesktopApi;
	}
}
