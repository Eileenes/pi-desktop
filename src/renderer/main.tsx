import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Pi Desktop root element is missing.");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
