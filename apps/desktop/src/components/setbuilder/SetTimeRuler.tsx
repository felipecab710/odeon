/**
 * Ableton time ruler — bottom black strip with m:ss labels (canvas-painted).
 */
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isZooming, subscribeZoom } from "../../lib/zoomInteraction";
import { ABLETON_RULER_BG } from "./setTimelineLayout";
import {
  collectTimeRulerMarks,
  paintTimeRulerCanvas,
  viewTimeRange,
} from "../../lib/setBeatGrid";

interface Props {
  totalSec: number;
  pixelsPerSecond: number;
  height: number;
  scrollLeft: number;
  viewportWidth: number;
}

export const SetTimeRuler = memo(function SetTimeRuler({
  totalSec,
  pixelsPerSecond,
  height,
  scrollLeft,
  viewportWidth,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const zooming = useSyncExternalStore(subscribeZoom, isZooming, () => false);

  const marks = useMemo(() => {
    if (viewportWidth < 1 || totalSec <= 0) return [];
    const { start, end } = viewTimeRange(scrollLeft, viewportWidth, pixelsPerSecond);
    return collectTimeRulerMarks(totalSec, start, end, pixelsPerSecond);
  }, [totalSec, scrollLeft, viewportWidth, pixelsPerSecond]);

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
    paintTimeRulerCanvas(ctx, marks, scrollLeft, pixelsPerSecond, viewportWidth, height);
  }, [marks, scrollLeft, pixelsPerSecond, viewportWidth, height, zooming]);

  return (
    <div style={{
      height,
      background: ABLETON_RULER_BG,
      borderTop: "1px solid rgba(255,255,255,0.08)",
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
    </div>
  );
});
