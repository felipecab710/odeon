import type { WaveformCache } from "./waveformEngine/types";

/**
 * Mixxx uses track_samples / sample_rate — the waveform bitmap spans exactly this
 * many seconds (one bucket column per block of samples). Metadata duration_seconds
 * can drift from bucket layout and causes cue markers to slide off the wave.
 */
export function getWaveformTrackDuration(cache: WaveformCache | null | undefined): number {
  if (!cache?.sample_rate || cache.sample_rate <= 0) return 0;

  let bestKey = String(cache.block_sizes[0] ?? 256);
  let bestLen = 0;
  for (const bs of cache.block_sizes) {
    const len = cache.levels[String(bs)]?.length ?? 0;
    if (len > bestLen) {
      bestLen = len;
      bestKey = String(bs);
    }
  }
  const buckets = cache.levels[bestKey];
  if (!buckets?.length) return cache.duration_seconds ?? 0;

  const blockSize = parseInt(bestKey, 10) || 256;
  return (buckets.length * blockSize) / cache.sample_rate;
}

/**
 * Mixxx uses track sample count as the single time base for waveform + cues.
 */
export function resolveTrackDuration(options: {
  cache?: WaveformCache | null;
  entryDuration?: number | null;
  audioDuration?: number;
}): number {
  if (options.cache) {
    const waveDur = getWaveformTrackDuration(options.cache);
    if (waveDur > 0 && Number.isFinite(waveDur)) return waveDur;
  }

  const cacheDur = options.cache?.duration_seconds;
  if (cacheDur != null && cacheDur > 0 && Number.isFinite(cacheDur)) return cacheDur;

  const entryDur = options.entryDuration;
  if (entryDur != null && entryDur > 0 && Number.isFinite(entryDur)) return entryDur;

  const audioDur = options.audioDuration;
  if (audioDur != null && audioDur > 0 && Number.isFinite(audioDur)) return audioDur;

  return 0;
}

/** Map seconds → pixel X (full overview width). */
export function timeToPixel(timeSec: number, trackDurationSec: number, pixelWidth: number): number {
  if (trackDurationSec <= 0 || pixelWidth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, timeSec / trackDurationSec));
  return Math.round(ratio * pixelWidth);
}

/** Map pixel X → seconds (full overview width). */
export function pixelToTime(pixelX: number, pixelWidth: number, trackDurationSec: number): number {
  if (trackDurationSec <= 0 || pixelWidth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, pixelX / pixelWidth));
  return ratio * trackDurationSec;
}

/** Snap to nearest beat when a grid exists (Mixxx quantize-on-set behavior). */
export function snapToBeatGrid(timeSec: number, beatTimes: number[] | null | undefined): number {
  if (!beatTimes?.length) return timeSec;
  let best = beatTimes[0];
  let bestDist = Math.abs(timeSec - best);
  for (const bt of beatTimes) {
    const d = Math.abs(timeSec - bt);
    if (d < bestDist) {
      bestDist = d;
      best = bt;
    }
  }
  return best;
}
