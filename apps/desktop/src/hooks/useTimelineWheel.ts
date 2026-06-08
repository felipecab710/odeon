/**
 * Timeline wheel — cursor-anchored buttery zoom camera (CSS scale during gesture).
 */
import { useEffect, useRef, useCallback } from "react";
import { markZoomActivity } from "../lib/zoomInteraction";
import {
  applyZoomGesture,
  getGestureViewport,
} from "../lib/zoomGestureViewport";
import { setZoomCursorAnchor } from "../lib/zoomCursorAnchor";
import {
  isZoomWheelEvent,
  wheelStepsFromEvent,
  zoomMultiplierFromSteps,
} from "../lib/timelineViewportZoom";
import {
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
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
}

function anchorFromClientX(scrollEl: HTMLDivElement, clientX: number): number {
  const rect = scrollEl.getBoundingClientRect();
  return Math.max(0, Math.min(scrollEl.clientWidth, clientX - rect.left));
}

export function useTimelineWheel({
  scrollRef,
  zoneRef,
  setScrollLeft,
  readScrollLeft,
  enabled = true,
  lanesKey = 0,
  onViewportChange,
}: Options) {
  const wheelStepsAccum = useRef(0);
  const wheelRaf = useRef<number | null>(null);
  const pinchScaleRef = useRef(1);
  const wheelClientXRef = useRef<number | null>(null);

  const notifyViewport = useCallback((el: HTMLDivElement, includeScroll = true) => {
    onViewportChange?.(includeScroll ? el.scrollLeft : getGestureViewport().liveScrollLeft, el.clientWidth);
  }, [onViewportChange]);

  const syncDomScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gesture = getGestureViewport();
    el.scrollLeft = gesture.active ? gesture.liveScrollLeft : readScrollLeft();
    notifyViewport(el, !gesture.active);
  }, [scrollRef, readScrollLeft, notifyViewport]);

  const applyGestureStep = useCallback((factor: number, anchorViewportX: number) => {
    if (Math.abs(factor - 1) < 1e-9) return false;
    const el = scrollRef.current;
    if (!el) return false;

    setZoomCursorAnchor(anchorViewportX);
    markZoomActivity();

    const committedPps = useSetTimelineStore.getState().pixelsPerSecond;
    // Scroll stays frozen during gesture — only CSS scaleX moves the world.
    // Committed scroll + pps apply on gesture end (flushZoomCommit).
    return applyZoomGesture(
      factor,
      anchorViewportX,
      el.scrollLeft,
      committedPps,
      MIN_PX_PER_SEC,
      MAX_PX_PER_SEC,
    );
  }, [scrollRef]);

  const flushWheelZoom = useCallback(() => {
    wheelRaf.current = null;
    const steps = wheelStepsAccum.current;
    wheelStepsAccum.current = 0;
    if (Math.abs(steps) < 1e-6) return;

    const el = scrollRef.current;
    if (!el) return;
    const anchor = wheelClientXRef.current ?? el.clientWidth * 0.5;
    applyGestureStep(zoomMultiplierFromSteps(steps), anchor);
  }, [applyGestureStep]);

  const queueWheelZoom = useCallback((e: WheelEvent) => {
    const el = scrollRef.current;
    if (el) {
      wheelClientXRef.current = anchorFromClientX(el, e.clientX);
    }
    wheelStepsAccum.current += wheelStepsFromEvent(e);
    if (wheelRaf.current === null) {
      wheelRaf.current = requestAnimationFrame(flushWheelZoom);
    }
  }, [flushWheelZoom]);

  useEffect(() => {
    if (!enabled) return;

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
        queueWheelZoom(e);
        return;
      }

      const el = scrollRef.current;
      if (!el) return;

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
      if (!getGestureViewport().active) {
        setScrollLeft(scroll.scrollLeft);
        notifyViewport(scroll);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (!el || !inZone(e.target)) return;
      setZoomCursorAnchor(anchorFromClientX(el, e.clientX));
    };

    if (scrollEl) {
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
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

      const scroll = scrollRef.current;
      if (!scroll) return;
      const anchor = anchorFromClientX(scroll, ge.clientX);
      applyGestureStep(factor, anchor);
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinchScaleRef.current = 1;
    };

    if (gestureEl) {
      gestureEl.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
      gestureEl.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
      gestureEl.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    }

    return () => {
      document.removeEventListener("wheel", onWheelCapture, { capture: true });
      document.removeEventListener("mousemove", onMouseMove);
      if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
      if (gestureEl) {
        gestureEl.removeEventListener("gesturestart", onGestureStart as EventListener);
        gestureEl.removeEventListener("gesturechange", onGestureChange as EventListener);
        gestureEl.removeEventListener("gestureend", onGestureEnd as EventListener);
      }
      if (wheelRaf.current !== null) cancelAnimationFrame(wheelRaf.current);
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
  ]);

  return { syncDomScroll };
}
