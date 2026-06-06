/** Shared Pioneer hardware UI primitives */
import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { PIONEER } from "./pioneerTheme";

export function PioneerChassis({
  children, width, className, style,
}: {
  children: ReactNode;
  width: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        width,
        flexShrink: 0,
        background: `linear-gradient(180deg, ${PIONEER.faceplateHi} 0%, ${PIONEER.faceplate} 8%, #0a0a0a 100%)`,
        border: `1px solid ${PIONEER.faceplateEdge}`,
        borderRadius: 8,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: PIONEER.font,
        ...style,
      }}
    >
      <div style={{ height: 4, background: PIONEER.chrome, flexShrink: 0 }} />
      {children}
    </div>
  );
}

export function PioneerNavBtn({ label, active }: { label: string; active?: boolean }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: 18,
      fontSize: 6,
      fontWeight: 700,
      letterSpacing: "0.06em",
      color: active ? PIONEER.white : PIONEER.label,
      background: active
        ? "linear-gradient(180deg, #3a3a3a, #1a1a1a)"
        : "linear-gradient(180deg, #222, #141414)",
      border: `1px solid ${active ? "#555" : "#2a2a2a"}`,
      borderRadius: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: active ? "inset 0 0 8px rgba(255,255,255,0.08)" : "none",
      textOverflow: "ellipsis",
      overflow: "hidden",
      whiteSpace: "nowrap",
      padding: "0 2px",
    }}>
      {label}
    </div>
  );
}

export function PioneerPadBtn({
  label, active, color, onClick, width = 28, height = 16,
}: {
  label: string;
  active?: boolean;
  color?: string;
  onClick?: (e: React.MouseEvent) => void;
  width?: number;
  height?: number;
}) {
  const c = color ?? PIONEER.labelHi;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        width, height, padding: 0,
        borderRadius: 2,
        border: `1px solid ${active ? c : "#333"}`,
        background: active
          ? `linear-gradient(180deg, ${c}cc, ${c}66)`
          : "linear-gradient(180deg, #2a2a2a, #141414)",
        color: active ? "#111" : PIONEER.label,
        fontSize: 7,
        fontWeight: 800,
        cursor: onClick ? "pointer" : "default",
        boxShadow: active ? `0 0 8px ${c}88, inset 0 1px 0 rgba(255,255,255,0.2)` : "inset 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      {label}
    </button>
  );
}

export function PioneerRoundBtn({
  label, active, variant = "orange", onClick, size = 52,
}: {
  label: string;
  active?: boolean;
  variant?: "orange" | "green" | "dark";
  onClick?: () => void;
  size?: number;
}) {
  const colors = {
    orange: { bg: PIONEER.orange, glow: PIONEER.orangeGlow, text: "#111" },
    green: { bg: PIONEER.green, glow: PIONEER.greenGlow, text: "#111" },
    dark: { bg: "#333", glow: "none", text: PIONEER.label },
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        width: size, height: size, borderRadius: "50%", padding: 0,
        border: `2px solid ${active ? colors.bg : "#444"}`,
        background: active
          ? `radial-gradient(circle at 35% 30%, ${colors.bg}ee 0%, ${colors.bg}aa 40%, ${colors.bg}66 100%)`
          : "radial-gradient(circle at 35% 30%, #3a3a3a 0%, #1a1a1a 60%, #0a0a0a 100%)",
        color: active ? colors.text : PIONEER.label,
        fontSize: size > 44 ? 9 : 7,
        fontWeight: 900,
        letterSpacing: "0.04em",
        cursor: onClick ? "pointer" : "default",
        boxShadow: active ? colors.glow : "inset 0 2px 6px rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {label}
    </button>
  );
}

export function PioneerKnob({
  value, min = -12, max = 12, label, size = 28, large, onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  size?: number;
  large?: boolean;
  onChange?: (v: number) => void;
}) {
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
      const next = Math.max(min, Math.min(max, startVal.current - (ev.clientY - startY.current) * (range / 100)));
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
  const s = large ? size * 1.15 : size;

  return (
    <div style={{ textAlign: "center" }}>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => onChange?.(0)}
        style={{
          width: s, height: s, borderRadius: "50%", margin: "0 auto",
          background: large
            ? "radial-gradient(circle at 38% 32%, #555 0%, #2a2a2a 25%, #141414 70%, #0a0a0a 100%)"
            : "radial-gradient(circle at 38% 32%, #3a3a3a 0%, #1e1e1e 50%, #0a0a0a 100%)",
          border: `1px solid ${PIONEER.knobRing}`,
          boxShadow: "0 3px 6px rgba(0,0,0,0.7), inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.08)",
          position: "relative",
          cursor: onChange ? "ns-resize" : "default",
        }}
      >
        {/* Knurled outer ring */}
        <div style={{
          position: "absolute", inset: 1, borderRadius: "50%",
          background: "repeating-conic-gradient(from 0deg, #2a2a2a 0deg 6deg, #1a1a1a 6deg 12deg)",
          opacity: 0.6,
        }} />
        {large && (
          <div style={{
            position: "absolute", inset: s * 0.2, borderRadius: "50%",
            background: "radial-gradient(circle at 40% 35%, #777 0%, #444 50%, #222 100%)",
            border: "1px solid #555",
            boxShadow: "inset 0 1px 2px rgba(255,255,255,0.1)",
          }} />
        )}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          width: 2, height: s * 0.32,
          background: PIONEER.white,
          transform: `translate(-50%,-92%) rotate(${angle}deg)`,
          transformOrigin: "bottom center",
          borderRadius: 1,
          boxShadow: "0 0 2px rgba(255,255,255,0.5)",
        }} />
      </div>
      <div style={{
        fontSize: 6, color: PIONEER.label, fontWeight: 700,
        letterSpacing: "0.08em", marginTop: 2,
      }}>
        {label}
      </div>
    </div>
  );
}

