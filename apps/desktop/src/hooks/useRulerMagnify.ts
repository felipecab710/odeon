/**
 * Ableton magnifying tool — drag on timeline ruler (cursor-anchored zoom camera).
 */
import { useCallback, useRef } from "react";
import { markZoomActivity } from "../lib/zoomInteraction";
import {
  applyZoomGestureAbsolute,
  flushZoomCommit,
} from "../lib/zoomGestureViewport";
import { setZoomCursorAnchor } from "../lib/zoomCursorAnchor";
import { clampPxPerSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC } from "../components/setbuilder/setTimelineLayout";
import { useSetTimelineStore } from "../stores/setTimelineStore";

const DRAG_PX_PER_OCTAVE = 72;
const TAP_THRESHOLD_PX = 4;

interface Options {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  syncDomScroll: () => void;
  onRulerSeek?: (clientX: number) => void;
}

export function useRulerMagnify({ scrollRef, syncDomScroll, onRulerSeek }: Options) {
  const dragRef = useRef<{
    startY: number;
    baselinePps: number;
    anchorX: number;
    magnified: boolean;
  } | null>(null);

  const anchorFromClientX = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(el.clientWidth, clientX - rect.left));
  }, [scrollRef]);

  const applyDragZoom = useCallback((clientY: number) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !el) return;

    const dy = clientY - drag.startY;
    if (Math.abs(dy) > TAP_THRESHOLD_PX) drag.magnified = true;

    const factor = Math.pow(2, dy / DRAG_PX_PER_OCTAVE);
    const targetPps = clampPxPerSec(drag.baselinePps * factor);

    setZoomCursorAnchor(drag.anchorX);
    markZoomActivity();
    const committedPps = useSetTimelineStore.getState().pixelsPerSecond;
    applyZoomGestureAbsolute(
      targetPps,
      drag.anchorX,
      el.scrollLeft,
      committedPps,
      MIN_PX_PER_SEC,
      MAX_PX_PER_SEC,
    );
  }, [scrollRef]);

  const onRulerPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const store = useSetTimelineStore.getState();
    store.pushZoomSnapshot();

    dragRef.current = {
      startY: e.clientY,
      baselinePps: store.pixelsPerSecond,
      anchorX: anchorFromClientX(e.clientX),
      magnified: false,
    };
  }, [anchorFromClientX]);

  const onRulerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    applyDragZoom(e.clientY);
  }, [applyDragZoom]);

  const onRulerPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (!drag.magnified && Math.abs(e.clientY - drag.startY) <= TAP_THRESHOLD_PX) {
      onRulerSeek?.(e.clientX);
    } else if (drag.magnified) {
      flushZoomCommit();
      syncDomScroll();
    }

    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [onRulerSeek, syncDomScroll]);

  return {
    onRulerPointerDown,
    onRulerPointerMove,
    onRulerPointerUp,
    onRulerPointerCancel: onRulerPointerUp,
  };
};
