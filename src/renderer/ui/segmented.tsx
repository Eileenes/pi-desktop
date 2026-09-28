import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./button.tsx";
import "./segmented.css";

type SegmentedProps = {
	children: ReactNode;
	className?: string;
	variant?: "track" | "tiles";
	fill?: boolean;
	"aria-label"?: string;
};

export function Segmented({
	children,
	className,
	variant = "track",
	fill = false,
	"aria-label": ariaLabel,
}: SegmentedProps) {
	const classes = ["ui-segmented", `ui-segmented-${variant}`];
	if (fill) classes.push("is-fill");
	if (className) classes.push(className);
	return (
		<div className={classes.join(" ")} role="tablist" aria-label={ariaLabel}>
			{children}
		</div>
	);
}

type SegmentProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	active?: boolean;
};

export function Segment({ active = false, className, ...props }: SegmentProps) {
	const classes = ["ui-segment"];
	if (active) classes.push("is-active");
	if (className) classes.push(className);
	return <Button variant="bare" className={classes.join(" ")} aria-pressed={active} {...props} />;
}