export function PioneerCueBtn({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  return (
    <div style={{ position: "relative", width: 56, height: 56 }}>
      {active && (
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          border: `2px solid ${PIONEER.orange}`,
          boxShadow: PIONEER.orangeGlow,
          pointerEvents: "none",
        }} />
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        style={{
          width: 56, height: 56, borderRadius: "50%", padding: 0,
          border: `2px solid ${active ? PIONEER.orange : "#444"}`,
          background: active
            ? "radial-gradient(circle at 38% 32%, #ffcc80 0%, #ff6d00 50%, #e65100 100%)"
            : "radial-gradient(circle at 38% 32%, #444 0%, #222 55%, #111 100%)",
          boxShadow: active
            ? `${PIONEER.orangeGlow}, inset 0 -3px 8px rgba(0,0,0,0.3)`
            : "inset 0 3px 10px rgba(0,0,0,0.85)",
          cursor: onClick ? "pointer" : "default",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 900, color: active ? "#111" : PIONEER.label,
          letterSpacing: "0.06em",
          fontFamily: PIONEER.font,
        }}
      >
        CUE
      </button>
    </div>
  );
}

export function PioneerPlayBtn({ active }: { active?: boolean }) {
  return (
    <div style={{ position: "relative", width: 56, height: 56 }}>
      {active && (
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          border: `2px solid ${PIONEER.green}`,
          boxShadow: PIONEER.greenGlow,
          pointerEvents: "none",
        }} />
      )}
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        border: `2px solid ${active ? PIONEER.green : "#444"}`,
        background: active
          ? "radial-gradient(circle at 38% 32%, #69f0ae 0%, #00e676 50%, #00c853 100%)"
          : "radial-gradient(circle at 38% 32%, #444 0%, #222 55%, #111 100%)",
        boxShadow: active
          ? `${PIONEER.greenGlow}, inset 0 -3px 8px rgba(0,0,0,0.3)`
          : "inset 0 3px 10px rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, color: active ? "#111" : PIONEER.label,
      }}>
        ▶
      </div>
    </div>
  );
}

export function PioneerTempoSlider({ pitchPercent, height = 140 }: { pitchPercent: number; height?: number }) {
  const pos = 50 + pitchPercent * 2.5;
  return (
    <div style={{
      width: 22, height, position: "relative",
      background: "linear-gradient(90deg, #0a0a0a, #141414 50%, #0a0a0a)",
      border: "1px solid #2a2a2a",
      borderRadius: 3,
      boxShadow: "inset 0 2px 8px rgba(0,0,0,0.9)",
    }}>
      <div style={{
        position: "absolute", left: 2, right: 2, top: "50%",
        height: 1, background: PIONEER.green, boxShadow: `0 0 4px ${PIONEER.green}`,
      }} />
      {[-6, -3, 0, 3, 6].map(t => (
        <div key={t} style={{
          position: "absolute", left: 4, right: 4,
          top: `${50 - t * 8.33}%`,
          fontSize: 5, color: PIONEER.label, textAlign: "right",
          transform: "translateY(-50%)",
        }}>
          {t > 0 ? `+${t}` : t}
        </div>
      ))}
      <div style={{
        position: "absolute", left: -2, right: -2,
        top: `${Math.max(4, Math.min(96, pos))}%`,
        height: 14, transform: "translateY(-50%)",
        background: "linear-gradient(180deg, #666 0%, #222 40%, #111 60%, #444 100%)",
        borderRadius: 2,
        border: "1px solid #555",
        boxShadow: "0 2px 4px rgba(0,0,0,0.7)",
      }}>
        <div style={{
          position: "absolute", left: 3, right: 3, top: "50%", height: 1,
          background: PIONEER.white, transform: "translateY(-50%)",
        }} />
      </div>
    </div>
  );
}

export function PioneerSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 6, fontWeight: 800, color: PIONEER.label,
      letterSpacing: "0.12em", textAlign: "center",
    }}>
      {children}
    </div>
  );
}
