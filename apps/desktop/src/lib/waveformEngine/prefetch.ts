import type { OdeonProject } from "@odeon/shared";
import { waveformCacheFromAnalysis } from "./analysisCache";
import { getCachedWaveform, isFullWaveformCache, loadWaveformCache, seedWaveformCache } from "./cacheLoader";

/** Synchronous — seed in-memory caches from project analysis (instant paint). */
export function seedProjectWaveformCaches(project: OdeonProject) {
  for (const track of project.tracks) {
    if (!track.file_path || !track.analysis) continue;
    const existing = getCachedWaveform(track.file_path);
    if (existing && isFullWaveformCache(existing)) continue;
    const cache = waveformCacheFromAnalysis(track.analysis);
    if (cache) seedWaveformCache(track.file_path, cache);
  }
}

/** Background — load full sidecar caches from disk with max 3 concurrent I/O operations.
 *
 * Throttled to avoid spiking disk I/O and main-thread JSON parse on session open.
 * Prioritizes tracks in order (top = first in timeline).
 */
export function prefetchProjectWaveformCaches(project: OdeonProject) {
  const paths = project.tracks
    .map((t) => t.file_path)
    .filter((p): p is string => !!p && !isFullWaveformCache(getCachedWaveform(p) ?? { levels: {}, block_sizes: [], version: 0, sample_rate: 0, channels: 0, duration_seconds: 0, global_peak: 0 }));

  if (!paths.length) return;
  void throttledFetch(paths, 3);
}

async function throttledFetch(paths: string[], concurrency: number) {
  let index = 0;

  async function worker() {
    while (index < paths.length) {
      const path = paths[index++];
      await loadWaveformCache(path);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, worker)
  );
}
