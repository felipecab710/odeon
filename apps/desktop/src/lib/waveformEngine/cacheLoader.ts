import { OVERVIEW_FIELDS, OVERVIEW_LEVELS } from "./types";
import type { FreqColors, WaveformCache, WaveformOverview } from "./types";

const memoryCache = new Map<string, WaveformCache>();
const inflight = new Map<string, Promise<WaveformCache | null>>();

const CACHE_VERSION_V1 = 1;
const CACHE_VERSION_V2 = 2;
const MAGIC = 0x4f445743; // 'ODWC'
const COLR_MAGIC = 0x524c4f43; // 'COLR' LE
const OVW3_MAGIC = 0x3357564f; // 'OVW3' LE

function isSectionMagic(tag: number): boolean {
  return tag === COLR_MAGIC || tag === OVW3_MAGIC;
}

function peakBucketCount(meta: { total_samples?: number; duration_seconds?: number; sample_rate?: number }, blockSize: number): number {
  const totalSamples = meta.total_samples
    || Math.round((meta.duration_seconds ?? 0) * (meta.sample_rate ?? 44100));
  if (!totalSamples || !blockSize) return 0;
  return Math.ceil(totalSamples / blockSize);
}

/** Locate start of COLR/OVW3 trailing sections (scan tail — peaks can be several MB). */
function findPeakSectionEnd(view: DataView, peakStart: number, bufLen: number): number {
  const tailScan = Math.min(bufLen, Math.max(peakStart + 64, bufLen - 8192));
  for (let i = tailScan; i + 4 <= bufLen; i++) {
    if (isSectionMagic(view.getUint32(i, true))) return i;
  }
  return bufLen;
}

export function hasPeakLevels(cache: WaveformCache | null | undefined): boolean {
  if (!cache?.levels) return false;
  return Object.values(cache.levels).some((level) => (level?.length ?? 0) > 0);
}

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
  const peakStart = 12 + metaLen;
  const peakEnd = findPeakSectionEnd(view, peakStart, buf.byteLength);
  let offset = peakStart;

  for (const blockSize of meta.block_sizes) {
    if (offset >= peakEnd) break;
    if (offset + 4 <= peakEnd && isSectionMagic(view.getUint32(offset, true))) break;

    let nBuckets = peakBucketCount(meta, blockSize);
    let byteLen = nBuckets * 16;
    const remaining = peakEnd - offset;
    if (byteLen > remaining) {
      nBuckets = Math.floor(remaining / 16);
      byteLen = nBuckets * 16;
    }
    if (nBuckets <= 0) break;

    const slice = buf.slice(offset, offset + byteLen);
    const arr = new Float32Array(slice);
    const buckets: { lm: number; lx: number; rm: number; rx: number }[] = new Array(nBuckets);
    for (let i = 0; i < nBuckets; i++) {
      const base = i * 4;
      buckets[i] = { lm: arr[base], lx: arr[base + 1], rm: arr[base + 2], rx: arr[base + 3] };
    }
    levels[String(blockSize)] = buckets;
    offset += byteLen;
  }

  if (!hasPeakLevels({ levels } as WaveformCache)) return null;

  // Try to parse optional COLR section (frequency colors)
  let freqColors: FreqColors | undefined;
  if (offset + 8 <= buf.byteLength && view.getUint32(offset, true) === COLR_MAGIC) {
    const n = view.getUint32(offset + 4, true);
    if (offset + 8 + n * 3 <= buf.byteLength) {
      const base = offset + 8;
      // Slice to detached buffers so they're always properly aligned
      freqColors = {
        bass: new Uint8Array(buf.slice(base,         base + n)),
        mid:  new Uint8Array(buf.slice(base + n,     base + 2 * n)),
        high: new Uint8Array(buf.slice(base + 2 * n, base + 3 * n)),
      };
      offset = base + n * 3;
    }
  }

  const overview = parseOverviewSection(buf, view, offset);

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
    overview,
  };
}

/** Parse optional OVW3 three-band overview section. */
function parseOverviewSection(
  buf: ArrayBuffer,
  view: DataView,
  offset: number,
): WaveformOverview | undefined {
  if (offset + 8 > buf.byteLength || view.getUint32(offset, true) !== OVW3_MAGIC) {
    return undefined;
  }
  const nLevels = view.getUint32(offset + 4, true);
  let pos = offset + 8;
  const binCounts: number[] = [];
  for (let i = 0; i < nLevels; i++) {
    if (pos + 4 > buf.byteLength) return undefined;
    binCounts.push(view.getUint32(pos, true));
    pos += 4;
  }
  const levels: Record<string, Float32Array> = {};
  for (let i = 0; i < binCounts.length; i++) {
    const byteLen = binCounts[i] * OVERVIEW_FIELDS * 4;
    if (pos + byteLen > buf.byteLength) return undefined;
    // slice for guaranteed 4-byte alignment
    levels[String(OVERVIEW_LEVELS[i] ?? binCounts[i])] = new Float32Array(
      buf.slice(pos, pos + byteLen),
    );
    pos += byteLen;
  }
  return { levels };
}

