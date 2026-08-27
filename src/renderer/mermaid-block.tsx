import mermaid from "mermaid";
import { memo, useEffect, useId, useState } from "react";
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
						预览
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
						源码
					</button>
					{svg ? (
						<button type="button" onClick={() => setZoomed(true)}>
							放大
						</button>
					) : null}
				</div>
				{error ? (
					<p>Mermaid 图表语法无效。</p>
				) : svg ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid uses strict security mode before producing this SVG.
					<div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
				) : (
					<div className="mermaid-loading">正在渲染图表…</div>
				)}
			</div>
			{zoomed && svg ? (
				<div className="mermaid-zoom-backdrop" role="dialog" aria-modal="true" aria-label="Mermaid 图表查看器">
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
							重置
						</button>
					</div>
					<button type="button" className="mermaid-zoom-close" onClick={() => setZoomed(false)}>
						关闭
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
