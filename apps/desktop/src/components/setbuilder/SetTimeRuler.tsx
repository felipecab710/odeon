/**
 * Ableton time ruler — bottom black strip with m:ss labels (canvas-painted).
 */
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { ABLETON_RULER_BG } from "./setTimelineLayout";
import type { SetTimelineContext } from "../../lib/setTimelineContext";

interface Props {
  context: SetTimelineContext;
  height: number;
}

export const SetTimeRuler = memo(function SetTimeRuler({
  context,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewportWidth } = context;

  const marks = useMemo(() => {
    if (viewportWidth < 1 || context.totalSec <= 0) return [];
    return context.timeRulerMarks();
  }, [context, viewportWidth]);

  useLayoutEffect(() => {
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
    context.paintTimeRuler(ctx, marks, height);
  }, [context, marks, viewportWidth, height]);

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
          left: 0,
          top: 0,
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
});
