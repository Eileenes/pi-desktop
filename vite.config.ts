import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
	plugins: [react()],
	build: {
		outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
		emptyOutDir: true,
	},
});
