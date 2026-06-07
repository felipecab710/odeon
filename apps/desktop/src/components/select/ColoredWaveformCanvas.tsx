/**
 * ColoredWaveformCanvas — Rekordbox/Lexicon-style frequency-colored waveform.
 *
 * Colors: bass (0-300 Hz) → deep blue, mid → green, high → orange-red.
 * Supports two render modes:
 *   overview  – full track, coarsest pyramid level
 *   zoomed    – time window around playhead, finest level, beat grid, cue markers
 */
import { useEffect, useRef, memo } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import type { CatalogMarker } from "@odeon/shared";

interface Props {
  cache: WaveformCache | null;
  beatTimes?: number[] | null;
  width: number;
  height: number;
  /** 0-1 playhead position (overview) */
  playhead?: number;
  /** If set, only render this time window (zoomed mode). [startSec, endSec] */
  timeWindow?: [number, number];
  /** Cue/hot-cue markers to overlay */
  markers?: CatalogMarker[];
  /** Background fill */
  background?: string;
}

// ─── Color palette (Rekordbox-style) ─────────────────────────────────────────

function freqToRgb(bass: number, mid: number, high: number): [number, number, number] {
  // Rekordbox-style: highs burn orange-red, mids vivid green, bass electric blue
  const r = Math.round(Math.min(255, high * 255 + mid * 80));
  const g = Math.round(Math.min(255, mid  * 255 + high * 60 + bass * 30));
  const b = Math.round(Math.min(255, bass * 255 + mid  * 40));
  return [r, g, b];
}

// Cue type → color map matching hot cue colors
const MARKER_COLORS: Record<string, string> = {
  hot_cue: "#f59e0b",
  memory:  "#3b82f6",
  cue:     "#10b981",
  loop:    "#8b5cf6",
};

// ─── Canvas renderer ──────────────────────────────────────────────────────────

export const ColoredWaveformCanvas = memo(function ColoredWaveformCanvas({
  cache,
  beatTimes,
  width,
  height,
  playhead,
  timeWindow,
  markers,
  background = "#0d0d0d",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    if (!cache) return;

    const dur = cache.duration_seconds;
    const midY = height / 2;

    const chosenKey = String(Math.min(...cache.block_sizes));
    const allBuckets = cache.levels[chosenKey];
    if (!allBuckets || allBuckets.length === 0) return;

    // Determine render range
    let startFrac = 0;
    let endFrac = 1;
    if (timeWindow && dur > 0) {
      startFrac = Math.max(0, timeWindow[0] / dur);
      endFrac   = Math.min(1, timeWindow[1] / dur);
    }

    const startBucket = Math.floor(startFrac * allBuckets.length);
    const endBucket   = Math.ceil(endFrac   * allBuckets.length);
    const buckets     = allBuckets.slice(startBucket, endBucket);
    if (buckets.length === 0) return;

    // Render waveform columns
    for (let x = 0; x < width; x++) {
      const idx = Math.floor((x / width) * buckets.length);
      const b = buckets[Math.min(idx, buckets.length - 1)];

      let r = 58, g = 130, bl = 217; // default blue
      if (cache.freqColors) {
        // Map x to position in full freq-color array
        const globalFrac = startFrac + (x / width) * (endFrac - startFrac);
        const colorIdx   = Math.min(Math.floor(globalFrac * cache.freqColors.bass.length), cache.freqColors.bass.length - 1);
        [r, g, bl] = freqToRgb(
          cache.freqColors.bass[colorIdx] / 255,
          cache.freqColors.mid[colorIdx]  / 255,
          cache.freqColors.high[colorIdx] / 255,
        );
      }

      // Draw top half (L channel) and bottom half (R channel)
      const lTop = midY - Math.abs(b.lx) * midY;
      const lBot = midY - Math.abs(b.lm) * midY;
      const rTop = midY + Math.abs(b.rm) * midY;
      const rBot = midY + Math.abs(b.rx) * midY;

      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(x, lTop, 1, Math.max(1, lBot - lTop));
      ctx.fillRect(x, rTop, 1, Math.max(1, rBot - rTop));
    }

    // Center hairline
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, midY - 0.5, width, 1);

    // Beat grid (on zoomed view, otherwise too dense)
    if (timeWindow && beatTimes && beatTimes.length > 0 && dur > 0) {
      const winDur = timeWindow[1] - timeWindow[0];
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (const t of beatTimes) {
        if (t < timeWindow[0] || t > timeWindow[1]) continue;
        const x = Math.round(((t - timeWindow[0]) / winDur) * width);
        ctx.fillRect(x, 0, 1, height);
      }
    }

    // Cue / hot-cue markers
    if (markers && markers.length > 0 && dur > 0) {
      const win = timeWindow;
      for (const m of markers) {
        let x: number;
        if (win) {
          if (m.time_seconds < win[0] || m.time_seconds > win[1]) continue;
          x = Math.round(((m.time_seconds - win[0]) / (win[1] - win[0])) * width);
        } else {
          x = Math.round((m.time_seconds / dur) * width);
        }
        const color = m.color || MARKER_COLORS[m.type] || "#fff";
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, 2, height);
        // Small label triangle at top
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 8, 0);
        ctx.lineTo(x, 8);
        ctx.fill();
      }
    }

    // Playhead line
    if (playhead != null && dur > 0) {
      let phX: number;
      if (timeWindow) {
        // Center line in zoomed view
        phX = Math.round(width / 2);
      } else {
        phX = Math.round(playhead * width);
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(phX, 0, 1, height);
      // Glow
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(phX - 1, 0, 3, height);
    }
  }, [cache, beatTimes, width, height, playhead, timeWindow, markers, background]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", width, height }}
    />
  );
});
