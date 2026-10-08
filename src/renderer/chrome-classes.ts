/** Repeated Tailwind class strings for chrome that used to live in CSS files. */

export const NATIVE_TOOLBAR_BUTTON =
	"inline-flex size-[var(--ds-control-size)] min-h-[var(--ds-control-size)] shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[length:var(--text-sm-plus)] text-[color:var(--text-dim)] whitespace-nowrap transition-[background,color] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] [&>svg]:shrink-0 [&>svg]:text-[color:var(--text-dim)] [&>span]:hidden disabled:opacity-40";

export const NATIVE_TOOLBAR_ACTIVE = "bg-[var(--hover)] text-[color:var(--text)]";

export const FILE_TREE_ROW =
	"relative flex w-full min-h-7 items-center gap-1.5 rounded-[var(--radius-s)] border-0 bg-transparent py-1 pr-[7px] pl-[calc(9px+var(--entry-depth)*14px)] text-left font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[color:var(--text-dim)] transition-[background,color] duration-150";
