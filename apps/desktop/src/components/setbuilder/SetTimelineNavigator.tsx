/**
 * Ableton-style arrangement overview — shows full set, visible viewport box,
 * playhead. Drag box to scroll, drag edges to zoom, vertical drag to zoom at cursor.
 */
import { memo, useCallback, useRef, useSyncExternalStore } from "react";
import { markZoomActivity } from "../../lib/zoomInteraction";
import {
  applyZoomGestureAbsolute,
  flushZoomCommit,
  peekZoomCommit,
  subscribeGestureViewport,
} from "../../lib/zoomGestureViewport";
import { useSetTimelineStore } from "../../stores/setTimelineStore";
import {
  clampPxPerSec,
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
  type LaneLayout,
} from "./setTimelineLayout";
import { SetMinimapClip } from "./SetMinimapClip";

const HANDLE_W = 6;
const MIN_VIEWPORT_PCT = 1.5;

interface ViewportMetrics {
  leftPct: number;
  widthPct: number;
  startSec: number;
  spanSec: number;
  pps: number;
  scrollLeft: number;
}

function resolveViewport(
  totalSec: number,
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
): ViewportMetrics {
  if (totalSec <= 0 || viewportWidth <= 0) {
    return { leftPct: 0, widthPct: 100, startSec: 0, spanSec: totalSec, pps: pixelsPerSecond, scrollLeft };
  }

  const gesture = peekZoomCommit();
  const pps = gesture?.pixelsPerSecond ?? pixelsPerSecond;
  const scroll = gesture?.scrollLeft ?? scrollLeft;
  const spanSec = viewportWidth / pps;
  const startSec = Math.max(0, Math.min(totalSec, scroll / pps));
  const leftPct = (startSec / totalSec) * 100;
  const widthPct = Math.min(100 - leftPct, (spanSec / totalSec) * 100);

  return { leftPct, widthPct, startSec, spanSec, pps, scrollLeft: scroll };
}

