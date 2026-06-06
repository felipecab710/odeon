/**
 * ThreeBandOverview — CDJ-style filled three-band structural waveform.
 *
 * Reads the OVW3 overview section (RMS + low/mid/high energy per bin, robustly
 * normalised + smoothed in Python). Renders a continuous filled landscape where
 * every column stacks low (blue) / mid (gold) / high (white) simultaneously —
 * NOT raw min/max spikes and NOT one dominant color per bin.
 *
 * Static: redraws only when track / size / mode change. Playhead, played
 * dimming, cues and progress are drawn by the parent's dynamic overlay.
 *
 * Booth-only. Select's WaveformRenderer is intentionally left untouched.
 */
import { useEffect, useRef } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import {
  OVERVIEW_FIELDS,
  OVERVIEW_HIGH,
  OVERVIEW_LEVELS,
  OVERVIEW_LOW,
  OVERVIEW_MAX,
  OVERVIEW_MID,
  OVERVIEW_MIN,
  OVERVIEW_RMS,
} from "../../lib/waveformEngine/types";

export type OverviewMode = "stack" | "rms" | "peak" | "low" | "mid" | "high";

const BAND_LOW = [47, 111, 224] as const;   // blue
const BAND_MID = [232, 149, 31] as const;   // gold/orange
const BAND_HIGH = [242, 234, 216] as const; // warm white

const PEAK_WEIGHT = 0.30;
const RMS_WEIGHT = 0.70;
const EPS = 1e-6;

interface Props {
  cache: WaveformCache | null;
  width: number;
  height: number;
  bg?: string;
  /** Baseline as a fraction of height from the top (0..1). Bands grow upward. */
  baseline?: number;
  /** Downward reflection fraction (0 = pure upward, 1 = symmetric). */
  reflect?: number;
  mode?: OverviewMode;
}

/** Pick the OVW3 level whose bin count best matches the physical pixel width. */
function pickLevel(
  overview: WaveformCache["overview"],
  physW: number,
): { bins: Float32Array; count: number } | null {
  if (!overview?.levels) return null;
  let best: { bins: Float32Array; count: number } | null = null;
  let bestDelta = Infinity;
  for (const lvl of OVERVIEW_LEVELS) {
    const arr = overview.levels[String(lvl)];
    if (!arr) continue;
    const count = arr.length / OVERVIEW_FIELDS;
    const delta = Math.abs(count - physW);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { bins: arr, count };
    }
  }
  return best;
}

export function ThreeBandOverview({
  cache, width, height, bg = "#030306",
  baseline = 0.82, reflect = 0.28, mode = "stack",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pW = Math.max(1, Math.round(width * dpr));
    const pH = Math.max(1, Math.round(height * dpr));
    canvas.width = pW;
    canvas.height = pH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, pW, pH);

    const level = pickLevel(cache?.overview, pW);
    if (!level) return;

    const { bins, count } = level;
    const baseY = Math.round(pH * baseline);
    const upH = baseY;            // room above baseline
    const downH = pH - baseY;     // room below baseline

    for (let x = 0; x < pW; x++) {
      const bi = Math.min((x / pW) * count | 0, count - 1);
      const o = bi * OVERVIEW_FIELDS;

      const maxPeak = bins[o + OVERVIEW_MAX];
      const minPeak = -bins[o + OVERVIEW_MIN]; // stored negative
      const rms = bins[o + OVERVIEW_RMS];
      const low = bins[o + OVERVIEW_LOW];
      const mid = bins[o + OVERVIEW_MID];
      const high = bins[o + OVERVIEW_HIGH];

      // Single-band / debug modes
      if (mode !== "stack") {
        let v = 0;
        let col = BAND_HIGH as readonly number[];
        if (mode === "rms") { v = rms; col = [180, 200, 230]; }
        else if (mode === "peak") { v = Math.max(maxPeak, minPeak); col = [200, 200, 200]; }
        else if (mode === "low") { v = low; col = BAND_LOW; }
        else if (mode === "mid") { v = mid; col = BAND_MID; }
        else if (mode === "high") { v = high; col = BAND_HIGH; }
        const h = Math.round(Math.min(1, v) * upH);
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        ctx.fillRect(x, baseY - h, 1, h);
        continue;
      }

      // Stacked three-band: shape from peak+rms, split by band ratios
      const amplitude = Math.min(1, PEAK_WEIGHT * Math.max(maxPeak, minPeak) + RMS_WEIGHT * rms);
      const total = low + mid + high + EPS;
      const lowH = amplitude * (low / total);
      const midH = amplitude * (mid / total);
      const highH = amplitude * (high / total);

      // Upward stack (low at baseline → mid → high on top)
      const lowPx = Math.round(lowH * upH);
      const midPx = Math.round(midH * upH);
      const highPx = Math.round(highH * upH);
      let y = baseY;
      ctx.fillStyle = `rgb(${BAND_LOW[0]},${BAND_LOW[1]},${BAND_LOW[2]})`;
      ctx.fillRect(x, y - lowPx, 1, lowPx); y -= lowPx;
      ctx.fillStyle = `rgb(${BAND_MID[0]},${BAND_MID[1]},${BAND_MID[2]})`;
      ctx.fillRect(x, y - midPx, 1, midPx); y -= midPx;
      ctx.fillStyle = `rgb(${BAND_HIGH[0]},${BAND_HIGH[1]},${BAND_HIGH[2]})`;
      ctx.fillRect(x, y - highPx, 1, highPx);

      // Small downward reflection for body (dimmed)
      if (downH > 0 && reflect > 0) {
        const lowD = Math.round(lowH * downH * reflect);
        const midD = Math.round(midH * downH * reflect);
        const highD = Math.round(highH * downH * reflect);
        let yd = baseY;
        ctx.fillStyle = `rgba(${BAND_LOW[0]},${BAND_LOW[1]},${BAND_LOW[2]},0.55)`;
        ctx.fillRect(x, yd, 1, lowD); yd += lowD;
        ctx.fillStyle = `rgba(${BAND_MID[0]},${BAND_MID[1]},${BAND_MID[2]},0.5)`;
        ctx.fillRect(x, yd, 1, midD); yd += midD;
        ctx.fillStyle = `rgba(${BAND_HIGH[0]},${BAND_HIGH[1]},${BAND_HIGH[2]},0.45)`;
        ctx.fillRect(x, yd, 1, highD);
      }
    }
  }, [cache, width, height, bg, baseline, reflect, mode]);

  return <canvas ref={canvasRef} style={{ display: "block", width, height }} />;
}

/** True when the cache has a usable OVW3 overview (else fall back to peak renderer). */
export function hasOverview(cache: WaveformCache | null): boolean {
  if (!cache?.overview?.levels) return false;
  return Object.keys(cache.overview.levels).length > 0;
}
