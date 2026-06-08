/**
 * Waveform canvas renderer — LOD pyramid for overview, sample peaks at high zoom.
 *
 * Key improvements over v1:
 * - Path2D single-stroke envelopes instead of per-column fillRect + 4 strokes
 * - Tile-based LRU bitmap cache: tiles of TILE_WIDTH px, keyed by (track, tile, pps, blockSize)
 * - fastMode: coarsest LOD only (used during zoom gestures)
 */
import type { WaveformCache } from "./types";
import { getCoarsestPeaks, getLodPeaks, peakForPixel } from "./lod";
import { peakForPixelFromBuffer, shouldUseFinePeaks } from "./finePeaks";
import { waveformColorsFromClip } from "../clipColorPresets";
import { PT_TRACK_BG, PT_CENTER_LINE } from "./colors";

export const TILE_WIDTH = 512; // pixels per tile (CSS pixels)
const COLOR_REV = "v11";
const BITMAP_CACHE_MAX = 256;

export interface RenderKey {
  trackId: string;
  /** Full clip width in pixels at current pps */
  width: number;
  height: number;
  pps: number;
  clipStartSec: number;
  clipBgColor?: string;
  /** Viewport start within the clip (for direct paint mode) */
  offsetX?: number;
  /** Viewport width (for direct paint mode) */
  renderWidth?: number;
  audioBuffer?: AudioBuffer | null;
  fastMode?: boolean;
  /** Override clip-derived envelope colours (Audacity-style black wave on hue clip). */
  waveFill?: string;
  waveOutline?: string;
  /** 'mirrored' = single black silhouette centred on clip (Audacity); 'stereo' = L/R split. */
  waveLayout?: "stereo" | "mirrored";
  showCenterLine?: boolean;
}

// ── Tile bitmap cache ──────────────────────────────────────────────────────

const tileCache = new Map<string, HTMLCanvasElement>();

function tileCacheKey(
  trackId: string,
  tileIndex: number,
  height: number,
  blockSize: number,
  pps: number,
  clipBgColor: string,
  waveLayout = "stereo",
  waveFill = "",
): string {
  return `${COLOR_REV}:${clipBgColor}:${waveLayout}:${waveFill}:${trackId}:${height}:${pps.toFixed(2)}:bs${blockSize}:t${tileIndex}`;
}

export function getTileCache() { return tileCache; }

export function invalidateWaveformBitmap(trackId: string) {
  const needle = `:${trackId}:`;
  for (const k of tileCache.keys()) {
    if (k.includes(needle)) tileCache.delete(k);
  }
}

export function clearWaveformBitmapCache() {
  tileCache.clear();
}

function evictIfNeeded() {
  if (tileCache.size > BITMAP_CACHE_MAX) {
    const iter = tileCache.keys();
    for (let i = 0; i < 16; i++) {
      const key = iter.next().value;
      if (key) tileCache.delete(key);
    }
  }
}

// ── Path2D envelope drawing ────────────────────────────────────────────────

/** Draw filled waveform body + outline strokes for one channel using Path2D.
 *
 * Replaces per-column fillRect (renderW draw calls) with two Path2D passes
 * (one fill, one stroke) — typically 5–10× fewer Canvas2D operations.
 */
function drawChannelPath2D(
  ctx: CanvasRenderingContext2D,
  peaks: { top: Float32Array; bot: Float32Array },
  renderW: number,
  fill: string,
  outline: string,
) {
  const { top, bot } = peaks;

  // Fill path: top edge left→right, bottom edge right→left
  const fillPath = new Path2D();
  fillPath.moveTo(0, top[0]);
  for (let x = 1; x < renderW; x++) fillPath.lineTo(x, top[x]);
  for (let x = renderW - 1; x >= 0; x--) fillPath.lineTo(x, bot[x]);
  fillPath.closePath();

  ctx.fillStyle = fill;
  ctx.fill(fillPath);

  // Outline: top edge only (bottom mirrors)
  const outPath = new Path2D();
  outPath.moveTo(0, top[0]);
  for (let x = 1; x < renderW; x++) outPath.lineTo(x, top[x]);

  const outPathBot = new Path2D();
  outPathBot.moveTo(0, bot[0]);
  for (let x = 1; x < renderW; x++) outPathBot.lineTo(x, bot[x]);

  if (outline && outline !== "none") {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.75;
    ctx.stroke(outPath);
    ctx.stroke(outPathBot);
  }
}

