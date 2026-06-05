/**
 * Pro Tools / Ardour-style waveform peak resampling.
 *
 * Display one peak bucket per screen pixel using MAX pooling when zoomed out,
 * and linear interpolation when zoomed in beyond source resolution — the same
 * strategy DAWs use for overview → detail waveform previews.
 */

export function maxPoolPeaks(peaks: number[], widthPx: number): number[] {
  const w = Math.max(1, Math.floor(widthPx));
  const n = peaks.length;
  if (n === 0) return [];
  if (n === 1) return Array(w).fill(peaks[0]);

  const out = new Array<number>(w);
  for (let x = 0; x < w; x++) {
    const t0 = (x / w) * n;
    const t1 = ((x + 1) / w) * n;
    const i0 = Math.floor(t0);
    const i1 = Math.min(n, Math.ceil(t1));
    let max = 0;
    for (let i = i0; i < i1; i++) max = Math.max(max, peaks[i] ?? 0);
    out[x] = max;
  }
  return out;
}

export function interpolatePeaks(peaks: number[], widthPx: number): number[] {
  const w = Math.max(1, Math.floor(widthPx));
  const n = peaks.length;
  if (n === 0) return [];
  if (w <= n) return maxPoolPeaks(peaks, w);

  const out = new Array<number>(w);
  for (let x = 0; x < w; x++) {
    const t = (x / (w - 1)) * (n - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = t - i0;
    out[x] = (peaks[i0] ?? 0) * (1 - f) + (peaks[i1] ?? 0) * f;
  }
  return out;
}

/** Pick resampling strategy based on pixels-per-source-point ratio. */
export function peaksForDisplay(peaks: number[], widthPx: number): number[] {
  if (peaks.length === 0 || widthPx < 1) return [];
  return widthPx > peaks.length * 2
    ? interpolatePeaks(peaks, widthPx)
    : maxPoolPeaks(peaks, widthPx);
}
