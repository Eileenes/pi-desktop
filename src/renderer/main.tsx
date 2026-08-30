import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { isAppAccent } from "./app-settings-modal.tsx";
import "./styles.css";

// Paint the persisted/system theme before React mounts so the Electron window
// never flashes the opposite palette while the renderer hydrates.
const storedTheme = localStorage.getItem("pi-desktop-theme");
const initialTheme =
	storedTheme === "light" || storedTheme === "dark"
		? storedTheme
		: window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
document.documentElement.dataset.theme = initialTheme;
document.documentElement.dataset.accent = isAppAccent(localStorage.getItem("pi-desktop-accent"))
	? (localStorage.getItem("pi-desktop-accent") as string)
	: "blue";

const root = document.getElementById("root");
if (!root) throw new Error("Pi Agent root element is missing.");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
