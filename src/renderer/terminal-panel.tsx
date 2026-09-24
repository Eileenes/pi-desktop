import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n.ts";
import { TerminalSession, type TerminalSessionHandle } from "./terminal-session.tsx";

const HEIGHT_STORAGE_KEY = "pi-desktop-terminal-height";
const MIN_HEIGHT = 140;
const DEFAULT_HEIGHT = 280;

interface TerminalTab {
	key: string;
	handle?: TerminalSessionHandle;
	error?: string;
	exitCode?: number;
}

function readStoredHeight(): number {
	const stored = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
	return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : DEFAULT_HEIGHT;
}

export interface TerminalPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * The integrated terminal, docked below the composer the way the reference app
 * docks it. Tabs stay mounted for their whole lifetime so collapsing the panel
 * never kills a running shell.
 */
export function TerminalPanel({ open, onOpenChange }: TerminalPanelProps) {
	const { t } = useI18n();
	const [tabs, setTabs] = useState<TerminalTab[]>([]);
	const [activeKey, setActiveKey] = useState<string>();
	const [height, setHeight] = useState(readStoredHeight);
	const dragRef = useRef<{ startY: number; startHeight: number } | undefined>(undefined);
	const nextKey = useRef(1);

	const addTab = useCallback(() => {
		const key = `tab-${nextKey.current++}`;
		setTabs((current) => [...current, { key }]);
		setActiveKey(key);
	}, []);

	// Opening the panel with nothing to show starts a shell; the first run of the
	// app must never present an empty frame.
	useEffect(() => {
		if (!open || tabs.length > 0) return;
		addTab();
	}, [open, tabs.length, addTab]);

	const updateTab = useCallback((key: string, patch: Partial<TerminalTab>) => {
		setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)));
	}, []);

	const closeTab = useCallback(
		(key: string) => {
			const remaining = tabs.filter((tab) => tab.key !== key);
			if (remaining.length === 0) {
				// Closing the last tab collapses the panel; the shell stays alive so
				// reopening the panel brings the session back instead of a cold start.
				onOpenChange(false);
				return;
			}
			setTabs(remaining);
			if (activeKey === key) setActiveKey(remaining.at(-1)?.key);
		},
		[tabs, activeKey, onOpenChange],
	);

	useEffect(() => {
		if (tabs.length > 0 && !tabs.some((tab) => tab.key === activeKey)) setActiveKey(tabs[0]?.key);
	}, [tabs, activeKey]);

	// Height drag. Window-level listeners keep the gesture alive outside the handle.
	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const maxHeight = Math.round(window.innerHeight * 0.7);
			const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, drag.startHeight + (drag.startY - event.clientY)));
			setHeight(next);
		};
		const onUp = () => {
			if (!dragRef.current) return;
			dragRef.current = undefined;
			document.body.classList.remove("is-resizing-terminal");
			setHeight((current) => {
				localStorage.setItem(HEIGHT_STORAGE_KEY, String(current));
				return current;
			});
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, []);

	if (tabs.length === 0) return null;
	const activeTab = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];
	const collapsed = !open;

	return (
		<section
			className={`terminal-panel ${collapsed ? "is-collapsed" : ""}`}
			style={{ "--terminal-height": `${height}px` } as CSSProperties}
			aria-label={t("terminalTitle")}
			aria-hidden={collapsed}
		>
			<hr
				className="terminal-resizer"
				aria-orientation="horizontal"
				aria-label={t("resizeTerminalAria")}
				aria-valuemin={MIN_HEIGHT}
				aria-valuemax={Math.round(window.innerHeight * 0.7)}
				aria-valuenow={height}
				tabIndex={collapsed ? -1 : 0}
				onPointerDown={(event) => {
					if (collapsed) return;
					dragRef.current = { startY: event.clientY, startHeight: height };
					document.body.classList.add("is-resizing-terminal");
				}}
				onDoubleClick={() => {
					setHeight(DEFAULT_HEIGHT);
					localStorage.setItem(HEIGHT_STORAGE_KEY, String(DEFAULT_HEIGHT));
				}}
				onKeyDown={(event) => {
					if (collapsed) return;
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					setHeight((current) => {
						const next = Math.max(MIN_HEIGHT, current + (event.key === "ArrowUp" ? 16 : -16));
						localStorage.setItem(HEIGHT_STORAGE_KEY, String(next));
						return next;
					});
				}}
			/>
			<header className="terminal-panel-header">
				<div className="terminal-panel-title">
					<span>{t("terminalTitle")}</span>
					{activeTab?.handle ? <small>{activeTab.handle.shell}</small> : null}
				</div>
				<div className="terminal-tabs" role="tablist" aria-label={t("terminalTabsAria")}>
					{tabs.map((tab, index) => (
						<span key={tab.key} className={`terminal-tab ${tab.key === activeTab?.key ? "is-active" : ""}`}>
							<button
								className="terminal-tab-label"
								type="button"
								role="tab"
								aria-selected={tab.key === activeTab?.key}
								onClick={() => setActiveKey(tab.key)}
							>
								{t("terminalTabLabel", { index: index + 1 })}
							</button>
							<button
								className="terminal-tab-close"
								type="button"
								aria-label={t("terminalCloseTab", { index: index + 1 })}
								onClick={() => closeTab(tab.key)}
							>
								×
							</button>
						</span>
					))}
				</div>
				<div className="terminal-panel-actions">
					<button type="button" aria-label={t("terminalNew")} title={t("terminalNew")} onClick={addTab}>
						+
					</button>
					<button
						type="button"
						aria-label={t("terminalClose")}
						title={t("terminalClose")}
						onClick={() => onOpenChange(false)}
					>
						×
					</button>
				</div>
			</header>
			<div className="terminal-panel-body">
				{tabs.map((tab) => (
					<div
						key={tab.key}
						className={`terminal-pane ${tab.key === activeTab?.key ? "is-active" : ""}`}
						role="tabpanel"
					>
						{tab.error ? (
							<output className="terminal-error">{tab.error}</output>
						) : tab.exitCode !== undefined ? (
							<output className="terminal-error">{t("terminalExited", { code: tab.exitCode })}</output>
						) : null}
						<TerminalSession
							onReady={(handle) => updateTab(tab.key, { handle, error: undefined })}
							onError={(message) => updateTab(tab.key, { error: message })}
							onExit={(exitCode) => updateTab(tab.key, { exitCode })}
							visible={open && tab.key === activeTab?.key}
						/>
					</div>
				))}
			</div>
		</section>
	);
}
