import mermaid from "mermaid";
import { memo, useEffect, useId, useState } from "react";
import { useI18n } from "./i18n.ts";
import { HighlightedCode } from "./syntax-highlight.tsx";

let initialized = false;

function initializeMermaid(): void {
	if (initialized) return;
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: document.documentElement.dataset.theme === "light" ? "default" : "dark",
		fontFamily: "var(--font-sans)",
	});
	initialized = true;
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
	const { t } = useI18n();
	const reactId = useId().replaceAll(":", "");
	const [preview, setPreview] = useState(true);
	const [svg, setSvg] = useState<string>();
	const [error, setError] = useState(false);
	const [zoomed, setZoomed] = useState(false);
	const [zoomPercent, setZoomPercent] = useState(100);

	useEffect(() => {
		if (!preview) return;
		let active = true;
		initializeMermaid();
		void mermaid
			.parse(code, { suppressErrors: true })
			.then((valid) => (valid ? mermaid.render(`mermaid-${reactId}`, code) : undefined))
			.then((result) => {
				if (!active) return;
				setSvg(result?.svg);
				setError(!result);
			})
			.catch(() => {
				if (active) setError(true);
			});
		return () => {
			active = false;
		};
	}, [code, preview, reactId]);

	useEffect(() => {
		if (!zoomed) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setZoomed(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [zoomed]);

	if (!preview) {
		return (
			<div className="code-block mermaid-source">
				<div className="code-block-toolbar">
					<span>mermaid</span>
					<button type="button" onClick={() => setPreview(true)}>
						{t("preview")}
					</button>
				</div>
				<pre>
					<HighlightedCode code={code} language="mermaid" />
				</pre>
			</div>
		);
	}

	return (
		<>
			<div className={`mermaid-block ${error ? "is-error" : ""}`}>
				<div className="code-block-toolbar">
					<span>Mermaid</span>
					<button type="button" onClick={() => setPreview(false)}>
						{t("source")}
					</button>
					{svg ? (
						<button type="button" onClick={() => setZoomed(true)}>
							{t("zoom")}
						</button>
					) : null}
				</div>
				{error ? (
					<p>{t("mermaidInvalid")}</p>
				) : svg ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid uses strict security mode before producing this SVG.
					<div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
				) : (
					<div className="mermaid-loading">{t("mermaidRendering")}</div>
				)}
			</div>
			{zoomed && svg ? (
				<div className="mermaid-zoom-backdrop" role="dialog" aria-modal="true" aria-label={t("mermaidViewer")}>
					<div className="mermaid-zoom-toolbar">
						<button
							type="button"
							disabled={zoomPercent <= 50}
							onClick={() => setZoomPercent((current) => Math.max(50, current - 25))}
						>
							−
						</button>
						<output>{zoomPercent}%</output>
						<button
							type="button"
							disabled={zoomPercent >= 300}
							onClick={() => setZoomPercent((current) => Math.min(300, current + 25))}
						>
							+
						</button>
						<button type="button" onClick={() => setZoomPercent(100)}>
							{t("reset")}
						</button>
					</div>
					<button type="button" className="mermaid-zoom-close" onClick={() => setZoomed(false)}>
						{t("close")}
					</button>
					<div className="mermaid-zoom-canvas">
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid uses strict security mode before producing this SVG. */}
						<div style={{ width: `${zoomPercent}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
					</div>
				</div>
			) : null}
		</>
	);
});
