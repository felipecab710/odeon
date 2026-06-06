import type { FreqColors, WaveformCache } from "./types";

const memoryCache = new Map<string, WaveformCache>();
const inflight = new Map<string, Promise<WaveformCache | null>>();

const CACHE_VERSION_V1 = 1;
const CACHE_VERSION_V2 = 2;
const MAGIC = 0x4f445743; // 'ODWC'

/** Path to sidecar cache next to audio file */
export function wavecachePath(audioPath: string): string {
  const dot = audioPath.lastIndexOf(".");
  if (dot < 0) return `${audioPath}.odeon.wavecache`;
  return `${audioPath.slice(0, dot)}${audioPath.slice(dot)}.odeon.wavecache`;
}

/** Parse v2 binary sidecar into WaveformCache.
 *
 * Layout (LE):
 *   magic         4 bytes  uint32  = 0x4F445743 ('ODWC')
 *   version       4 bytes  uint32  = 2
 *   meta_json_len 4 bytes  uint32
 *   meta_json     N bytes  UTF-8
 *   data          M bytes  per-level float32[n_buckets * 4] (lm, lx, rm, rx)
 */
function parseBinaryV2(buf: ArrayBuffer): WaveformCache | null {
  const view = new DataView(buf);
  if (buf.byteLength < 12) return null;

  // Magic bytes 'ODWC' are raw ASCII — must be read big-endian to match 0x4F445743
  const magic = view.getUint32(0, false);
  const version = view.getUint32(4, true);
  if (magic !== MAGIC || version !== CACHE_VERSION_V2) return null;

  const metaLen = view.getUint32(8, true);
  if (12 + metaLen > buf.byteLength) return null;

  const metaBytes = new Uint8Array(buf, 12, metaLen);
  let meta: {
    sample_rate: number;
    channels: number;
    duration_seconds: number;
    global_peak: number;
    block_sizes: number[];
    total_samples: number;
    source_hash?: string;
  };
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes));
  } catch {
    return null;
  }

  const levels: Record<string, { lm: number; lx: number; rm: number; rx: number }[]> = {};
  let offset = 12 + metaLen;

  for (const blockSize of meta.block_sizes) {
    // total_samples missing in old caches — fall back to duration × sample_rate
    const totalSamples = meta.total_samples
      || Math.round((meta.duration_seconds ?? 0) * (meta.sample_rate ?? 44100));
    const nBuckets = totalSamples
      ? Math.ceil(totalSamples / blockSize)
      : 0;
    const byteLen = nBuckets * 4 * 4;
    if (offset + byteLen > buf.byteLength) break;

    // Float32Array requires 4-byte-aligned offsets. If offset is not aligned,
    // slice out a fresh aligned copy first.
    const slice = buf.slice(offset, offset + byteLen);
    const arr = new Float32Array(slice);
    const buckets: { lm: number; lx: number; rm: number; rx: number }[] = [];
    for (let i = 0; i < nBuckets; i++) {
      const base = i * 4;
      buckets.push({ lm: arr[base], lx: arr[base + 1], rm: arr[base + 2], rx: arr[base + 3] });
    }
    levels[String(blockSize)] = buckets;
    offset += byteLen;
  }

  // Try to parse optional COLR section (frequency colors)
  let freqColors: FreqColors | undefined;
  const COLR = 0x524c4f43; // 'COLR' LE
  if (offset + 8 <= buf.byteLength && view.getUint32(offset, true) === COLR) {
    const n = view.getUint32(offset + 4, true);
    if (offset + 8 + n * 3 <= buf.byteLength) {
      const base = offset + 8;
      // Slice to detached buffers so they're always properly aligned
      freqColors = {
        bass: new Uint8Array(buf.slice(base,         base + n)),
        mid:  new Uint8Array(buf.slice(base + n,     base + 2 * n)),
        high: new Uint8Array(buf.slice(base + 2 * n, base + 3 * n)),
      };
    }
  }

  return {
    version: CACHE_VERSION_V2,
    sample_rate: meta.sample_rate,
    channels: meta.channels,
    duration_seconds: meta.duration_seconds,
    global_peak: meta.global_peak,
    block_sizes: meta.block_sizes,
    levels,
    source_hash: meta.source_hash,
    freqColors,
  };
}

/** Read sidecar from disk (Tauri) or API (browser dev). Handles v1 JSON and v2 binary. */
async function fetchSidecar(audioPath: string): Promise<WaveformCache | null> {
  try {
    // Tauri fast path: read bytes from disk
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(wavecachePath(audioPath));

    // Tauri readFile returns a Uint8Array that may have byteOffset > 0 in a
    // shared pool buffer — always slice to get a correctly-aligned ArrayBuffer.
    const buf: ArrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );

    // Detect v2 binary vs v1 JSON by magic bytes ('ODWC') — read big-endian
    const view = new DataView(buf);
    if (buf.byteLength >= 4 && view.getUint32(0, false) === MAGIC) {
      return parseBinaryV2(buf);
    }

    // v1 JSON fallback
    try {
      const text = new TextDecoder().decode(bytes);
      const data = JSON.parse(text) as WaveformCache;
      if (data.version !== CACHE_VERSION_V1) return null;
      return data;
    } catch {
      return null;
    }
  } catch {
    // Browser / Tauri plugin not available: fetch binary directly from API
    try {
      const res = await fetch(
        `http://localhost:8000/select/waveform?path=${encodeURIComponent(wavecachePath(audioPath))}`,
      );
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const view = new DataView(buf);
      if (buf.byteLength >= 4 && view.getUint32(0, false) === MAGIC) {
        return parseBinaryV2(buf);
      }
      return null;
    } catch {
      return null;
    }
  }
}

export async function loadWaveformCache(audioPath: string): Promise<WaveformCache | null> {
  if (!audioPath) return null;

  const cached = memoryCache.get(audioPath);
  if (cached) return cached;

  const pending = inflight.get(audioPath);
  if (pending) return pending;

  const promise = (async () => {
    const data = await fetchSidecar(audioPath);
    if (data) memoryCache.set(audioPath, data);
    return data;
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
  // Don't overwrite a full sidecar with a coarse analysis seed
  const existing = memoryCache.get(audioPath);
  if (existing && isFullWaveformCache(existing)) return;
  memoryCache.set(audioPath, cache);
}

/** True when a full sidecar cache is loaded (multiple levels or large bucket count). */
export function isFullWaveformCache(cache: WaveformCache): boolean {
  return (
    Object.keys(cache.levels).length > 1 ||
    (Object.values(cache.levels)[0]?.length ?? 0) > 5000
  );
}

/** Invalidate the in-memory entry for a given audio path. */
export function invalidateCachedWaveform(audioPath: string) {
  memoryCache.delete(audioPath);
}

/** Flush the entire in-memory cache (call after a parser fix or format change). */
export function clearAllWaveformCache() {
  memoryCache.clear();
}
