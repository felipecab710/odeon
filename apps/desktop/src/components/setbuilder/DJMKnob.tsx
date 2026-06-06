/**
 * Pioneer-style rotary knob — drag vertically to adjust, double-click resets.
 */
import { useCallback, useRef, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  label: string;
  color: string;
  /** Value at center (kill position for EQ). */
  center?: number;
  onChange: (v: number) => void;
  size?: number;
}

export function DJMKnob({
  value, min, max, label, color, center = 0, onChange, size = 20,
}: Props) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [hover, setHover] = useState(false);

  const norm = (value - min) / (max - min);
  const angle = -135 + norm * 270;
  const atCenter = Math.abs(value - center) < 0.01;

  const updateFromDelta = useCallback((dy: number) => {
    const range = max - min;
    const next = Math.max(min, Math.min(max, startVal.current - dy * (range / 120)));
    onChange(Math.round(next * 10) / 10);
  }, [min, max, onChange]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      updateFromDelta(ev.clientY - startY.current);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => onChange(center)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: size, height: size, borderRadius: "50%",
          margin: "0 auto 2px",
          background: atCenter ? "#2a2a2a" : color,
          boxShadow: hover
            ? `inset 0 -2px 4px rgba(0,0,0,0.4), 0 0 0 1px ${color}88`
            : "inset 0 -2px 4px rgba(0,0,0,0.4)",
          cursor: "ns-resize", position: "relative",
          border: atCenter ? `1px solid ${color}` : "none",
        }}
      >
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          width: 1, height: size * 0.38, background: atCenter ? color : "#111",
          transform: `translate(-50%,-90%) rotate(${angle}deg)`,
          transformOrigin: "bottom center",
        }} />
      </div>
      <div style={{ fontSize: 7, color: "#666", letterSpacing: "0.02em" }}>{label}</div>
    </div>
  );
}
