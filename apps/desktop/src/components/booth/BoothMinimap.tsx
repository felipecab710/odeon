import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { computeSetLayout, formatTimeline } from "../setbuilder/setTimelineLayout";

const LANE_COLORS = ["#c8e650", "#b39ddb", "#4fc3f7", "#ffab40"];

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  playheadSec: number;
  transitionIndex: number | null;
  onSeek: (sec: number) => void;
}

export function BoothMinimap({ sorted, entryMap, playheadSec, transitionIndex, onSeek }: Props) {
  const layout = computeSetLayout(sorted, entryMap);
  const total = layout.totalSec || 1;

  return (
    <div style={{
      height: 32, flexShrink: 0, background: "#111",
      borderBottom: "1px solid #222", position: "relative",
      padding: "4px 12px",
    }}>
      <div style={{ position: "relative", height: "100%" }}>
        {layout.lanes.map((lane, i) => (
          <div
            key={lane.card.entryId}
            title={lane.entry.title ?? lane.entry.file_name}
            onClick={() => onSeek(lane.startSec)}
            style={{
              position: "absolute",
              left: `${(lane.startSec / total) * 100}%`,
              width: `${(lane.durationSec / total) * 100}%`,
              top: i % 2 === 0 ? 2 : 14,
              height: 10,
              background: LANE_COLORS[i % 4] + "55",
              border: transitionIndex === i || transitionIndex === i - 1
                ? `1px solid ${LANE_COLORS[i % 4]}`
                : "1px solid #333",
              borderRadius: 2, cursor: "pointer", minWidth: 3,
            }}
          />
        ))}
        {layout.transitions.map(t => (
          <div
            key={t.index}
            style={{
              position: "absolute",
              left: `${(t.startSec / total) * 100}%`,
              width: `${(t.widthPx / layout.totalWidthPx) * 100}%`,
              top: 0, bottom: 0,
              border: "1px solid #6495ed44",
              pointerEvents: "none",
            }}
          />
        ))}
        <div style={{
          position: "absolute",
          left: `${(playheadSec / total) * 100}%`,
          top: 0, bottom: 0, width: 2,
          background: "#ffeb3b",
          boxShadow: "0 0 4px #ffeb3b",
          pointerEvents: "none",
        }} />
      </div>
      <div style={{
        position: "absolute", right: 12, top: 6,
        fontSize: 8, color: "#666",
      }}>
        {formatTimeline(playheadSec)} · {sorted.length} tracks
      </div>
    </div>
  );
}
