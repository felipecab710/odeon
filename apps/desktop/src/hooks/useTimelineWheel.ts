/**
 * Timeline wheel — cursor-anchored live layout zoom.
 */
import { useEffect, useRef, useCallback } from "react";
import {
  markZoomActivity,
  flushZoomCommitNow,
  setGestureBaselinePps,
  isZooming,
} from "../lib/zoomInteraction";
import {
  applyZoomGesture,
  peekZoomCommit,
  registerWheelZoomCancel,
  clearZoomGesture,
} from "../lib/zoomGestureViewport";
import {
  beginZoomGestureAnchor,
  clearZoomGestureAnchor,
  getZoomAnchorViewportX,
  updateTimelineCursor,
  clearTimelineCursor,
} from "../lib/setTimelineViewport";
import type { SetTimelineContext } from "../lib/setTimelineContext";
import {
  isZoomWheelEvent,
  wheelStepsFromEvent,
  zoomMultiplierFromSteps,
  zoomAtAnchor,
} from "../lib/timelineViewportZoom";
import {
  MIN_PX_PER_SEC,
  maxPxPerSecForViewport,
} from "../components/setbuilder/setTimelineLayout";
import { useSetTimelineStore } from "../stores/setTimelineStore";

interface WebKitGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
}

interface Options {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  zoneRef?: React.RefObject<HTMLElement | null>;
  setScrollLeft: (px: number) => void;
  readScrollLeft: () => number;
  enabled?: boolean;
  lanesKey?: number;
  onViewportChange?: (left: number, width: number) => void;
  /** Current timeline context for cursor / zoom anchor hit-testing. */
  readTimelineContext: () => SetTimelineContext;
  /** Called when hover cursor time updates (edit cursor line + transport readout). */
  onCursorTime?: (timeSec: number) => void;
  /** Native GPU embed owns scroll via store — DOM scrollLeft stays 0. */
  nativeActive?: boolean;
}

