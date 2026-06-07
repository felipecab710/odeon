import type { StereoPeakBucket, WaveformCache } from "./types";
import { PYRAMID_BLOCK_SIZES } from "./types";

/**
 * Select pyramid level: largest block size that still fits within one pixel.
 * Zoomed out → coarse buckets; zoomed in → fine buckets (down to 64 samples).
 */
export function selectLodBlockSize(samplesPerPixel: number): number {
  let best: number = PYRAMID_BLOCK_SIZES[0];
  for (const bs of PYRAMID_BLOCK_SIZES) {
    if (bs <= samplesPerPixel) best = bs;
    else break;
  }
  return best;
}

export function getLodPeaks(
  cache: WaveformCache,
  pixelsPerSecond: number,
  _viewportWidthPx: number,
): { blockSize: number; peaks: StereoPeakBucket[] } {
  const samplesPerPixel = cache.sample_rate / Math.max(pixelsPerSecond, 1);
  const idealBlock = selectLodBlockSize(samplesPerPixel);
  const idealKey = String(idealBlock);

  let peaks = cache.levels[idealKey];
  let blockSize = idealBlock;

  if (!peaks?.length) {
    const available = Object.keys(cache.levels)
      .map((k) => Number(k))
      .filter((bs) => cache.levels[String(bs)]?.length)
      .sort((a, b) => a - b);

    if (available.length) {
      let best = available[available.length - 1];
      for (const bs of available) {
        if (bs <= samplesPerPixel) best = bs;
        else break;
      }
      blockSize = best;
      peaks = cache.levels[String(best)]!;
    } else {
      peaks = [];
    }
  }

  return { blockSize, peaks };
}

/** Finest pyramid level — full detail for zoom windows and static previews. */
export function getFinestPeaks(cache: WaveformCache): { blockSize: number; peaks: StereoPeakBucket[] } {
  const sizes = Object.keys(cache.levels)
    .map((k) => Number(k))
    .filter((bs) => cache.levels[String(bs)]?.length)
    .sort((a, b) => a - b);

  const blockSize = sizes[0] ?? PYRAMID_BLOCK_SIZES[0];
  return { blockSize, peaks: cache.levels[String(blockSize)] ?? [] };
}

/** Coarsest pyramid level — instant paint while zooming (Ableton .asd overview tier). */
export function getCoarsestPeaks(cache: WaveformCache): { blockSize: number; peaks: StereoPeakBucket[] } {
  const sizes = Object.keys(cache.levels)
    .map((k) => Number(k))
    .filter((bs) => cache.levels[String(bs)]?.length)
    .sort((a, b) => b - a);

  const blockSize = sizes[0] ?? PYRAMID_BLOCK_SIZES[PYRAMID_BLOCK_SIZES.length - 1];
  return { blockSize, peaks: cache.levels[String(blockSize)] ?? [] };
}

/**
 * Max-pool peaks for one horizontal pixel column.
 * Maps pixel x → sample range → peak bucket indices in the LOD pyramid.
 */
export function peakForPixel(
  peaks: StereoPeakBucket[],
  x: number,
  widthPx: number,
  totalSamples: number,
  blockSize: number,
): StereoPeakBucket {
  if (peaks.length === 0 || widthPx < 1) {
    return { lm: 0, lx: 0, rm: 0, rx: 0 };
  }

  const s0 = (x / widthPx) * totalSamples;
  const s1 = ((x + 1) / widthPx) * totalSamples;
  const b0 = Math.max(0, Math.floor(s0 / blockSize));
  const b1 = Math.min(peaks.length - 1, Math.floor(s1 / blockSize));

  let lm = Infinity, lx = -Infinity, rm = Infinity, rx = -Infinity;
  for (let i = b0; i <= b1; i++) {
    const p = peaks[i];
    if (p.lm < lm) lm = p.lm;
    if (p.lx > lx) lx = p.lx;
    if (p.rm < rm) rm = p.rm;
    if (p.rx > rx) rx = p.rx;
  }
  if (lm === Infinity) {
    return { lm: 0, lx: 0, rm: 0, rx: 0 };
  }
  return { lm, lx, rm, rx };
}
