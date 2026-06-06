/** CDJ screen-right rotary encoder + BACK / TAG TRACK buttons. */
import { PIONEER } from "./pioneerTheme";

export function PioneerScreenEncoder() {
  return (
    <div style={{
      width: 46, flexShrink: 0,
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, padding: "4px 3px",
      background: "linear-gradient(180deg, #060608, #020204)",
      borderLeft: "1px solid #151520",
    }}>
      <button type="button" style={{
        width: "100%", height: 14, border: "1px solid #2a2a2a", borderRadius: 2,
        background: "linear-gradient(180deg, #2a2a2a, #141414)",
        color: PIONEER.label, fontSize: 5, fontWeight: 800, letterSpacing: "0.06em",
        fontFamily: PIONEER.font, cursor: "default",
      }}>
        BACK
      </button>

      {/* Silver encoder */}
      <div style={{
        width: 38, height: 38, borderRadius: "50%", position: "relative",
        background: "radial-gradient(circle at 35% 30%, #c8c8c8 0%, #888 35%, #555 70%, #333 100%)",
        border: "2px solid #666",
        boxShadow: "0 2px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.3)",
      }}>
        <div style={{
          position: "absolute", inset: 6, borderRadius: "50%",
          background: "repeating-conic-gradient(#777 0deg 8deg, #999 8deg 16deg)",
          border: "1px solid #555",
        }} />
        <div style={{
          position: "absolute", top: 4, left: "50%", transform: "translateX(-50%)",
          width: 2, height: 8, background: PIONEER.white, borderRadius: 1,
        }} />
      </div>

      <button type="button" style={{
        width: "100%", height: 22, border: "1px solid #2a2a2a", borderRadius: 2,
        background: "linear-gradient(180deg, #2a2a2a, #141414)",
        color: PIONEER.label, fontSize: 4, fontWeight: 700, lineHeight: 1.2,
        fontFamily: PIONEER.font, cursor: "default", padding: "2px 1px",
      }}>
        TAG TRACK
      </button>
    </div>
  );
}
