/**
 * Ableton beat-time ruler — top black strip (canvas-painted, viewport-culled).
 */
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isZooming, subscribeZoom } from "../../lib/zoomInteraction";
import { ABLETON_RULER_BG } from "./setTimelineLayout";
import {
  buildBeatGridLevels,
  collectBeatRulerMarks,
  paintBeatRulerCanvas,
  viewTimeRange,
} from "../../lib/setBeatGrid";

interface Props {
  totalSec: number;
  pixelsPerSecond: number;
  bpm: number;
  height: number;
  scrollLeft: number;
  viewportWidth: number;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const SetBeatRuler = memo(function SetBeatRuler({
  totalSec,
  pixelsPerSecond,
  bpm,
  height,
  scrollLeft,
  viewportWidth,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useMemo(
    () => buildBeatGridLevels(bpm, pixelsPerSecond),
    [bpm, pixelsPerSecond],
  );

  const zooming = useSyncExternalStore(subscribeZoom, isZooming, () => false);

  const marks = useMemo(() => {
    if (viewportWidth < 1 || totalSec <= 0) return [];
    const { start, end } = viewTimeRange(scrollLeft, viewportWidth, pixelsPerSecond);
    return collectBeatRulerMarks(totalSec, levels, start, end, bpm, pixelsPerSecond);
  }, [totalSec, levels, scrollLeft, viewportWidth, pixelsPerSecond, bpm]);

  useEffect(() => {
    if (zooming) return;
    const canvas = canvasRef.current;
    if (!canvas || viewportWidth < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewportWidth * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBeatRulerCanvas(ctx, marks, scrollLeft, pixelsPerSecond, viewportWidth, height);
  }, [marks, scrollLeft, pixelsPerSecond, viewportWidth, height, zooming]);

  const interactive = Boolean(onPointerDown);

  return (
    <div style={{
      height,
      background: ABLETON_RULER_BG,
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden",
      position: "relative",
    }}>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          left: scrollLeft,
          top: 0,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {interactive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 22,
            cursor: "ns-resize",
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={onContextMenu}
        />
      )}
    </div>
  );
});
