import { type MouseEvent, memo, type ReactNode } from "react";

/*
 * One dropdown grammar for every menu in the app.
 *
 * The menus used to be hand-rolled per surface, so each one inherited whatever
 * font weight and rhythm its container happened to set: the sidebar header made
 * its menu bold, the footer's stayed regular, and a row that forgot its padding
 * collapsed to a single text line. Every menu now renders through these
 * primitives, which carry their own type and metrics.
 */

interface MenuProps {
	/** Positioning class of the surface that opens the menu. */
	className?: string;
	/** A nested list rather than a floating plate (opened in place). */
	inline?: boolean;
	labelledBy?: string;
	children: ReactNode;
}

export const Menu = memo(function Menu({ className, inline, labelledBy, children }: MenuProps) {
	return (
		<div
			className={`app-menu${inline ? " is-inline" : ""}${className ? ` ${className}` : ""}`}
			role="menu"
			aria-labelledby={labelledBy}
		>
			{children}
		</div>
	);
});

interface MenuItemProps {
	icon?: ReactNode;
	label: ReactNode;
	/** Second line of copy, for menus that explain what the row does. */
	hint?: ReactNode;
	trailing?: ReactNode;
	/** Marks the row the menu is currently on (adds a tick). */
	current?: boolean;
	danger?: boolean;
	disabled?: boolean;
	title?: string;
	onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}

export const MenuItem = memo(function MenuItem({
	icon,
	label,
	hint,
	trailing,
	current = false,
	danger = false,
	disabled = false,
	title,
	onSelect,
}: MenuItemProps) {
	return (
		<button
			className={`app-menu-item${danger ? " is-danger" : ""}${current ? " is-current" : ""}`}
			type="button"
			role="menuitem"
			title={title}
			disabled={disabled}
			onClick={onSelect}
		>
			{icon ? <span className="app-menu-icon">{icon}</span> : null}
			<span className="app-menu-label">
				<span className="app-menu-copy">
					{label}
					{current ? " ✓" : ""}
				</span>
				{hint ? <small className="app-menu-hint">{hint}</small> : null}
			</span>
			{trailing ? <span className="app-menu-trailing">{trailing}</span> : null}
		</button>
	);
});

export const MenuDivider = memo(function MenuDivider() {
	return <hr className="app-menu-divider" />;
});

export const MenuHeading = memo(function MenuHeading({ children }: { children: ReactNode }) {
	return <div className="app-menu-heading">{children}</div>;
});

export const MenuEmpty = memo(function MenuEmpty({ children }: { children: ReactNode }) {
	return <p className="app-menu-empty">{children}</p>;
});

export const MenuFilter = memo(function MenuFilter({
	value,
	onChange,
	placeholder,
	ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	ariaLabel: string;
}) {
	return (
		<input
			className="app-menu-filter"
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			aria-label={ariaLabel}
		/>
	);
});
