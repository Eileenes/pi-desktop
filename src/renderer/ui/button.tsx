import type { ButtonHTMLAttributes } from "react";
import "./button.css";

export type UiButtonVariant = "primary" | "outline" | "ghost" | "danger" | "bare";
export type UiButtonSize = "sm" | "md" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: UiButtonVariant;
	size?: UiButtonSize;
};

export function Button({ variant = "ghost", size = "md", className, type = "button", ...props }: ButtonProps) {
	const classes = ["ui-button", `ui-button-${variant}`];
	if (variant !== "bare") classes.push(`ui-button-${size}`);
	if (className) classes.push(className);
	return <button type={type} className={classes.join(" ")} {...props} />;
}