type DragMode =
  | { kind: "pan"; startX: number; startSec: number; spanSec: number }
  | { kind: "resize-left"; endSec: number }
  | { kind: "resize-right"; startSec: number }
  | { kind: "zoom"; startY: number; baselinePps: number; anchorViewportX: number }
  | { kind: "pending"; startX: number; startY: number; startSec: number; spanSec: number };

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
  scrollLeft,
  viewportWidth,
  pixelsPerSecond,
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
  const dragRef = useRef<DragMode | null>(null);
  const movedRef = useRef(false);

  useSyncExternalStore(
    subscribeGestureViewport,
    () => peekZoomCommit()?.scrollLeft ?? scrollLeft,
    () => scrollLeft,
  );

  const metrics = resolveViewport(totalSec, scrollLeft, viewportWidth, pixelsPerSecond);
  const boxLeftPct = metrics.leftPct;
  const boxWidthPct = Math.max(MIN_VIEWPORT_PCT, metrics.widthPct);

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

  const applySpan = useCallback((startSec: number, endSec: number) => {
    if (viewportWidth < 1 || totalSec <= 0) return;
    flushZoomCommit();
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

    const rect = track.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const navW = rect.width;
    const boxLeftPx = (boxLeftPct / 100) * navW;
    const boxRightPx = boxLeftPx + (boxWidthPct / 100) * navW;

    movedRef.current = false;
    useSetTimelineStore.getState().pushZoomSnapshot();

    if (localX >= boxLeftPx - HANDLE_W / 2 && localX <= boxLeftPx + HANDLE_W / 2) {
      dragRef.current = { kind: "resize-left", endSec: metrics.startSec + metrics.spanSec };
    } else if (localX >= boxRightPx - HANDLE_W / 2 && localX <= boxRightPx + HANDLE_W / 2) {
      dragRef.current = { kind: "resize-right", startSec: metrics.startSec };
    } else if (localX > boxLeftPx && localX < boxRightPx) {
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startSec: metrics.startSec,
        spanSec: metrics.spanSec,
      };
    } else {
      dragRef.current = {
        kind: "pending",
        startX: e.clientX,
        startY: e.clientY,
        startSec: metrics.startSec,
        spanSec: metrics.spanSec,
      };
    }
  }, [totalSec, boxLeftPct, boxWidthPct, metrics.startSec, metrics.spanSec]);

  const updateHoverCursor = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const localX = clientX - rect.left;
    const navW = rect.width;
    const boxLeftPx = (boxLeftPct / 100) * navW;
    const boxRightPx = boxLeftPx + (boxWidthPct / 100) * navW;

    if (localX >= boxLeftPx - HANDLE_W / 2 && localX <= boxLeftPx + HANDLE_W / 2) {
      track.style.cursor = "ew-resize";
    } else if (localX >= boxRightPx - HANDLE_W / 2 && localX <= boxRightPx + HANDLE_W / 2) {
      track.style.cursor = "ew-resize";
    } else if (localX > boxLeftPx && localX < boxRightPx) {
      track.style.cursor = "grab";
    } else {
      track.style.cursor = "ns-resize";
    }
  }, [boxLeftPct, boxWidthPct]);

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
        const pps = useSetTimelineStore.getState().pixelsPerSecond;
        const scroll = useSetTimelineStore.getState().scrollLeft;
        dragRef.current = {
          kind: "zoom",
          startY: e.clientY,
          baselinePps: pps,
          anchorViewportX: anchorViewportXFromNavX(e.clientX, pps, scroll),
        };
      } else {
        dragRef.current = {
          kind: "pan",
          startX: drag.startX,
          startSec: drag.startSec,
          spanSec: drag.spanSec,
        };
      }
      return;
    }

    movedRef.current = true;

    if (drag.kind === "pan") {
      if (trackRef.current) trackRef.current.style.cursor = "grabbing";
      flushZoomCommit();
      const deltaSec = ((e.clientX - drag.startX) / navW) * totalSec;
      const maxStart = Math.max(0, totalSec - drag.spanSec);
      const newStart = Math.max(0, Math.min(maxStart, drag.startSec + deltaSec));
      onScroll(newStart * metrics.pps);
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
      markZoomActivity();
      const scroll = useSetTimelineStore.getState().scrollLeft;
      applyZoomGestureAbsolute(
        targetPps,
        drag.anchorViewportX,
        scroll,
        drag.baselinePps,
        MIN_PX_PER_SEC,
        MAX_PX_PER_SEC,
      );
    }
  }, [
    totalSec,
    metrics.pps,
    timeFromNavX,
    anchorViewportXFromNavX,
    applySpan,
    onScroll,
    updateHoverCursor,
  ]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.kind === "zoom") {
      flushZoomCommit();
    }

    if (drag?.kind === "pending" && !movedRef.current) {
      const t = timeFromNavX(e.clientX);
      const halfSpan = metrics.spanSec / 2;
      const start = Math.max(0, Math.min(totalSec - metrics.spanSec, t - halfSpan));
      onScroll(start * metrics.pps);
      onSeek(t);
    }

    if (trackRef.current) trackRef.current.style.cursor = "default";
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [timeFromNavX, metrics.spanSec, metrics.pps, totalSec, onScroll, onSeek]);

  const playheadPct = totalSec > 0 ? (playheadSec / totalSec) * 100 : 0;

  return (
    <div style={{
      height: "100%",
      flexShrink: 0,
      background: "#141414",
      borderBottom: "1px solid #2a2a2a",
      position: "relative",
      display: "flex",
    }}>
      <div style={{ width: leftInset, flexShrink: 0, background: "#181818" }} />
      <div
        ref={trackRef}
        style={{
          flex: 1,
          position: "relative",
          margin: "3px 0",
          background: "rgba(72, 130, 175, 0.42)",
          borderRadius: 1,
          touchAction: "none",
          cursor: "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {lanes.map((lane, i) => (
          <SetMinimapClip
            key={lane.card.id}
            lane={lane}
            entry={lane.entry}
            totalDur={totalSec}
            color={laneColors[i % laneColors.length]}
            selected={transitionIndex === i || transitionIndex === i - 1}
            onClick={() => onLaneClick(i)}
          />
        ))}

        {/* Visible viewport navigator box */}
        <div style={{
          position: "absolute",
          left: `${boxLeftPct}%`,
          width: `${boxWidthPct}%`,
          top: 0,
          bottom: 0,
          background: "rgba(28, 28, 28, 0.62)",
          border: "1px solid rgba(255, 255, 255, 0.28)",
          borderRadius: 1,
          boxSizing: "border-box",
          pointerEvents: "none",
        }}>
          <div style={{
            position: "absolute",
            left: 0,
            top: 1,
            bottom: 1,
            width: 1,
            background: "rgba(255, 255, 255, 0.75)",
          }} />
          <div style={{
            position: "absolute",
            right: 0,
            top: 1,
            bottom: 1,
            width: 1,
            background: "rgba(255, 255, 255, 0.75)",
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
            background: "#fff",
            opacity: 0.85,
            pointerEvents: "none",
            zIndex: 2,
          }} />
        )}
      </div>
    </div>
  );
});