// ── Core paint ─────────────────────────────────────────────────────────────

export function paintWaveform(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  key: RenderKey,
  renderW: number,
  h: number,
) {
  const fast = key.fastMode === true;
  const lod = fast
    ? getCoarsestPeaks(cache)
    : getLodPeaks(cache, key.pps, key.width);
  const { blockSize, peaks } = lod;

  const useFine = !fast && shouldUseFinePeaks(
    cache.sample_rate,
    key.pps,
    blockSize,
    !!key.audioBuffer,
  );

  const clipBg = key.clipBgColor ?? PT_TRACK_BG;
  const derived = waveformColorsFromClip(clipBg);
  const waveFill = key.waveFill ?? derived.fill;
  const waveOutline = key.waveOutline ?? derived.outline;

  ctx.fillStyle = clipBg;
  ctx.fillRect(0, 0, renderW, h);

  const mid = h / 2;
  const layout = key.waveLayout ?? "stereo";
  const fullW = key.width;
  const offsetX = key.offsetX ?? 0;
  const totalSamples = cache.duration_seconds * cache.sample_rate;
  const norm = cache.global_peak > 1e-9 ? cache.global_peak : 1;

  const left = key.audioBuffer?.getChannelData(0);
  const right = key.audioBuffer && key.audioBuffer.numberOfChannels > 1
    ? key.audioBuffer.getChannelData(1)
    : left;

  if (layout === "mirrored") {
    const halfH = mid * 0.94;
    const top = new Float32Array(renderW);
    const bot = new Float32Array(renderW);

    for (let col = 0; col < renderW; col++) {
      const x = offsetX + col;
      let p: { lm: number; lx: number; rm: number; rx: number };

      if (useFine && left) {
        p = peakForPixelFromBuffer(left, right!, x, fullW, norm);
      } else {
        p = peakForPixel(peaks, x, fullW, totalSamples, blockSize);
      }

      const peak = Math.min(1, Math.max(
        Math.abs(p.lm), Math.abs(p.lx), Math.abs(p.rm), Math.abs(p.rx),
      ) / norm);
      top[col] = mid - peak * halfH;
      bot[col] = mid + peak * halfH;
    }

    drawChannelPath2D(ctx, { top, bot }, renderW, waveFill, waveOutline);
  } else {
    const halfH = (h / 4) * 0.96;
    const leftCenter = mid / 2;
    const rightCenter = mid + mid / 2;
    const lTop = new Float32Array(renderW);
    const lBot = new Float32Array(renderW);
    const rTop = new Float32Array(renderW);
    const rBot = new Float32Array(renderW);

    for (let col = 0; col < renderW; col++) {
      const x = offsetX + col;
      let p: { lm: number; lx: number; rm: number; rx: number };

      if (useFine && left) {
        p = peakForPixelFromBuffer(left, right!, x, fullW, norm);
      } else {
        p = peakForPixel(peaks, x, fullW, totalSamples, blockSize);
      }

      lTop[col] = leftCenter - p.lx * halfH;
      lBot[col] = leftCenter - p.lm * halfH;
      rTop[col] = rightCenter - p.rx * halfH;
      rBot[col] = rightCenter - p.rm * halfH;
    }

    drawChannelPath2D(ctx, { top: lTop, bot: lBot }, renderW, waveFill, waveOutline);
    drawChannelPath2D(ctx, { top: rTop, bot: rBot }, renderW, waveFill, waveOutline);
  }

  if (key.showCenterLine !== false && layout === "stereo") {
    ctx.strokeStyle = PT_CENTER_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(renderW, mid);
    ctx.stroke();
  }
}

