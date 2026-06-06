/**
 * Right-panel setlist — timestamped track order (1001TL / DJ setlist style).
 */
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { computeSetLayout } from "./setTimelineLayout";

function formatSetlistTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function trackTitle(e: CatalogEntry): string {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

/** "Artist - Title (Remix)" or title-only fallback */
function setlistLabel(entry: CatalogEntry): string {
  const title = trackTitle(entry);
  const artist = entry.artist?.trim();
  if (artist) return `${artist} - ${title}`;
  return title;
}

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  transitionIndex: number;
  onSelectTransition: (index: number) => void;
}

export function SetSequencePanel({
  sorted,
  entryMap,
  transitionIndex,
  onSelectTransition,
}: Props) {
  const layout = computeSetLayout(sorted, entryMap);

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: "#161616",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px 8px", flexShrink: 0 }}>
        <p style={{
          fontWeight: 600,
          fontSize: 13,
          color: "#e0e0e0",
          margin: 0,
        }}>
          Setlist:
        </p>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "0 12px 12px" }}>
        {layout.lanes.map((lane, i) => {
          const active = i === transitionIndex || i === transitionIndex + 1;

          return (
            <button
              key={lane.card.id}
              type="button"
              onClick={() => {
                if (i > 0) onSelectTransition(i - 1);
                else if (i < layout.lanes.length - 1) onSelectTransition(i);
              }}
              title={setlistLabel(lane.entry)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 0,
                width: "100%",
                textAlign: "left",
                background: active ? "rgba(255,235,59,0.05)" : "transparent",
                border: "none",
                borderRadius: 3,
                padding: "3px 4px",
                marginBottom: 2,
                cursor: "pointer",
                fontFamily: "inherit",
                lineHeight: 1.45,
              }}
            >
              <span style={{
                flexShrink: 0,
                width: 62,
                color: "#5b9bd5",
                fontSize: 11,
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}>
                {formatSetlistTime(lane.startSec)}
              </span>
              <span style={{ color: "#666", flexShrink: 0, fontSize: 11 }}> - </span>
              <span style={{
                color: active ? "#f0f0f0" : "#c8c8c8",
                fontSize: 11,
                fontWeight: active ? 500 : 400,
                flex: 1,
                minWidth: 0,
                wordBreak: "break-word",
              }}>
                {setlistLabel(lane.entry)}
              </span>
            </button>
          );
        })}

        {layout.lanes.length === 0 && (
          <p style={{ color: "#444", fontSize: 11, margin: 0 }}>No tracks in set</p>
        )}
      </div>
    </div>
  );
}
