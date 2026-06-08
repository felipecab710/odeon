/**
 * Ableton-style beat grid — canvas-painted, viewport-culled.
 */
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isZooming, subscribeZoom } from "../../lib/zoomInteraction";
import {
  buildBeatGridLevels,
  collectGridLines,
  paintBeatGridCanvas,
  viewTimeRange,
} from "../../lib/setBeatGrid";

interface Props {
  totalSec: number;
  pixelsPerSecond: number;
  bpm: number;
  height: number;
  scrollLeft: number;
  viewportWidth: number;
}

export const SetBeatTimelineGrid = memo(function SetBeatTimelineGrid({
  totalSec,
  pixelsPerSecond,
  bpm,
  height,
  scrollLeft,
  viewportWidth,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zooming = useSyncExternalStore(subscribeZoom, isZooming, () => false);

  const levels = useMemo(
    () => buildBeatGridLevels(bpm, pixelsPerSecond),
    [bpm, pixelsPerSecond],
  );

  const lines = useMemo(() => {
    if (viewportWidth < 1 || totalSec <= 0) return [];
    const { start, end } = viewTimeRange(scrollLeft, viewportWidth, pixelsPerSecond);
    return collectGridLines(totalSec, levels, start, end);
  }, [totalSec, levels, scrollLeft, viewportWidth, pixelsPerSecond]);

  useEffect(() => {
    if (zooming) return;
    const canvas = canvasRef.current;
    if (!canvas || viewportWidth < 1 || height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewportWidth * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, height);
    if (lines.length > 0) {
      paintBeatGridCanvas(ctx, lines, scrollLeft, pixelsPerSecond, viewportWidth, height, levels);
    }
  }, [lines, levels, scrollLeft, pixelsPerSecond, viewportWidth, height, zooming]);

  if (viewportWidth < 1 || height < 1) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: scrollLeft,
        width: viewportWidth,
        height,
        pointerEvents: "none",
        zIndex: 4,
      }}
    />
  );
});
