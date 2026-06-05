/**
 * Build a waveform LOD pyramid from a decoded AudioBuffer.
 * Guarantees a display cache whenever audio is loaded — even if analysis/sidecar failed.
 */
import type { StereoPeakBucket, WaveformCache } from "./types";
import { PYRAMID_BLOCK_SIZES } from "./types";

const MAX_BUCKETS = 6000;

export function waveformCacheFromBuffer(buffer: AudioBuffer): WaveformCache {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const total = left.length;
  const sample_rate = buffer.sampleRate;
  const duration_seconds = buffer.duration;
  const channels = buffer.numberOfChannels;

  let global_peak = 1e-9;
  for (let i = 0; i < total; i++) {
    const al = Math.abs(left[i]);
    const ar = Math.abs(right[i]);
    if (al > global_peak) global_peak = al;
    if (ar > global_peak) global_peak = ar;
  }

  const levels: Record<string, StereoPeakBucket[]> = {};
  const block_sizes: number[] = [];

  for (const blockSize of PYRAMID_BLOCK_SIZES) {
    const nBlocks = Math.ceil(total / blockSize);
    if (nBlocks > MAX_BUCKETS) continue;

    block_sizes.push(blockSize);
    const peaks: StereoPeakBucket[] = new Array(nBlocks);

    for (let b = 0; b < nBlocks; b++) {
      const s0 = b * blockSize;
      const s1 = Math.min(s0 + blockSize, total);
      let lm = Infinity, lx = -Infinity, rm = Infinity, rx = -Infinity;

      for (let i = s0; i < s1; i++) {
        const lv = left[i];
        const rv = right[i];
        if (lv < lm) lm = lv;
        if (lv > lx) lx = lv;
        if (rv < rm) rm = rv;
        if (rv > rx) rx = rv;
      }

      if (lm === Infinity) {
        peaks[b] = { lm: 0, lx: 0, rm: 0, rx: 0 };
      } else {
        peaks[b] = {
          lm: lm / global_peak,
          lx: lx / global_peak,
          rm: rm / global_peak,
          rx: rx / global_peak,
        };
      }
    }

    levels[String(blockSize)] = peaks;
  }

  if (!block_sizes.length) {
    block_sizes.push(PYRAMID_BLOCK_SIZES[PYRAMID_BLOCK_SIZES.length - 1]);
    levels[String(block_sizes[0])] = [];
  }

  return {
    version: 1,
    sample_rate,
    channels,
    duration_seconds,
    global_peak,
    block_sizes,
    levels,
  };
}
