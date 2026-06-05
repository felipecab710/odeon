import { memo, type MouseEvent } from "react";
import { useEngineStore } from "../../stores/engineStore";
import { useTransportStore } from "../../stores/transportStore";

const IDLE_DB = -90;

const DB_FLOOR = -60;
const DB_CEIL  = 6;

function dbToPct(db: number): number {
  const clamped = Math.max(DB_FLOOR, Math.min(DB_CEIL, db));
  return ((clamped - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * 100;
}

function barColor(db: number, clipping: boolean): string {
  if (clipping || db >= -0.5) return "#ff5500";
  if (db >= -3) return "#ffcc00";
  if (db >= -12) return "#66ee66";
  return "#33cc33";
}

const MeterBar = memo(function MeterBar({
  db,
  peakDb,
  clipping,
}: {
  db: number;
  peakDb: number;
  clipping: boolean;
}) {
  const fillPct = dbToPct(db);
  const peakPct = dbToPct(peakDb);
  const color   = barColor(db, clipping);

  return (
    <div
      style={{
        position: "relative",
        width: 4,
        height: "100%",
        background: "#0a0a0a",
        border: "1px solid #000",
        boxSizing: "border-box",
      }}
    >
      {/* Clip indicator segment at top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: clipping ? "#ff2020" : "#3a1010",
          zIndex: 2,
        }}
      />
      {/* Level fill */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${fillPct}%`,
          background: color,
          boxShadow: fillPct > 2 ? `0 0 4px ${color}88` : undefined,
          transition: "height 0.04s linear",
        }}
      />
      {/* Peak hold tick */}
      {peakDb > DB_FLOOR && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: `${peakPct}%`,
            height: 1,
            background: barColor(peakDb, clipping),
            zIndex: 3,
          }}
        />
      )}
    </div>
  );
});

const stopBubble = (e: MouseEvent) => e.stopPropagation();

/** Compact stereo level meter — isolated from lane hover/click (Pro Tools style). */
export const TrackHeaderMeter = memo(function TrackHeaderMeter({
  trackId,
}: {
  trackId: string;
}) {
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const state = useEngineStore((s) => s.trackStates[trackId]);

  // Live playback signal only — idle when paused/stopped (not cursor hover).
  const leftDb   = isPlaying ? (state?.leftMeterDb  ?? IDLE_DB) : IDLE_DB;
  const rightDb  = isPlaying ? (state?.rightMeterDb ?? IDLE_DB) : IDLE_DB;
  const peakL    = isPlaying ? (state?.peakLeftDb   ?? IDLE_DB) : IDLE_DB;
  const peakR    = isPlaying ? (state?.peakRightDb  ?? IDLE_DB) : IDLE_DB;
  const clipping = isPlaying ? (state?.clipping     ?? false) : false;

  return (
    <div
      className="flex-shrink-0 flex self-stretch"
      style={{
        width: 14,
        padding: "4px 2px",
        background: "#141414",
        borderLeft: "1px solid #2a2a2a",
        borderRight: "1px solid #2a2a2a",
        gap: 2,
        alignItems: "stretch",
        cursor: "default",
        position: "relative",
        zIndex: 20,
        isolation: "isolate",
      }}
      title={`L ${leftDb.toFixed(1)} dB · R ${rightDb.toFixed(1)} dB`}
      onMouseDown={stopBubble}
      onMouseUp={stopBubble}
      onClick={stopBubble}
      onMouseMove={stopBubble}
    >
      <MeterBar db={leftDb}  peakDb={peakL} clipping={clipping} />
      <MeterBar db={rightDb} peakDb={peakR} clipping={clipping} />
    </div>
  );
});
