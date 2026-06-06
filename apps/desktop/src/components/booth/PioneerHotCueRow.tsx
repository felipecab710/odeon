/** CDJ hot cue row — colored LED strip above each A–H pad. */
import { PIONEER } from "./pioneerTheme";

// Pioneer CDJ-3000X default hot cue LED colors when set

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLORS = ["#3ecf5e", "#ddcc00", "#ff7700", "#ff2244", "#00aaff", "#4455ff", "#aa44ff", "#ff44aa"];

interface Props {
  slots: boolean[];
  interactive?: boolean;
  onHotcue?: (slot: number, shift: boolean) => void;
}

export function PioneerHotCueRow({ slots, interactive, onHotcue }: Props) {
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center", padding: "6px 10px 8px" }}>
      {LABELS.map((label, i) => {
        const active = slots[i];
        const color = COLORS[i];
        return (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            {/* LED strip */}
            <div style={{
              width: 34, height: 3, borderRadius: 1,
              background: active ? color : PIONEER.blue,
              opacity: active ? 1 : 0.35,
              boxShadow: active ? `0 0 8px ${color}, 0 0 2px ${color}` : `0 0 4px ${PIONEER.blue}44`,
              border: `1px solid ${active ? color : "#1a3a5a"}`,
            }} />
            <button
              type="button"
              disabled={!interactive || !onHotcue}
              onClick={onHotcue ? (e) => onHotcue(i, e.shiftKey) : undefined}
              style={{
                width: 34, height: 20, padding: 0,
                borderRadius: 2,
                border: `1px solid ${active ? color : "#3a3a3a"}`,
                background: active
                  ? `linear-gradient(180deg, ${color}55 0%, ${color}22 100%)`
                  : "linear-gradient(180deg, #2a2a2a 0%, #141414 100%)",
                color: active ? PIONEER.white : PIONEER.label,
                fontSize: 9,
                fontWeight: 800,
                fontFamily: PIONEER.font,
                cursor: interactive ? "pointer" : "default",
                boxShadow: active
                  ? `inset 0 1px 0 rgba(255,255,255,0.15), 0 0 10px ${color}44`
                  : "inset 0 2px 4px rgba(0,0,0,0.6)",
              }}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
