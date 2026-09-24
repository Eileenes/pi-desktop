import { memo, useId } from "react";

/*
 * The product mark: a pi cut out of a rounded tile.
 *
 * Drawn rather than imported so it stays crisp from an 18px sidebar glyph to a
 * 100px hero, and built from a single path with fill-rule so the letter is a
 * real hole: the tile paints in currentColor and the pi shows whatever surface
 * is behind it, which keeps one asset correct on the sidebar, on the canvas,
 * and in either theme. The subtle top-to-bottom falloff gives the plate a sense
 * of light rather than reading as a flat swatch.
 */
export const BrandMark = memo(function BrandMark({
	size = 24,
	className,
	title,
}: {
	size?: number;
	className?: string;
	title?: string;
}) {
	const gradientId = useId();
	return (
		<svg
			className={className}
			width={size}
			height={size}
			viewBox="0 0 32 32"
			role={title ? "img" : undefined}
			aria-hidden={title ? undefined : true}
		>
			{title ? <title>{title}</title> : null}
			<defs>
				{/*
				 * The plate takes its ink from theme tokens rather than currentColor:
				 * dark chrome lights a white plate, and light chrome brushes graphite
				 * instead of flat black, so both themes keep the same material.
				 */}
				<linearGradient id={gradientId} x1="0.2" y1="0" x2="0.6" y2="1">
					<stop offset="0%" stopColor="var(--ds-brand-mark-top, currentColor)" />
					<stop offset="100%" stopColor="var(--ds-brand-mark-bottom, currentColor)" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientId})`}
				fillRule="evenodd"
				d="M10 3h12a7.5 7.5 0 0 1 7.5 7.5v11A7.5 7.5 0 0 1 22 29H10a7.5 7.5 0 0 1-7.5-7.5v-11A7.5 7.5 0 0 1 10 3ZM8.6 10.4h14.8v2.8h-2.3v8.8h-2.8v-8.8h-4.6v8.8h-2.8v-8.8H8.6Z"
			/>
		</svg>
	);
});
