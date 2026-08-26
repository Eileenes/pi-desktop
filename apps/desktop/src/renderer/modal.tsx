import { memo, type ReactNode, useEffect, useRef } from "react";

interface ModalProps {
	title: string;
	onClose: () => void;
	children: ReactNode;
}

export const Modal = memo(function Modal({ title, onClose, children }: ModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击背景关闭模态框是标准交互
		<div
			className="modal-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
				<header className="modal-header">
					<h2 className="modal-title">{title}</h2>
					<button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
						×
					</button>
				</header>
				<div className="modal-body">{children}</div>
			</div>
		</div>
	);
});
