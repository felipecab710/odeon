/**
 * Ableton-style minimap clip — low-res waveform thumbnail in the overview strip.
 */
import { memo, useEffect, useRef } from "react";
import type { CatalogEntry } from "@odeon/shared";
import { useWaveformCache } from "../../hooks/useWaveformCache";
import { hasOverview, paintOverviewStrip } from "../../lib/waveformEngine/overviewStrip";
import type { LaneLayout } from "./setTimelineLayout";

interface Props {
  lane: LaneLayout;
  entry: CatalogEntry;
  totalDur: number;
  color: string;
  selected: boolean;
  onClick: () => void;
}

export const SetMinimapClip = memo(function SetMinimapClip({
  lane,
  entry,
  totalDur,
  color,
  selected,
  onClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const { cache } = useWaveformCache(entry.file_path, null, {
    cachePath: entry.waveform_cache_path,
    entryId: entry.id,
  });

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;

    const w = Math.max(1, shell.clientWidth);
    const h = Math.max(1, shell.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = color + "55";
    ctx.fillRect(0, 0, w, h);

    if (cache && hasOverview(cache)) {
      paintOverviewStrip(ctx, cache, w, h, color + "44");
    }
  }, [cache, color]);

  if (totalDur <= 0) return null;

  return (
    <div
      ref={shellRef}
      onClick={onClick}
      onPointerDown={e => e.stopPropagation()}
      style={{
        zIndex: 1,
        position: "absolute",
        left: `${(lane.startSec / totalDur) * 100}%`,
        width: `${(lane.durationSec / totalDur) * 100}%`,
        height: "100%",
        border: selected ? `1px solid ${color}` : "1px solid #222",
        borderRadius: 2,
        cursor: "pointer",
        minWidth: 4,
        overflow: "hidden",
        background: color + "33",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}
      />
    </div>
  );
});
