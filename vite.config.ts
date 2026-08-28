import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const MAX_CHUNK_SIZE = 450 * 1024;

export default defineConfig({
	base: "./",
	root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
	plugins: [react()],
	build: {
		outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
		emptyOutDir: true,
		// Mermaid's optional Langium parser is already a single minified upstream
		// module (about 662 kB / 143 kB gzip), so Rolldown cannot split it further.
		// It is only fetched for the newer parser-backed diagram types.
		chunkSizeWarningLimit: 665,
		rolldownOptions: {
			output: {
				// Manual groups cross Mermaid's cyclic module graph; preserve source
				// initialization order so renderer startup remains deterministic.
				strictExecutionOrder: true,
				codeSplitting: {
					groups: [
						{
							name: "react-vendor",
							test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 50,
						},
						{
							name: "mermaid-vendor",
							test: /node_modules[\\/]mermaid[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 40,
						},
						{
							name: "markdown-vendor",
							test: /node_modules[\\/](?:highlight\.js|katex|marked)[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 30,
						},
						{
							name: "icons-vendor",
							test: /node_modules[\\/]@lobehub[\\/]icons[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 20,
						},
						{
							name: "vendor",
							test: /node_modules[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 10,
						},
						{
							name: "renderer",
							test: /src[\\/]renderer[\\/]/,
							maxSize: MAX_CHUNK_SIZE,
							priority: 1,
						},
					],
				},
			},
		},
	},
});
