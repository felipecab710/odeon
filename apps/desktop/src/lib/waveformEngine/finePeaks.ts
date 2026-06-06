import type { StereoPeakBucket } from "./types";

export function samplesPerPixel(sampleRate: number, pps: number): number {
  return sampleRate / Math.max(pps, 1);
}

/**
 * Use raw AudioBuffer samples only when zoomed in beyond the finest LOD bucket.
 *
 * Previously this used a hardcoded threshold of 8192, which forced expensive
 * per-pixel AudioBuffer scans at almost all zoom levels once a buffer was decoded.
 * Correct logic: switch to fine peaks only when spp < lodBlockSize (i.e. each
 * pixel represents less than one peak bucket, so LOD data isn't fine enough).
 *
 * This restores O(viewport × buckets_per_pixel) LOD path for normal/overview zoom,
 * reserving the costly per-sample scan for extreme close-ups only.
 */
export function shouldUseFinePeaks(
  sampleRate: number,
  pps: number,
  lodBlockSize: number,
  hasBuffer: boolean,
): boolean {
  if (!hasBuffer) return false;
  const spp = samplesPerPixel(sampleRate, pps);
  // Only scan raw samples when zoom exceeds finest LOD bucket resolution
  return spp < lodBlockSize;
}

/**
 * Per-pixel min/max from decoded audio — sample-accurate at high zoom.
 * Only called when shouldUseFinePeaks() returns true.
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
  // positive, which draws fill only above the centre line.
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