export function useTimelineWheel({
  scrollRef,
  zoneRef,
  setScrollLeft,
  readScrollLeft,
  enabled = true,
  lanesKey = 0,
  onViewportChange,
  readTimelineContext,
  onCursorTime,
  nativeActive = false,
}: Options) {
  const wheelStepsAccum = useRef(0);
  const wheelRaf = useRef<number | null>(null);
  const pinchScaleRef = useRef(1);
  const wheelClientXRef = useRef<number | null>(null);
  const cursorRaf = useRef<number | null>(null);

  const notifyViewport = useCallback((el: HTMLDivElement) => {
    onViewportChange?.(el.scrollLeft, el.clientWidth);
  }, [onViewportChange]);

  const syncDomScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = readScrollLeft();
    notifyViewport(el);
  }, [scrollRef, readScrollLeft, notifyViewport]);

  const trackCursor = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    if (cursorRaf.current !== null) cancelAnimationFrame(cursorRaf.current);
    cursorRaf.current = requestAnimationFrame(() => {
      cursorRaf.current = null;
      const { timeSec } = updateTimelineCursor(clientX, el, readTimelineContext().toParams());
      onCursorTime?.(timeSec);
    });
  }, [scrollRef, readTimelineContext, onCursorTime]);

  const applyNativeZoom = useCallback((e: WheelEvent) => {
    const steps = wheelStepsFromEvent(e);
    if (Math.abs(steps) < 1e-9) return;
    const el = scrollRef.current;
    if (!el) return;
    const store = useSetTimelineStore.getState();
    trackCursor(e.clientX);
    const metrics = readTimelineContext().toParams();
    const anchorViewportX = getZoomAnchorViewportX(
      updateTimelineCursor(e.clientX, el, metrics).viewportX,
    );
    const maxPps = maxPxPerSecForViewport(el.clientWidth);
    const result = zoomAtAnchor({
      oldPps: store.pixelsPerSecond,
      factor: zoomMultiplierFromSteps(steps),
      scrollLeft: readScrollLeft(),
      anchorViewportX,
      minPps: MIN_PX_PER_SEC,
      maxPps,
    });
    if (!result) return;
    clearZoomGesture();
    store.setView(result.newPps, result.newScrollLeft);
    setScrollLeft(result.newScrollLeft);
    notifyViewport(el);
  }, [scrollRef, readTimelineContext, trackCursor, readScrollLeft, setScrollLeft, notifyViewport]);

  const applyGestureStep = useCallback((factor: number, clientX: number) => {
    if (Math.abs(factor - 1) < 1e-9) return false;
    const el = scrollRef.current;
    if (!el) return false;

    const metrics = readTimelineContext().toParams();
    trackCursor(clientX);

    const store = useSetTimelineStore.getState();
    if (!isZooming()) {
      setGestureBaselinePps(store.pixelsPerSecond);
      beginZoomGestureAnchor(clientX, el, metrics);
    }
    markZoomActivity();

    const anchorViewportX = getZoomAnchorViewportX(
      updateTimelineCursor(clientX, el, metrics).viewportX,
    );
    const currentScrollLeft = nativeActive ? readScrollLeft() : el.scrollLeft;
    const maxPps = maxPxPerSecForViewport(el.clientWidth);
    const ok = applyZoomGesture(
      factor,
      anchorViewportX,
      currentScrollLeft,
      store.pixelsPerSecond,
      MIN_PX_PER_SEC,
      maxPps,
    );
    if (!ok) return false;

    const commit = peekZoomCommit();
    if (!commit) return false;

    store.setView(commit.pixelsPerSecond, commit.scrollLeft);
    if (!nativeActive) {
      el.scrollLeft = commit.scrollLeft;
    } else {
      setScrollLeft(commit.scrollLeft);
    }
    notifyViewport(el);
    return true;
  }, [scrollRef, readTimelineContext, trackCursor, notifyViewport, nativeActive, readScrollLeft, setScrollLeft]);

  const flushWheelZoom = useCallback(() => {
    wheelRaf.current = null;
    const steps = wheelStepsAccum.current;
    wheelStepsAccum.current = 0;
    if (Math.abs(steps) < 1e-6) return;

    const el = scrollRef.current;
    if (!el) return;
    const clientX = wheelClientXRef.current ?? el.getBoundingClientRect().left + el.clientWidth * 0.5;
    applyGestureStep(zoomMultiplierFromSteps(steps), clientX);
  }, [applyGestureStep]);

  const queueWheelZoom = useCallback((e: WheelEvent) => {
    wheelClientXRef.current = e.clientX;
    wheelStepsAccum.current += wheelStepsFromEvent(e);
    if (wheelRaf.current === null) {
      wheelRaf.current = requestAnimationFrame(flushWheelZoom);
    }
  }, [flushWheelZoom]);

  useEffect(() => {
    if (!enabled) return;

    const cancelPending = () => {
      wheelStepsAccum.current = 0;
      wheelClientXRef.current = null;
      if (wheelRaf.current !== null) {
        cancelAnimationFrame(wheelRaf.current);
        wheelRaf.current = null;
      }
    };
    registerWheelZoomCancel(cancelPending);

    const inZone = (target: EventTarget | null) => {
      const zone = zoneRef?.current ?? scrollRef.current;
      if (!zone || !target) return false;
      return zone.contains(target as Node);
    };

    const onWheelCapture = (e: WheelEvent) => {
      if (!inZone(e.target)) return;

      if (isZoomWheelEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (nativeActive) {
          applyNativeZoom(e);
          return;
        }
        queueWheelZoom(e);
        return;
      }

      const el = scrollRef.current;
      if (!el) return;

      if (nativeActive) {
        e.preventDefault();
        e.stopPropagation();
        const sl = readScrollLeft();
        if (e.shiftKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          const delta = e.shiftKey ? e.deltaY : -e.deltaY;
          setScrollLeft(Math.max(0, sl + delta));
        } else if (Math.abs(e.deltaX) > 0) {
          setScrollLeft(Math.max(0, sl + e.deltaX));
        }
        notifyViewport(el);
        return;
      }

      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const next = el.scrollLeft + e.deltaY;
        el.scrollLeft = next;
        setScrollLeft(next);
        notifyViewport(el);
        return;
      }

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        e.stopPropagation();
        const next = el.scrollLeft + e.deltaX;
        el.scrollLeft = next;
        setScrollLeft(next);
        notifyViewport(el);
      }
    };

    document.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });

    const scrollEl = scrollRef.current;
    const gestureEl = zoneRef?.current ?? scrollEl;

    const onScroll = () => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      setScrollLeft(scroll.scrollLeft);
      notifyViewport(scroll);
    };

    const onMouseMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (!el || !inZone(e.target)) return;
      trackCursor(e.clientX);
    };

    const onMouseLeave = () => {
      clearTimelineCursor();
    };

    if (scrollEl) {
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
      scrollEl.addEventListener("mouseleave", onMouseLeave);
      notifyViewport(scrollEl);
    }
    document.addEventListener("mousemove", onMouseMove, { passive: true });

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinchScaleRef.current = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as WebKitGestureEvent;
      const prev = pinchScaleRef.current;
      const factor = ge.scale / prev;
      pinchScaleRef.current = ge.scale;
      if (Math.abs(factor - 1) < 0.0005) return;

      applyGestureStep(factor, ge.clientX);
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinchScaleRef.current = 1;
      cancelPending();
      flushZoomCommitNow();
      clearZoomGestureAnchor();
    };

    if (gestureEl) {
      gestureEl.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
      gestureEl.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
      gestureEl.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    }

    // Native Metal layer blocks DOM wheel/gesture on lanes — also listen at document level for rulers/minimap.
    if (nativeActive) {
      document.addEventListener("gesturestart", onGestureStart as EventListener, { capture: true, passive: false });
      document.addEventListener("gesturechange", onGestureChange as EventListener, { capture: true, passive: false });
      document.addEventListener("gestureend", onGestureEnd as EventListener, { capture: true, passive: false });
    }

    return () => {
      registerWheelZoomCancel(null);
      document.removeEventListener("wheel", onWheelCapture, { capture: true });
      document.removeEventListener("mousemove", onMouseMove);
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", onScroll);
        scrollEl.removeEventListener("mouseleave", onMouseLeave);
      }
      if (gestureEl) {
        gestureEl.removeEventListener("gesturestart", onGestureStart as EventListener);
        gestureEl.removeEventListener("gesturechange", onGestureChange as EventListener);
        gestureEl.removeEventListener("gestureend", onGestureEnd as EventListener);
      }
      if (nativeActive) {
        document.removeEventListener("gesturestart", onGestureStart as EventListener, { capture: true });
        document.removeEventListener("gesturechange", onGestureChange as EventListener, { capture: true });
        document.removeEventListener("gestureend", onGestureEnd as EventListener, { capture: true });
      }
      if (wheelRaf.current !== null) cancelAnimationFrame(wheelRaf.current);
      if (cursorRaf.current !== null) cancelAnimationFrame(cursorRaf.current);
      clearZoomGestureAnchor();
    };
  }, [
    enabled,
    lanesKey,
    scrollRef,
    zoneRef,
    setScrollLeft,
    notifyViewport,
    queueWheelZoom,
    applyGestureStep,
    trackCursor,
    nativeActive,
    readScrollLeft,
    applyNativeZoom,
  ]);

  return { syncDomScroll };
}
