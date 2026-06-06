/**
 * Pioneer-style horizontal crossfader for set arrangement preview.
 */
import { useCallback, useEffect, useRef } from "react";
import { STUDIO_GRID, STUDIO_SIDEBAR } from "./setTimelineLayout";

interface Props {
  position: number;
  onChange: (pos: number) => void;
  width: number;
}

export function DJMCrossfader({ position, onChange, width }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(Math.round(pos * 1000) / 1000);
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromX(e.clientX); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateFromX]);

  return (
    <div style={{
      height: 36, flexShrink: 0,
      background: STUDIO_SIDEBAR,
      borderTop: `1px solid ${STUDIO_GRID}`,
      display: "flex", alignItems: "center",
      padding: "0 8px", gap: 8,
    }}>
      <span style={{ fontSize: 8, color: "#666", fontWeight: 700, width: 20 }}>A</span>
      <div
        ref={trackRef}
        onMouseDown={(e) => { e.preventDefault(); dragging.current = true; updateFromX(e.clientX); }}
        onDoubleClick={() => onChange(0.5)}
        style={{
          flex: 1, maxWidth: width - 56,
          height: 10, background: "#141414",
          borderRadius: 5, position: "relative",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)",
          cursor: "ew-resize",
        }}
      >
        <div style={{
          position: "absolute",
          left: `${position * 100}%`,
          top: "50%",
          width: 18, height: 18,
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(180deg, #ddd 0%, #999 100%)",
          borderRadius: 3,
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }} />
      </div>
      <span style={{ fontSize: 8, color: "#666", fontWeight: 700, width: 20, textAlign: "right" }}>B</span>
    </div>
  );
}
