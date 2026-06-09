/**
 * Ableton-style minimap clip — solid lane-colored block, no waveform.
 */
import { memo } from "react";
import type { LaneLayout } from "./setTimelineLayout";

interface Props {
  lane: LaneLayout;
  totalDur: number;
  color: string;
  selected: boolean;
  laneIndex: number;
  laneCount: number;
  onClick: () => void;
}

export const SetMinimapClip = memo(function SetMinimapClip({
  lane,
  totalDur,
  color,
  selected,
  laneIndex,
  laneCount,
  onClick,
}: Props) {
  if (totalDur <= 0 || laneCount <= 0) return null;

  const rowPct = 100 / laneCount;

  return (
    <div
      onClick={onClick}
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${(lane.startSec / totalDur) * 100}%`,
        width: `${(lane.durationSec / totalDur) * 100}%`,
        top: `${laneIndex * rowPct}%`,
        height: `${rowPct}%`,
        boxSizing: "border-box",
        zIndex: 1,
        cursor: "pointer",
        minWidth: 2,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: color,
          border: selected ? "1px solid rgba(255,255,255,0.5)" : "1px solid rgba(0,0,0,0.35)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
});
