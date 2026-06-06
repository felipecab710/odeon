import { useCallback, useEffect, useRef } from "react";
import { faderDbToPos, faderPosToDb } from "../../lib/proToolsFaderScale";
import { PioneerFaderCap } from "../setbuilder/PioneerFaderCap";

export function SchematicFader({
  valueDb, height = 64, onChange,
}: { valueDb: number; color?: string; height?: number; onChange?: (db: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pos = faderDbToPos(Math.max(-60, Math.min(12, valueDb)));

  const updateFromY = useCallback((clientY: number) => {
    if (!onChange) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const uPos = faderDbToPos(0);
    const snap = Math.abs(raw - uPos) < 0.025 ? uPos : raw;
    onChange(Math.round(Math.max(-60, Math.min(12, faderPosToDb(snap))) * 10) / 10);
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromY(e.clientY); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateFromY]);
  const unityPct = faderDbToPos(0) * 100;

  return (
    <div
      ref={trackRef}
      onMouseDown={e => { if (onChange) { e.preventDefault(); dragging.current = true; updateFromY(e.clientY); } }}
      onDoubleClick={() => onChange?.(0)}
      style={{
        width: 14, height, position: "relative",
        background: "linear-gradient(90deg, #0a0a0a 0%, #141414 50%, #0a0a0a 100%)",
        borderRadius: 2,
        border: "1px solid #222",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.85)",
        cursor: onChange ? "ns-resize" : "default",
      }}
    >
      <div style={{
        position: "absolute", left: "50%", transform: "translateX(-50%)",
        width: 1, top: 3, bottom: 3, background: "#2a2a2a",
      }} />
      <div style={{
        position: "absolute", left: 0, right: 0,
        top: `${unityPct}%`, height: 1, background: "#666",
        pointerEvents: "none",
      }} />
      <PioneerFaderCap topPct={(1 - pos) * 100} capHeight={9} inset={1} />
    </div>
  );
}
