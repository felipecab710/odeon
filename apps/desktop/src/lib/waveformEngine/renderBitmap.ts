/**
 * Waveform canvas renderer — LOD pyramid for overview, sample peaks at high zoom.
 * fastMode: coarsest LOD only (used during zoom gestures).
 */
import type { WaveformCache } from "./types";
import { getCoarsestPeaks, getLodPeaks, peakForPixel } from "./lod";
import { peakForPixelFromBuffer, shouldUseFinePeaks } from "./finePeaks";
import { waveformColorsFromClip } from "../clipColorPresets";
import { PT_TRACK_BG, PT_CENTER_LINE } from "./colors";

export interface RenderKey {
  trackId: string;
  width: number;
  height: number;
  pps: number;
  clipStartSec: number;
  clipBgColor?: string;
  offsetX?: number;
  renderWidth?: number;
  audioBuffer?: AudioBuffer | null;
  fastMode?: boolean;
}

const bitmapCache = new Map<string, HTMLCanvasElement>();
const COLOR_REV = "v10";

function cacheKey(k: RenderKey, blockSize: number, fine: boolean): string {
  const ox = k.offsetX ?? 0;
  const rw = k.renderWidth ?? k.width;
  const bg = k.clipBgColor ?? PT_TRACK_BG;
  return `${COLOR_REV}:${bg}:${k.trackId}:${k.width}x${k.height}:${k.pps.toFixed(2)}:${k.clipStartSec.toFixed(3)}:ox${ox}:rw${rw}:bs${blockSize}:f${fine ? 1 : 0}`;
}

function drawColumn(
  ctx: CanvasRenderingContext2D,
  col: number,
  center: number,
  halfAmp: number,
  lm: number,
  lx: number,
  fill: string,
) {
  const yTop = center - lx * halfAmp;
  const yBot = center - lm * halfAmp;
  const y = Math.min(yTop, yBot);
  const barH = Math.max(0.5, Math.abs(yBot - yTop));
  ctx.fillStyle = fill;
  ctx.fillRect(col, y, 1, barH);
}

function strokeEnvelope(ctx: CanvasRenderingContext2D, ys: ArrayLike<number>, color: string) {
  if (ys.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ys[0]);
  for (let col = 1; col < ys.length; col++) ctx.lineTo(col, ys[col]);
  ctx.stroke();
}

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
  const { fill: waveFill, outline: waveOutline } = waveformColorsFromClip(clipBg);

  ctx.fillStyle = clipBg;
  ctx.fillRect(0, 0, renderW, h);

  const mid = h / 2;
  const halfH = (h / 4) * 0.96;
  const fullW = key.width;
  const offsetX = key.offsetX ?? 0;
  const totalSamples = cache.duration_seconds * cache.sample_rate;

  const left = key.audioBuffer?.getChannelData(0);
  const right = key.audioBuffer && key.audioBuffer.numberOfChannels > 1
    ? key.audioBuffer.getChannelData(1)
    : left;

  const leftCenter = mid / 2;
  const rightCenter = mid + mid / 2;
  const norm = cache.global_peak > 1e-9 ? cache.global_peak : 1;

  if (useFine && left) {
    const lMax = new Float32Array(renderW);
    const lMin = new Float32Array(renderW);
    const rMax = new Float32Array(renderW);
    const rMin = new Float32Array(renderW);

    for (let col = 0; col < renderW; col++) {
      const x = offsetX + col;
      const p = peakForPixelFromBuffer(left, right!, x, fullW, norm);
      lMax[col] = leftCenter - p.lx * halfH;
      lMin[col] = leftCenter - p.lm * halfH;
      rMax[col] = rightCenter - p.rx * halfH;
      rMin[col] = rightCenter - p.rm * halfH;
      drawColumn(ctx, col, leftCenter, halfH, p.lm, p.lx, waveFill);
      drawColumn(ctx, col, rightCenter, halfH, p.rm, p.rx, waveFill);
    }

    strokeEnvelope(ctx, lMax, waveOutline);
    strokeEnvelope(ctx, lMin, waveOutline);
    strokeEnvelope(ctx, rMax, waveOutline);
    strokeEnvelope(ctx, rMin, waveOutline);
  } else {
    for (let col = 0; col < renderW; col++) {
      const x = offsetX + col;
      const p = peakForPixel(peaks, x, fullW, totalSamples, blockSize);
      drawColumn(ctx, col, leftCenter, halfH, p.lm, p.lx, waveFill);
      drawColumn(ctx, col, rightCenter, halfH, p.rm, p.rx, waveFill);
    }
  }

  ctx.strokeStyle = PT_CENTER_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(renderW, mid);
  ctx.stroke();
}

export function renderWaveformBitmap(
  cache: WaveformCache,
  key: RenderKey,
): HTMLCanvasElement {
  const { blockSize } = getLodPeaks(cache, key.pps, key.width);
  const useFine = shouldUseFinePeaks(
    cache.sample_rate,
    key.pps,
    blockSize,
    !!key.audioBuffer,
  );
  const ck = cacheKey(key, blockSize, useFine);
  const cached = bitmapCache.get(ck);
  if (cached) return cached;

  const renderW = key.renderWidth ?? key.width;
  const h = key.height;

  const canvas = document.createElement("canvas");
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.floor(renderW * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${renderW}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  paintWaveform(ctx, cache, key, renderW, h);

  bitmapCache.set(ck, canvas);
  if (bitmapCache.size > 80) {
    const first = bitmapCache.keys().next().value;
    if (first) bitmapCache.delete(first);
  }

  return canvas;
}

export function invalidateWaveformBitmap(trackId: string) {
  const needle = `:${trackId}:`;
  for (const k of bitmapCache.keys()) {
    if (k.includes(needle)) bitmapCache.delete(k);
  }
}

export function clearWaveformBitmapCache() {
  bitmapCache.clear();
}
