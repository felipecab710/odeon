/**
 * Ableton-style beat grid — canvas-painted, viewport-culled.
 */
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { SetTimelineContext } from "../../lib/setTimelineContext";

interface Props {
  context: SetTimelineContext;
  height: number;
}

export const SetBeatTimelineGrid = memo(function SetBeatTimelineGrid({
  context,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewportWidth } = context;

  const lines = useMemo(() => {
    if (viewportWidth < 1 || context.totalSec <= 0) return [];
    return context.gridLines();
  }, [context, viewportWidth]);

  useLayoutEffect(() => {
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
      context.paintGrid(ctx, lines, height);
    }
  }, [context, lines, viewportWidth, height]);

  if (viewportWidth < 1 || height < 1) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: viewportWidth,
        height,
        pointerEvents: "none",
        zIndex: 4,
      }}
    />
  );
});
