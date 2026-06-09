/**
 * Ableton beat-time ruler — top black strip (canvas-painted, viewport-culled).
 */
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { ABLETON_RULER_BG } from "./setTimelineLayout";
import type { SetTimelineContext } from "../../lib/setTimelineContext";

interface Props {
  context: SetTimelineContext;
  height: number;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const SetBeatRuler = memo(function SetBeatRuler({
  context,
  height,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viewportWidth } = context;

  const marks = useMemo(() => {
    if (viewportWidth < 1 || context.totalSec <= 0) return [];
    return context.beatRulerMarks();
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
    context.paintBeatRuler(ctx, marks, height);
  }, [context, marks, viewportWidth, height]);

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
          left: 0,
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
