import type { WaveformCache } from "./types";

const memoryCache = new Map<string, WaveformCache>();
const inflight = new Map<string, Promise<WaveformCache | null>>();

/** Path to sidecar cache next to audio file */
export function wavecachePath(audioPath: string): string {
  const dot = audioPath.lastIndexOf(".");
  if (dot < 0) return `${audioPath}.odeon.wavecache`;
  return `${audioPath.slice(0, dot)}${audioPath.slice(dot)}.odeon.wavecache`;
}

export async function loadWaveformCache(audioPath: string): Promise<WaveformCache | null> {
  if (!audioPath) return null;
  const cached = memoryCache.get(audioPath);
  if (cached) return cached;

  const pending = inflight.get(audioPath);
  if (pending) return pending;

  const promise = (async () => {
    try {
      // Tauri: read sidecar file from disk
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(wavecachePath(audioPath));
      const data = JSON.parse(text) as WaveformCache;
      if (data.version !== 1) return null;
      memoryCache.set(audioPath, data);
      return data;
    } catch {
      // Browser dev: fetch via API proxy
      try {
        const res = await fetch(
          `http://localhost:8000/waveform-cache?path=${encodeURIComponent(audioPath)}`
        );
        if (!res.ok) return null;
        const data = (await res.json()) as WaveformCache;
        memoryCache.set(audioPath, data);
        return data;
      } catch {
        return null;
      }
    }
  })();

  inflight.set(audioPath, promise);
  const result = await promise;
  inflight.delete(audioPath);
  return result;
}

export function getCachedWaveform(audioPath: string): WaveformCache | null {
  return memoryCache.get(audioPath) ?? null;
}

/** Inject a cache entry (e.g. from project analysis) without disk I/O. */
export function seedWaveformCache(audioPath: string, cache: WaveformCache) {
  if (!audioPath) return;
  memoryCache.set(audioPath, cache);
}

/** True when a full sidecar cache is loaded (more levels than analysis seed). */
export function isFullWaveformCache(cache: WaveformCache): boolean {
  return Object.keys(cache.levels).length > 1
    || (Object.values(cache.levels)[0]?.length ?? 0) > 5000;
}
