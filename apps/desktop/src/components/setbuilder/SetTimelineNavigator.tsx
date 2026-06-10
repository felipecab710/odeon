/**
 * Ableton-style arrangement overview — shows full set, visible viewport box,
 * playhead. Drag box to scroll, drag edges to zoom, vertical drag to zoom at cursor.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushZoomCommitNow, markZoomActivity, setGestureBaselinePps, setGestureAnchorTimelineX, isZooming } from "../../lib/zoomInteraction";
import { useSetTimelineStore } from "../../stores/setTimelineStore";
import {
  clampPxPerSec,
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
  type LaneLayout,
} from "./setTimelineLayout";
import { zoomAtAnchor } from "../../lib/timelineViewportZoom";
import { SetMinimapClip } from "./SetMinimapClip";

const HANDLE_W = 8;
const MIN_BOX_PX = 2;

interface ViewportMetrics {
  startSec: number;
  spanSec: number;
  pps: number;
  scrollLeft: number;
}

function resolveViewport(
  totalSec: number,
  scrollLeftOverride: number | null,
  viewportWidth: number,
): ViewportMetrics | null {
  if (totalSec <= 0 || viewportWidth < 1) return null;

  const committed = useSetTimelineStore.getState();
  const pps = committed.pixelsPerSecond;
  const scroll = scrollLeftOverride ?? committed.scrollLeft;
  const spanSec = viewportWidth / pps;
  const maxStart = Math.max(0, totalSec - spanSec);
  const startSec = Math.max(0, Math.min(maxStart, scroll / pps));
  const visibleSpanSec = Math.min(spanSec, totalSec - startSec);

  return { startSec, spanSec: visibleSpanSec, pps, scrollLeft: scroll };
}

function boxPixels(
  metrics: ViewportMetrics,
  totalSec: number,
  trackWidth: number,
): { leftPx: number; widthPx: number } {
  if (totalSec <= 0 || trackWidth <= 0) {
    return { leftPx: 0, widthPx: trackWidth };
  }
  const leftPx = (metrics.startSec / totalSec) * trackWidth;
  const widthPx = Math.max(MIN_BOX_PX, (metrics.spanSec / totalSec) * trackWidth);
  return {
    leftPx,
    widthPx: Math.min(widthPx, Math.max(MIN_BOX_PX, trackWidth - leftPx)),
  };
}

type DragMode =
  | { kind: "pan"; startX: number; startSec: number; spanSec: number; pps: number }
  | { kind: "resize-left"; endSec: number }
  | { kind: "resize-right"; startSec: number }
  | { kind: "zoom"; startY: number; baselinePps: number; startScrollLeft: number; anchorViewportX: number }
  | { kind: "pending"; startX: number; startY: number; startSec: number; spanSec: number; pps: number };

interface Props {
  lanes: LaneLayout[];
  totalSec: number;
  scrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  playheadSec: number;
  transitionIndex: number | null;
  laneColors: string[];
  leftInset?: number;
  onScroll: (scrollLeft: number) => void;
  onViewChange: (pps: number, scrollLeft: number) => void;
  onSeek: (timeSec: number) => void;
  onLaneClick: (laneIndex: number) => void;
}

export const SetTimelineNavigator = memo(function SetTimelineNavigator({
  lanes,
  totalSec,
  scrollLeft: _scrollLeft,
  viewportWidth,
  pixelsPerSecond: _pixelsPerSecond,
  playheadSec,
  transitionIndex,
  laneColors,
  leftInset = 0,
  onScroll,
  onViewChange,
  onSeek,
  onLaneClick,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dimLeftRef = useRef<HTMLDivElement>(null);
  const dimRightRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const movedRef = useRef(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragScrollLeft, setDragScrollLeft] = useState<number | null>(null);
  const liveScrollLeft = useSetTimelineStore(s => s.scrollLeft);
  const livePps = useSetTimelineStore(s => s.pixelsPerSecond);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTrackWidth(el.clientWidth);
    });
    ro.observe(el);
    setTrackWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lastViewportWidthRef = useRef(viewportWidth);
  if (viewportWidth > 0) lastViewportWidthRef.current = viewportWidth;

  const paintBox = useCallback((left: number, width: number, trackW: number) => {
    const box = boxRef.current;
    if (box) {
      box.style.left = `${left}px`;
      box.style.width = `${width}px`;
    }
    const dimL = dimLeftRef.current;
    const dimR = dimRightRef.current;
    if (dimL) {
      dimL.style.width = `${Math.max(0, left)}px`;
      dimL.style.display = left > 0.5 ? "block" : "none";
    }
    if (dimR) {
      const rightW = Math.max(0, trackW - left - width);
      dimR.style.left = `${left + width}px`;
      dimR.style.width = `${rightW}px`;
      dimR.style.display = rightW > 0.5 ? "block" : "none";
    }
  }, []);

  const paintViewportBox = useCallback((
    sec: number,
    scrollOverride: number | null,
    navW: number,
  ) => {
    if (navW < 1 || sec <= 0) return;
    const vw = Math.max(navW, lastViewportWidthRef.current, viewportWidth, 1);
    const metrics = resolveViewport(sec, scrollOverride, vw);
    if (!metrics) return;
    const { leftPx, widthPx } = boxPixels(metrics, sec, navW);
    paintBox(leftPx, widthPx, navW);
  }, [paintBox, viewportWidth]);

  useLayoutEffect(() => {
    const navW = trackWidth > 0 ? trackWidth : trackRef.current?.clientWidth ?? 0;
    paintViewportBox(totalSec, dragScrollLeft, navW);
  }, [totalSec, dragScrollLeft, trackWidth, liveScrollLeft, livePps, viewportWidth, paintViewportBox]);

  const timeFromNavX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || totalSec <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * totalSec;
  }, [totalSec]);

  const anchorViewportXFromNavX = useCallback((clientX: number, pps: number, scroll: number) => {
    const t = timeFromNavX(clientX);
    return t * pps - scroll;
  }, [timeFromNavX]);

  const readMetrics = useCallback((): ViewportMetrics | null => {
    const track = trackRef.current;
    const navW = trackWidth > 0 ? trackWidth : track?.clientWidth ?? 0;
    if (navW < 1) return null;
    const vw = Math.max(navW, lastViewportWidthRef.current, viewportWidth, 1);
    return resolveViewport(totalSec, dragScrollLeft, vw);
  }, [totalSec, dragScrollLeft, trackWidth, viewportWidth]);

  const applySpan = useCallback((startSec: number, endSec: number) => {
    if (viewportWidth < 1 || totalSec <= 0) return;
    flushZoomCommitNow();
    const span = Math.max(0.25, endSec - startSec);
    const pps = clampPxPerSec(viewportWidth / span);
    const scroll = Math.max(0, startSec * pps);
    onViewChange(pps, scroll);
  }, [viewportWidth, totalSec, onViewChange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || totalSec <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const track = trackRef.current;
    if (!track) return;

    const metrics = readMetrics();
    if (!metrics) return;

    const rect = track.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const navW = rect.width;
    const leftPx = (metrics.startSec / totalSec) * navW;
    const widthPx = Math.max(MIN_BOX_PX, (metrics.spanSec / totalSec) * navW);
    const rightPx = leftPx + widthPx;

    movedRef.current = false;
    setDragScrollLeft(null);
    useSetTimelineStore.getState().pushZoomSnapshot();

    if (localX >= leftPx - HANDLE_W / 2 && localX <= leftPx + HANDLE_W / 2) {
      dragRef.current = { kind: "resize-left", endSec: metrics.startSec + metrics.spanSec };
    } else if (localX >= rightPx - HANDLE_W / 2 && localX <= rightPx + HANDLE_W / 2) {
      dragRef.current = { kind: "resize-right", startSec: metrics.startSec };
    } else if (localX > leftPx && localX < rightPx) {
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startSec: metrics.startSec,
        spanSec: metrics.spanSec,
        pps: metrics.pps,
      };
    } else {
      dragRef.current = {
        kind: "pending",
        startX: e.clientX,
        startY: e.clientY,
        startSec: metrics.startSec,
        spanSec: metrics.spanSec,
        pps: metrics.pps,
      };
    }
  }, [totalSec, readMetrics]);

  const updateHoverCursor = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || totalSec <= 0) return;
    const metrics = readMetrics();
    if (!metrics) return;
    const rect = track.getBoundingClientRect();
    const localX = clientX - rect.left;
    const navW = rect.width;
    const leftPx = (metrics.startSec / totalSec) * navW;
    const widthPx = Math.max(MIN_BOX_PX, (metrics.spanSec / totalSec) * navW);
    const rightPx = leftPx + widthPx;

    if (localX >= leftPx - HANDLE_W / 2 && localX <= leftPx + HANDLE_W / 2) {
      track.style.cursor = "ew-resize";
    } else if (localX >= rightPx - HANDLE_W / 2 && localX <= rightPx + HANDLE_W / 2) {
      track.style.cursor = "ew-resize";
    } else if (localX > leftPx && localX < rightPx) {
      track.style.cursor = "grab";
    } else {
      track.style.cursor = "ns-resize";
    }
  }, [totalSec, readMetrics]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      updateHoverCursor(e.clientX);
      return;
    }
    if (totalSec <= 0) return;
    e.preventDefault();

    const track = trackRef.current;
    if (!track) return;
    const navW = track.getBoundingClientRect().width;
    if (navW < 1) return;

    if (drag.kind === "pending") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      movedRef.current = true;

      if (Math.abs(dy) >= Math.abs(dx)) {
        const store = useSetTimelineStore.getState();
        dragRef.current = {
          kind: "zoom",
          startY: e.clientY,
          baselinePps: store.pixelsPerSecond,
          startScrollLeft: store.scrollLeft,
          anchorViewportX: anchorViewportXFromNavX(e.clientX, store.pixelsPerSecond, store.scrollLeft),
        };
      } else {
        dragRef.current = {
          kind: "pan",
          startX: drag.startX,
          startSec: drag.startSec,
          spanSec: drag.spanSec,
          pps: drag.pps,
        };
      }
      return;
    }

    movedRef.current = true;

    if (drag.kind === "pan") {
      track.style.cursor = "grabbing";
      flushZoomCommitNow();
      const deltaSec = ((e.clientX - drag.startX) / navW) * totalSec;
      const maxStart = Math.max(0, totalSec - drag.spanSec);
      const newStart = Math.max(0, Math.min(maxStart, drag.startSec + deltaSec));
      const newScroll = newStart * drag.pps;
      setDragScrollLeft(newScroll);
      paintBox(
        (newStart / totalSec) * navW,
        Math.max(MIN_BOX_PX, (drag.spanSec / totalSec) * navW),
        navW,
      );
      onScroll(newScroll);
      return;
    }

    if (drag.kind === "resize-left") {
      const newStart = Math.max(0, Math.min(drag.endSec - 0.25, timeFromNavX(e.clientX)));
      applySpan(newStart, drag.endSec);
      return;
    }

    if (drag.kind === "resize-right") {
      const newEnd = Math.min(totalSec, Math.max(drag.startSec + 0.25, timeFromNavX(e.clientX)));
      applySpan(drag.startSec, newEnd);
      return;
    }

    if (drag.kind === "zoom") {
      const dy = e.clientY - drag.startY;
      const targetPps = clampPxPerSec(drag.baselinePps * Math.pow(2, -dy / 56));
      if (!isZooming()) {
        setGestureBaselinePps(drag.baselinePps);
        setGestureAnchorTimelineX(drag.startScrollLeft + drag.anchorViewportX);
      }
      markZoomActivity();
      const result = zoomAtAnchor({
        oldPps: drag.baselinePps,
        factor: targetPps / drag.baselinePps,
        scrollLeft: drag.startScrollLeft,
        anchorViewportX: drag.anchorViewportX,
        minPps: MIN_PX_PER_SEC,
        maxPps: MAX_PX_PER_SEC,
      });
      if (result) onViewChange(result.newPps, result.newScrollLeft);
    }
  }, [
    totalSec,
    timeFromNavX,
    anchorViewportXFromNavX,
    applySpan,
    onScroll,
    onViewChange,
    updateHoverCursor,
    paintBox,
  ]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragScrollLeft(null);

    if (drag?.kind === "zoom") {
      flushZoomCommitNow();
    }

    if (drag?.kind === "pending" && !movedRef.current) {
      const metrics = readMetrics();
      if (metrics) {
        const t = timeFromNavX(e.clientX);
        const halfSpan = metrics.spanSec / 2;
        const start = Math.max(0, Math.min(totalSec - metrics.spanSec, t - halfSpan));
        onScroll(start * metrics.pps);
        onSeek(t);
      }
    }

    const track = trackRef.current;
    if (track) paintViewportBox(totalSec, null, track.clientWidth);

    if (trackRef.current) trackRef.current.style.cursor = "default";
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [timeFromNavX, totalSec, onScroll, onSeek, readMetrics, paintViewportBox]);

  const playheadPct = totalSec > 0 ? (playheadSec / totalSec) * 100 : 0;

  return (
    <div style={{
      height: "100%",
      flexShrink: 0,
      background: "#0a0a0a",
      borderBottom: "1px solid #1a1a1a",
      position: "relative",
      display: "flex",
    }}>
      <div style={{ width: leftInset, flexShrink: 0, background: "#0a0a0a" }} />
      <div
        ref={trackRef}
        style={{
          flex: 1,
          position: "relative",
          background: "#141414",
          touchAction: "none",
          cursor: "default",
          overflow: "hidden",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {lanes.map((_, i) => (
          <div
            key={`row-${lanes[i].card.id}`}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${(i / lanes.length) * 100}%`,
              height: `${100 / lanes.length}%`,
              background: "#141414",
              borderBottom: i < lanes.length - 1 ? "1px solid #0a0a0a" : undefined,
              pointerEvents: "none",
            }}
          />
        ))}
        {lanes.map((lane, i) => (
          <SetMinimapClip
            key={lane.card.id}
            lane={lane}
            totalDur={totalSec}
            color={laneColors[i % laneColors.length]}
            selected={transitionIndex === i || transitionIndex === i - 1}
            laneIndex={i}
            laneCount={lanes.length}
            onClick={() => onLaneClick(i)}
          />
        ))}

        {/* Ableton-style: dim outside viewport, keep clips bright inside */}
        <div
          ref={dimLeftRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 0,
            background: "rgba(0, 0, 0, 0.62)",
            pointerEvents: "none",
            zIndex: 2,
            display: "none",
          }}
        />
        <div
          ref={dimRightRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 0,
            background: "rgba(0, 0, 0, 0.62)",
            pointerEvents: "none",
            zIndex: 2,
            display: "none",
          }}
        />

        {/* Viewport frame — Ableton bracket outline */}
        <div
          ref={boxRef}
          style={{
            position: "absolute",
            left: 0,
            width: 0,
            top: 0,
            bottom: 0,
            border: "1px solid rgba(255, 255, 255, 0.72)",
            boxSizing: "border-box",
            pointerEvents: "none",
            zIndex: 3,
            willChange: "left, width",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          <div style={{
            position: "absolute", left: -1, top: 0, bottom: 0, width: 2,
            background: "rgba(255,255,255,0.95)",
          }} />
          <div style={{
            position: "absolute", right: -1, top: 0, bottom: 0, width: 2,
            background: "rgba(255,255,255,0.95)",
          }} />
        </div>

        {/* Playhead */}
        {totalSec > 0 && (
          <div style={{
            position: "absolute",
            left: `${playheadPct}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(255, 255, 255, 0.9)",
            pointerEvents: "none",
            zIndex: 4,
          }} />
        )}
      </div>
    </div>
  );
});
