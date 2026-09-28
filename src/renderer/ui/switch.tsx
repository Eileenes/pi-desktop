import type { ButtonHTMLAttributes } from "react";
import "./switch.css";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked" | "onChange"> & {
	checked: boolean;
	onCheckedChange?: () => void;
};

export function Switch({ checked, className, type = "button", onClick, onCheckedChange, ...props }: SwitchProps) {
	const classes = ["ui-switch"];
	if (checked) classes.push("is-on");
	if (className) classes.push(className);
	return (
		<button
			type={type}
			role="switch"
			aria-checked={checked}
			className={classes.join(" ")}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) onCheckedChange?.();
			}}
			{...props}
		>
			<span className="ui-switch-knob" />
		</button>
	);
}
