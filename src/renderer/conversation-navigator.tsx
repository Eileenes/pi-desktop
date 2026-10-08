import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useI18n } from "./i18n.ts";
import type { ConversationTurn } from "./transcript-group.ts";

interface ConversationNavigatorProps {
	turns: ConversationTurn[];
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	onSelect: (messageId: string) => void;
}

function nearestTurnIndex(event: ReactPointerEvent<HTMLDivElement>, count: number): number {
	const rect = event.currentTarget.getBoundingClientRect();
	const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
	return Math.min(count - 1, Math.round(ratio * (count - 1)));
}

export function ConversationNavigator({ turns, scrollContainerRef, onSelect }: ConversationNavigatorProps) {
	const { t } = useI18n();
	const [activeIndex, setActiveIndex] = useState(0);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const draggingRef = useRef(false);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!container || turns.length < 2) return;
		const updateActive = () => {
			const containerTop = container.getBoundingClientRect().top;
			const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-conversation-turn]"));
			if (anchors.length === 0) return;
			let closest = 0;
			let closestDistance = Number.POSITIVE_INFINITY;
			for (const anchor of anchors) {
				const index = Number(anchor.dataset.conversationTurn);
				const distance = Math.abs(anchor.getBoundingClientRect().top - containerTop - 28);
				if (distance < closestDistance) {
					closest = index;
					closestDistance = distance;
				}
			}
			setActiveIndex(closest);
		};
		updateActive();
		container.addEventListener("scroll", updateActive, { passive: true });
		const observer = new ResizeObserver(updateActive);
		observer.observe(container);
		return () => {
			container.removeEventListener("scroll", updateActive);
			observer.disconnect();
		};
	}, [scrollContainerRef, turns.length]);

	const selectFromPointer = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (turns.length === 0) return;
			const index = nearestTurnIndex(event, turns.length);
			setPreviewIndex(index);
			setActiveIndex(index);
			const turn = turns[index];
			if (turn) onSelect(turn.messageId);
		},
		[onSelect, turns],
	);

	const preview = previewIndex == null ? null : turns[previewIndex];
	const tickPositions = useMemo(() => turns.map((turn, index) => ({ ...turn, top: 1 + index * 10 })), [turns]);

	if (turns.length < 2) return null;

	return (
		<div
			className="absolute top-4 right-2.5 z-[4] w-[18px]"
			style={{ height: turns.length * 2 + (turns.length - 1) * 8 }}
			onPointerLeave={() => {
				if (!draggingRef.current) setPreviewIndex(null);
			}}
		>
			{preview ? (
				<output className="pointer-events-none absolute top-0 right-[22px] z-[5] grid w-[260px] gap-1 rounded-[var(--radius-s)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2.5 py-2 shadow-[var(--shadow-float)]">
					<div className="truncate text-[length:var(--text-xs)] font-semibold text-[color:var(--text)]">
						{preview.question || "…"}
					</div>
					<div className="line-clamp-3 overflow-hidden text-[length:var(--text-2xs)] text-[color:var(--muted)]">
						{preview.answer || "…"}
					</div>
				</output>
			) : null}
			<div
				className="relative h-full w-full cursor-pointer"
				role="slider"
				aria-label={t("conversationLocate")}
				aria-valuemin={1}
				aria-valuemax={turns.length}
				aria-valuenow={activeIndex + 1}
				tabIndex={0}
				onBlur={() => {
					if (!draggingRef.current) setPreviewIndex(null);
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					const next = Math.max(0, Math.min(turns.length - 1, activeIndex + (event.key === "ArrowUp" ? -1 : 1)));
					setActiveIndex(next);
					setPreviewIndex(next);
					const turn = turns[next];
					if (turn) onSelect(turn.messageId);
				}}
				onPointerDown={(event) => {
					draggingRef.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
					selectFromPointer(event);
				}}
				onPointerMove={(event) => {
					const index = nearestTurnIndex(event, turns.length);
					setPreviewIndex(index);
					if (draggingRef.current && index !== activeIndex) {
						setActiveIndex(index);
						const turn = turns[index];
						if (turn) onSelect(turn.messageId);
					}
				}}
				onPointerUp={(event) => {
					draggingRef.current = false;
					event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onPointerCancel={() => {
					draggingRef.current = false;
				}}
			>
				{tickPositions.map((turn, index) => {
					const previewDistance = previewIndex == null ? null : Math.abs(index - previewIndex);
					return (
						<span
							key={turn.messageId}
							className={`absolute right-1 h-0.5 rounded-px ${index === activeIndex ? "w-3 bg-[var(--accent)] opacity-100" : index === previewIndex ? "w-2 bg-[var(--text)] opacity-100" : previewDistance === 1 ? "w-2 bg-[var(--muted)] opacity-70" : previewDistance === 2 ? "w-2 bg-[var(--muted)] opacity-55" : "w-2 bg-[var(--muted)] opacity-40"}`}
							style={{ top: turn.top }}
						/>
					);
				})}
			</div>
		</div>
	);
}
