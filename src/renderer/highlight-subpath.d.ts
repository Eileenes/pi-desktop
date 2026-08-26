declare module "highlight.js/lib/core" {
	import hljs from "highlight.js";
	export default hljs;
}

declare module "highlight.js/lib/languages/*" {
	import hljs from "highlight.js";
	const language: Parameters<typeof hljs.registerLanguage>[1];
	export default language;
}