/** Read sidecar from disk (Tauri) or API (browser dev). Handles v1 JSON and v2 binary. */
async function fetchSidecarBytes(cachePath: string): Promise<ArrayBuffer | null> {
  try {
    const { readFile, stat } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(cachePath);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>);
    try {
      const info = await stat(cachePath);
      if (info.size != null && info.size > 0 && u8.byteLength !== info.size) {
        throw new Error("incomplete sidecar read");
      }
    } catch (statErr) {
      if (statErr instanceof Error && statErr.message === "incomplete sidecar read") throw statErr;
    }
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  } catch {
    try {
      const res = await fetch(
        `http://localhost:8000/select/waveform?path=${encodeURIComponent(cachePath)}`,
      );
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }
}

function decodeSidecar(buf: ArrayBuffer): WaveformCache | null {
  if (buf.byteLength < 4) return null;
  const view = new DataView(buf);
  if (view.getUint32(0, false) === MAGIC) {
    return parseBinaryV2(buf);
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buf))) as WaveformCache;
    if (data.version !== CACHE_VERSION_V1 || !hasPeakLevels(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Read sidecar from disk (Tauri) or API (browser dev). Handles v1 JSON and v2 binary. */
async function fetchSidecar(cachePath: string): Promise<WaveformCache | null> {
  if (!cachePath) return null;

  // Prefer API when disk read yields no peak data (truncated read / plugin quirks).
  let buf = await fetchSidecarBytes(cachePath);
  if (!buf) return null;

  let data = decodeSidecar(buf);
  if (!data && buf.byteLength >= 4 && new DataView(buf).getUint32(0, false) === MAGIC) {
    buf = await fetchSidecarBytesViaApi(cachePath);
    data = buf ? decodeSidecar(buf) : null;
  }
  return data;
}

async function fetchSidecarBytesViaApi(cachePath: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      `http://localhost:8000/select/waveform?path=${encodeURIComponent(cachePath)}`,
    );
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function rebuildEntryWaveform(entryId: string): Promise<void> {
  try {
    await fetch(`http://localhost:8000/select/entries/${entryId}/rebuild-waveform`, {
      method: "POST",
    });
  } catch {
    /* best-effort */
  }
}

export async function loadWaveformCache(
  audioPath: string,
  cachePath?: string | null,
  entryId?: string | null,
): Promise<WaveformCache | null> {
  if (!audioPath) return null;

  const sidecar = cachePath || wavecachePath(audioPath);

  const cached = memoryCache.get(audioPath);
  if (cached && isFullWaveformCache(cached) && !isCorruptWaveformCache(cached)) {
    return cached;
  }

  const pending = inflight.get(audioPath);
  if (pending) return pending;

  const promise = (async () => {
    let data = await fetchSidecar(sidecar);
    if (data && isCorruptWaveformCache(data) && entryId) {
      memoryCache.delete(audioPath);
      await rebuildEntryWaveform(entryId);
      data = await fetchSidecar(sidecar);
    }
    if (data && isCorruptWaveformCache(data)) data = null;
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
  if (existing && isFullWaveformCache(existing) && !isCorruptWaveformCache(existing)) return;
  memoryCache.set(audioPath, cache);
}

/** True when a full sidecar cache is loaded (multiple levels or large bucket count). */
export function isFullWaveformCache(cache: WaveformCache): boolean {
  return (
    Object.keys(cache.levels).length > 1 ||
    (Object.values(cache.levels)[0]?.length ?? 0) > 5000
  );
}

/** Detect truncated pyramid data (e.g. librosa channel-order bug wrote 1 bucket). */
export function isCorruptWaveformCache(cache: WaveformCache): boolean {
  if (!hasPeakLevels(cache)) return true;
  const dur = cache.duration_seconds ?? 0;
  const sr = cache.sample_rate ?? 44100;
  if (dur < 5 || !sr) return false;
  const maxBuckets = Math.max(0, ...Object.values(cache.levels).map((l) => l?.length ?? 0));
  const minExpected = Math.max(20, Math.ceil((dur * sr) / 16384));
  return maxBuckets < minExpected;
}

/** Invalidate the in-memory entry for a given audio path. */
export function invalidateCachedWaveform(audioPath: string) {
  memoryCache.delete(audioPath);
}

/** Flush the entire in-memory cache (call after a parser fix or format change). */
export function clearAllWaveformCache() {
  memoryCache.clear();
}
