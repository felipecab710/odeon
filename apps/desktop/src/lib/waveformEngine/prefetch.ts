import type { CatalogEntry, OdeonProject } from "@odeon/shared";
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

type SelectWaveformJob = {
  filePath: string;
  cachePath?: string | null;
  entryId?: string | null;
};

/** Background prefetch for Select catalog mini-waveforms (throttled disk I/O). */
export function prefetchSelectCatalogWaveforms(entries: CatalogEntry[]) {
  const jobs: SelectWaveformJob[] = entries
    .filter((e) => e.status === "ready" && e.file_path)
    .filter((e) => !isFullWaveformCache(getCachedWaveform(e.file_path!) ?? EMPTY_CACHE))
    .map((e) => ({
      filePath: e.file_path,
      cachePath: e.waveform_cache_path,
      entryId: e.id,
    }));

  if (!jobs.length) return;
  void throttledSelectFetch(jobs, 4);
}

const EMPTY_CACHE = {
  levels: {},
  block_sizes: [],
  version: 0,
  sample_rate: 0,
  channels: 0,
  duration_seconds: 0,
  global_peak: 0,
} as const;

async function throttledSelectFetch(jobs: SelectWaveformJob[], concurrency: number) {
  let index = 0;

  async function worker() {
    while (index < jobs.length) {
      const job = jobs[index++];
      await loadWaveformCache(job.filePath, job.cachePath, job.entryId);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
  );
}
