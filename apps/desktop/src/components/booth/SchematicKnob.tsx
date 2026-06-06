/** Animated rotary knob for Pioneer twin (display + optional drag). */
import { useCallback, useRef, type CSSProperties } from "react";

interface Props {
  value: number;
  min?: number;
  max?: number;
  label: string;
  color?: string;
  size?: number;
  center?: number;
  onChange?: (v: number) => void;
}

export function SchematicKnob({
  value, min = -12, max = 12, label, color = "#888",
  size = 22, center = 0, onChange,
}: Props) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onChange) return;
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const range = max - min;
      const next = Math.max(min, Math.min(max, startVal.current - (ev.clientY - startY.current) * (range / 120)));
      onChange(Math.round(next * 10) / 10);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onChange, value, min, max]);
  const norm = (value - min) / (max - min);
  const angle = -135 + norm * 270;
  const atCenter = Math.abs(value - center) < 0.5;

  return (
    <div style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => onChange?.(center)}
        style={{
          width: size, height: size, borderRadius: "50%",
          margin: "0 auto 2px",
          background: atCenter ? "#1a1a1a" : color,
          border: atCenter ? `1px solid ${color}` : "none",
          boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.5)",
          position: "relative",
          cursor: onChange ? "ns-resize" : "default",
        }}
      >
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          width: 1, height: size * 0.36,
          background: atCenter ? color : "#111",
          transform: `translate(-50%,-90%) rotate(${angle}deg)`,
          transformOrigin: "bottom center",
        }} />
      </div>
      <div style={{ fontSize: 6, color: "#666", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

export function SchematicButton({
  label, active, color, style, onClick,
}: { label: string; active?: boolean; color?: string; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
      cursor: onClick ? "pointer" : "default",
      width: 16, height: 14, borderRadius: 2,
      background: active ? (color ?? "#ff9800") : "#222",
      color: active ? "#111" : "#555",
      fontSize: 6, fontWeight: 800,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: active ? `0 0 6px ${color ?? "#ff9800"}88` : "none",
      ...style,
    }}
    >
      {label}
    </div>
  );
}
