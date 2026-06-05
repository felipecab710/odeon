import type { StereoPeakBucket } from "./types";

/** Max samples/pixel before per-pixel AudioBuffer scan becomes too costly. */
export const MAX_FINE_PEAK_SPP = 8192;

export function samplesPerPixel(sampleRate: number, pps: number): number {
  return sampleRate / Math.max(pps, 1);
}

/**
 * Use raw AudioBuffer samples when each pixel spans less than one LOD bucket
 * (or when buckets are very coarse, e.g. analysis-only cache).
 */
export function shouldUseFinePeaks(
  sampleRate: number,
  pps: number,
  lodBlockSize: number,
  hasBuffer: boolean,
): boolean {
  if (!hasBuffer) return false;
  const spp = samplesPerPixel(sampleRate, pps);
  // Use raw samples whenever zoom exceeds LOD resolution.
  return spp < MAX_FINE_PEAK_SPP;
}

/** @deprecated use shouldUseFinePeaks */
export function needsFinePeaks(sampleRate: number, pps: number): boolean {
  return samplesPerPixel(sampleRate, pps) < 64;
}

/**
 * Per-pixel min/max from decoded audio — sample-accurate at high zoom.
 */
export function peakForPixelFromBuffer(
  left: Float32Array,
  right: Float32Array,
  x: number,
  widthPx: number,
  globalPeak: number,
): StereoPeakBucket {
  const total = left.length;
  if (total === 0 || widthPx < 1) {
    return { lm: 0, lx: 0, rm: 0, rx: 0 };
  }

  const s0 = Math.floor((x / widthPx) * total);
  const s1 = Math.max(s0 + 1, Math.floor(((x + 1) / widthPx) * total));
  const norm = globalPeak > 1e-9 ? globalPeak : 1;

  // Init to ±Infinity — starting at 0 makes lm stick at 0 when all samples are
  // positive, which draws fill only above the centre line (lighter top / darker bottom).
  let lm = Infinity, lx = -Infinity, rm = Infinity, rx = -Infinity;
  for (let i = s0; i < s1 && i < total; i++) {
    const lv = left[i];
    const rv = right[i] ?? lv;
    if (lv < lm) lm = lv;
    if (lv > lx) lx = lv;
    if (rv < rm) rm = rv;
    if (rv > rx) rx = rv;
  }
  if (lm === Infinity) {
    return { lm: 0, lx: 0, rm: 0, rx: 0 };
  }

  return {
    lm: lm / norm,
    lx: lx / norm,
    rm: rm / norm,
    rx: rx / norm,
  };
}
