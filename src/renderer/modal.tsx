import { memo, type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const modalStack: string[] = [];
let modalSequence = 0;

interface ModalProps {
	title: string;
	subtitle?: string;
	className?: string;
	onClose: () => void;
	children: ReactNode;
}

export const Modal = memo(function Modal({ title, subtitle, className, onClose, children }: ModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const modalIdRef = useRef<string | undefined>(undefined);
	if (!modalIdRef.current) modalIdRef.current = `modal-${++modalSequence}`;
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		const modalId = modalIdRef.current;
		if (!modalId) return;
		const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		modalStack.push(modalId);
		const focusFrame = window.requestAnimationFrame(() => {
			const panel = panelRef.current;
			if (!panel || modalStack.at(-1) !== modalId) return;
			panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
		});
		const onKeyDown = (event: KeyboardEvent) => {
			if (modalStack.at(-1) !== modalId) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const panel = panelRef.current;
			if (!panel) return;
			const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
			if (focusable.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1) ?? first;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.cancelAnimationFrame(focusFrame);
			window.removeEventListener("keydown", onKeyDown);
			const index = modalStack.lastIndexOf(modalId);
			if (index >= 0) modalStack.splice(index, 1);
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, []);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击背景关闭模态框是标准交互
		<div
			className="modal-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				tabIndex={-1}
				className={`modal-panel${className ? ` ${className}` : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<header className="modal-header">
					<div className="modal-heading">
						<h2 className="modal-title">{title}</h2>
						{subtitle ? <code className="modal-subtitle">{subtitle}</code> : null}
					</div>
					<button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
						×
					</button>
				</header>
				<div className="modal-body">{children}</div>
			</div>
		</div>
	);
});
