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

/** Background — upgrade to full-resolution sidecar caches in parallel. */
export function prefetchProjectWaveformCaches(project: OdeonProject) {
  const paths = project.tracks
    .map((t) => t.file_path)
    .filter((p): p is string => !!p);
  void Promise.all(paths.map((p) => loadWaveformCache(p)));
}
