/**
 * Ableton-style Set Builder timeline shortcuts.
 *
 * Z — smart zoom in (selected clip or visible range)
 * X — zoom back to previous view
 * +/= — progressive zoom in
 * -   — progressive zoom out
 * H   — maximize all lane heights
 * W   — fit entire set horizontally
 */
import { useEffect, useCallback } from "react";
import { ZOOM_BUTTON_FACTOR, zoomAtAnchor } from "../lib/timelineViewportZoom";
import { useSetTimelineStore } from "../stores/setTimelineStore";
import { MIN_PX_PER_SEC, maxPxPerSecForViewport } from "../components/setbuilder/setTimelineLayout";
import { useStudioLaneStore, MAX_LANE_TOTAL_H } from "../stores/studioLaneStore";
import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

interface Options {
  enabled?: boolean;
  lanes: LaneLayout[];
  selectedCardId: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  syncDomScroll: () => void;
  /** Ableton-style zoom anchor at playhead. */
  readZoomAnchorViewportX: () => number;
  /** When true, scroll/zoom state lives in the store (native GPU embed). */
  nativeActive?: boolean;
}

export function useSetTimelineShortcuts({
  enabled = true,
  lanes,
  selectedCardId,
  scrollRef,
  syncDomScroll,
  readZoomAnchorViewportX,
  nativeActive = false,
}: Options) {
  const readScrollLeft = useCallback(() => {
    if (nativeActive) return useSetTimelineStore.getState().scrollLeft;
    return scrollRef.current?.scrollLeft ?? 0;
  }, [nativeActive, scrollRef]);

  const applyScrollLeft = useCallback((left: number) => {
    if (!nativeActive) {
      const el = scrollRef.current;
      if (el) el.scrollLeft = left;
    }
    syncDomScroll();
  }, [nativeActive, scrollRef, syncDomScroll]);

  const applyZoomStep = useCallback((factor: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const store = useSetTimelineStore.getState();
    const maxPps = maxPxPerSecForViewport(el.clientWidth);
    const result = zoomAtAnchor({
      oldPps: store.pixelsPerSecond,
      factor,
      scrollLeft: readScrollLeft(),
      anchorViewportX: readZoomAnchorViewportX(),
      minPps: MIN_PX_PER_SEC,
      maxPps,
    });
    if (!result) return;
    store.setView(result.newPps, result.newScrollLeft);
    applyScrollLeft(result.newScrollLeft);
  }, [scrollRef, readScrollLeft, applyScrollLeft, readZoomAnchorViewportX]);

  const smartZoomIn = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const store = useSetTimelineStore.getState();
    store.pushZoomSnapshot();

    const selected = selectedCardId
      ? lanes.find(l => l.card.id === selectedCardId)
      : null;

    if (selected) {
      store.zoomToTimeRange(selected.startSec, selected.endSec, el.clientWidth);
    } else {
      const pps = store.pixelsPerSecond;
      const left = readScrollLeft();
      const t0 = left / pps;
      const t1 = (left + el.clientWidth) / pps;
      const midSpan = (t1 - t0) * 0.35;
      const center = (t0 + t1) / 2;
      store.zoomToTimeRange(center - midSpan / 2, center + midSpan / 2, el.clientWidth);
    }
    syncDomScroll();
  }, [scrollRef, syncDomScroll, readScrollLeft, lanes, selectedCardId]);

  const restoreZoom = useCallback(() => {
    if (useSetTimelineStore.getState().restorePreviousZoom()) {
      syncDomScroll();
    }
  }, [syncDomScroll]);

  const fitWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el || lanes.length === 0) return;
    const totalSec = Math.max(...lanes.map(l => l.endSec));
    useSetTimelineStore.getState().fitToDuration(totalSec, el.clientWidth);
    useSetTimelineStore.getState().setScrollLeft(0);
    applyScrollLeft(0);
  }, [scrollRef, applyScrollLeft, lanes]);

  const maximizeLanes = useCallback(() => {
    const setLaneHeight = useStudioLaneStore.getState().setLaneHeight;
    for (let i = 0; i < lanes.length; i++) {
      setLaneHeight(i, MAX_LANE_TOTAL_H);
    }
  }, [lanes]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (key === "z" || key === "Z") {
        e.preventDefault();
        smartZoomIn();
        return;
      }
      if (key === "x" || key === "X") {
        e.preventDefault();
        restoreZoom();
        return;
      }
      if (key === "w" || key === "W") {
        e.preventDefault();
        fitWidth();
        return;
      }
      if (key === "h" || key === "H") {
        e.preventDefault();
        maximizeLanes();
        return;
      }
      if (key === "+" || key === "=" || key === "Plus") {
        e.preventDefault();
        applyZoomStep(ZOOM_BUTTON_FACTOR);
        return;
      }
      if (key === "-" || key === "_" || key === "Minus") {
        e.preventDefault();
        applyZoomStep(1 / ZOOM_BUTTON_FACTOR);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    enabled,
    smartZoomIn,
    restoreZoom,
    fitWidth,
    maximizeLanes,
    applyZoomStep,
  ]);
}
