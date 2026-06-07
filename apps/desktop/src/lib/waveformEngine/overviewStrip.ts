/**
 * Fast OVW3 overview strip — Mixxx waveformSummary tier for catalog + lane thumbnails.
 */

import type { WaveformCache } from "./types";
import {
  OVERVIEW_FIELDS,
  OVERVIEW_HIGH,
  OVERVIEW_LEVELS,
  OVERVIEW_LOW,
  OVERVIEW_MAX,
  OVERVIEW_MID,
  OVERVIEW_MIN,
  OVERVIEW_RMS,
} from "./types";

const BAND_LOW: [number, number, number] = [47, 111, 224];
const BAND_MID: [number, number, number] = [232, 149, 31];
const BAND_HIGH: [number, number, number] = [242, 234, 216];
const PEAK_WEIGHT = 0.3;
const RMS_WEIGHT = 0.7;
const EPS = 1e-6;

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

export function hasOverview(cache: WaveformCache | null | undefined): boolean {
  if (!cache?.overview?.levels) return false;
  return Object.keys(cache.overview.levels).length > 0;
}

/** Paint a filled three-band overview strip (instant — no peak pyramid needed). */
export function paintOverviewStrip(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  physW: number,
  physH: number,
  bg = "#0a0a0a",
): boolean {
  const level = pickLevel(cache.overview, physW);
  if (!level) return false;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, physW, physH);

  const { bins, count } = level;
  const midRow = Math.round(physH / 2);
  const halfH = midRow;

  for (let x = 0; x < physW; x++) {
    const bi = Math.min(((x / physW) * count) | 0, count - 1);
    const o = bi * OVERVIEW_FIELDS;
    const maxPeak = bins[o + OVERVIEW_MAX];
    const minPeak = bins[o + OVERVIEW_MIN];
    const rms = bins[o + OVERVIEW_RMS];
    const low = bins[o + OVERVIEW_LOW];
    const mid = bins[o + OVERVIEW_MID];
    const high = bins[o + OVERVIEW_HIGH];

    const amplitude = Math.min(
      1,
      PEAK_WEIGHT * Math.max(maxPeak, Math.abs(minPeak)) + RMS_WEIGHT * rms,
    );
    const total = low + mid + high + EPS;
    const lowH = Math.max(1, Math.round(amplitude * (low / total) * halfH));
    const midH = Math.max(0, Math.round(amplitude * (mid / total) * halfH));
    const highH = Math.max(0, Math.round(amplitude * (high / total) * halfH));

    let y = midRow;
    ctx.fillStyle = `rgb(${BAND_LOW[0]},${BAND_LOW[1]},${BAND_LOW[2]})`;
    ctx.fillRect(x, y - lowH, 1, lowH);
    y -= lowH;
    ctx.fillStyle = `rgb(${BAND_MID[0]},${BAND_MID[1]},${BAND_MID[2]})`;
    ctx.fillRect(x, y - midH, 1, midH);
    y -= midH;
    ctx.fillStyle = `rgb(${BAND_HIGH[0]},${BAND_HIGH[1]},${BAND_HIGH[2]})`;
    ctx.fillRect(x, y - highH, 1, highH);
  }

  return true;
}