// ── Tile-based bitmap cache ────────────────────────────────────────────────

/**
 * Get or render one TILE_WIDTH-px tile of the waveform at the given offsetX.
 *
 * The tile is positioned within the clip by tileIndex × TILE_WIDTH.
 * Only visible tiles are rendered; cached tiles are returned in O(1).
 */
export function getOrRenderTile(
  cache: WaveformCache,
  key: Omit<RenderKey, "offsetX" | "renderWidth">,
  tileIndex: number,
): HTMLCanvasElement {
  const { blockSize } = getLodPeaks(cache, key.pps, key.width);
  const clipBg = key.clipBgColor ?? PT_TRACK_BG;
  const ck = tileCacheKey(
    key.trackId, tileIndex, key.height, blockSize, key.pps, clipBg,
    key.waveLayout ?? "stereo", key.waveFill ?? "",
  );

  const cached = tileCache.get(ck);
  if (cached) return cached;

  const offsetX = tileIndex * TILE_WIDTH;
  // Last tile may be narrower
  const tileW = Math.min(TILE_WIDTH, key.width - offsetX);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(tileW * dpr);
  canvas.height = Math.floor(key.height * dpr);
  canvas.style.width = `${tileW}px`;
  canvas.style.height = `${key.height}px`;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    paintWaveform(ctx, cache, { ...key, offsetX, renderWidth: tileW }, tileW, key.height);
  }

  tileCache.set(ck, canvas);
  evictIfNeeded();
  return canvas;
}

/**
 * Paint visible tiles onto ctx using drawImage (blit from cache).
 *
 * On scroll: tiles already in cache → zero per-pixel work, just blit.
 * On zoom-end: tile cache is stale → getOrRenderTile rebuilds at new pps.
 */
export function blitVisibleTiles(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  key: Omit<RenderKey, "offsetX" | "renderWidth">,
  viewportOffsetX: number,
  viewportWidth: number,
  h: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const firstTile = Math.floor(viewportOffsetX / TILE_WIDTH);
  const lastTile = Math.ceil((viewportOffsetX + viewportWidth) / TILE_WIDTH);

  const clipBg = key.clipBgColor ?? PT_TRACK_BG;
  ctx.fillStyle = clipBg;
  ctx.fillRect(0, 0, viewportWidth, h);

  for (let ti = firstTile; ti <= lastTile; ti++) {
    const tileStartX = ti * TILE_WIDTH;
    if (tileStartX >= key.width) break;

    const tile = getOrRenderTile(cache, key, ti);
    const tileW = Math.min(TILE_WIDTH, key.width - tileStartX);

    // Destination x in the viewport canvas
    const destX = tileStartX - viewportOffsetX;

    ctx.drawImage(
      tile,
      0, 0, tileW * dpr, key.height * dpr,
      destX, 0, tileW, h,
    );
  }

  if (key.showCenterLine !== false && key.waveLayout !== "mirrored") {
    ctx.strokeStyle = PT_CENTER_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(viewportWidth, h / 2);
    ctx.stroke();
  }
}

// ── Legacy bitmap render (kept for compatibility) ──────────────────────────

export function renderWaveformBitmap(
  cache: WaveformCache,
  key: RenderKey,
): HTMLCanvasElement {
  const renderW = key.renderWidth ?? key.width;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(renderW * dpr);
  canvas.height = Math.floor(key.height * dpr);
  canvas.style.width = `${renderW}px`;
  canvas.style.height = `${key.height}px`;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    paintWaveform(ctx, cache, key, renderW, key.height);
  }
  return canvas;
}
