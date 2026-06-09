/**
 * Ableton magnifying tool — drag on timeline ruler (live anchored zoom).
 */
import { useCallback, useRef } from "react";
import { markZoomActivity, flushZoomCommitNow, setGestureBaselinePps, isZooming } from "../lib/zoomInteraction";
import { applyZoomGestureAbsolute, peekZoomCommit } from "../lib/zoomGestureViewport";
import { clampPxPerSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC } from "../components/setbuilder/setTimelineLayout";
import { useSetTimelineStore } from "../stores/setTimelineStore";
import {
  beginZoomGestureAnchor,
  clearZoomGestureAnchor,
  getZoomAnchorViewportX,
} from "../lib/setTimelineViewport";
import type { SetTimelineContext } from "../lib/setTimelineContext";

const DRAG_PX_PER_OCTAVE = 72;
const TAP_THRESHOLD_PX = 4;

interface Options {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  syncDomScroll: () => void;
  onViewportChange?: (left: number, width: number) => void;
  onRulerSeek?: (clientX: number) => void;
  readTimelineContext: () => SetTimelineContext;
}

export function useRulerMagnify({
  scrollRef,
  syncDomScroll,
  onViewportChange,
  onRulerSeek,
  readTimelineContext,
}: Options) {
  const dragRef = useRef<{
    startY: number;
    baselinePps: number;
    startScrollLeft: number;
    magnified: boolean;
  } | null>(null);

  const applyDragZoom = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !el) return;

    const dy = clientY - drag.startY;
    if (Math.abs(dy) > TAP_THRESHOLD_PX) drag.magnified = true;

    const factor = Math.pow(2, dy / DRAG_PX_PER_OCTAVE);
    const targetPps = clampPxPerSec(drag.baselinePps * factor);

    const metrics = readTimelineContext().toParams();
    if (!isZooming()) {
      setGestureBaselinePps(useSetTimelineStore.getState().pixelsPerSecond);
      beginZoomGestureAnchor(clientX, el, metrics);
    }
    markZoomActivity();

    const store = useSetTimelineStore.getState();
    const ok = applyZoomGestureAbsolute(
      targetPps,
      getZoomAnchorViewportX(0),
      el.scrollLeft,
      store.pixelsPerSecond,
      MIN_PX_PER_SEC,
      MAX_PX_PER_SEC,
    );
    if (!ok) return;

    const commit = peekZoomCommit();
    if (!commit) return;

    store.setView(commit.pixelsPerSecond, commit.scrollLeft);
    el.scrollLeft = commit.scrollLeft;
    onViewportChange?.(commit.scrollLeft, el.clientWidth);
  }, [scrollRef, readTimelineContext, onViewportChange]);

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
      startScrollLeft: scrollRef.current?.scrollLeft ?? store.scrollLeft,
      magnified: false,
    };
  }, [scrollRef]);

  const onRulerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    applyDragZoom(e.clientX, e.clientY);
  }, [applyDragZoom]);

  const onRulerPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (!drag.magnified && Math.abs(e.clientY - drag.startY) <= TAP_THRESHOLD_PX) {
      onRulerSeek?.(e.clientX);
    } else if (drag.magnified) {
      flushZoomCommitNow();
      clearZoomGestureAnchor();
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
