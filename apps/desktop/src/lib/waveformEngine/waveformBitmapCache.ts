/**
 * LRU cache of rendered waveform bitmap canvases — avoids rebuild on catalog scroll.
 */

import type { WaveformMode } from "../../stores/selectStore";

const cache = new Map<string, HTMLCanvasElement>();
const MAX_ENTRIES = 96;

export function waveformBitmapKey(
  audioPath: string,
  physW: number,
  physH: number,
  mode: WaveformMode,
  variant: "peak" | "overview" = "peak",
): string {
  return `${variant}:v4:${audioPath}:${physW}x${physH}:${mode}`;
}

export function getCachedWaveformBitmap(
  key: string,
  build: () => HTMLCanvasElement,
): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.get(oldest)?.parentElement?.removeChild(cache.get(oldest)!);
      cache.delete(oldest);
    }
  }

  const canvas = build();
  cache.set(key, canvas);
  return canvas;
}

export function invalidateWaveformBitmaps(audioPath?: string) {
  if (!audioPath) {
    for (const c of cache.values()) c.parentElement?.removeChild(c);
    cache.clear();
    return;
  }
  for (const [k, c] of cache) {
    if (k.includes(audioPath)) {
      c.parentElement?.removeChild(c);
      cache.delete(k);
    }
  }
}
