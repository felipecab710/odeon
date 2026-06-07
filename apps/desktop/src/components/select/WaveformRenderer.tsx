/**
 * WaveformRenderer — three Mixxx waveform modes, pixel-perfect on HiDPI.
 *
 * MODES (exact Mixxx algorithms):
 *
 *   RGB  (waveformrendererrgb.cpp):
 *     color = normalize(high, mid, bass) → red=high, green=mid, blue=bass
 *     height = amplitude × gain (linear)
 *
 *   HSV  (waveformrendererhsv.cpp):
 *     h = fixed deck hue (cyan ≈ 180°)
 *     total = (lo + mid + hi) × 1.2
 *     lo_norm = lo / total,  hi_norm = hi / total
 *     s = 1 − hi_norm   (more highs → desaturate toward white)
 *     v = 1 − lo_norm   (more bass  → darken)
 *     height = amplitude × gain (linear)
 *
 *   SIMPLE (waveformrenderersimple.cpp):
 *     single uniform deck color, height = amplitude × gain (linear)
 *
 * DPR: canvas.width/height = cssW/H × devicePixelRatio.
 *      All pixel ops in physical coordinates. No blur on Retina.
 *
 * SMOOTHNESS: sync() + wall-clock interpolation → true 60fps playhead.
 */
import { useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import type { CatalogMarker } from "@odeon/shared";
import type { WaveformMode } from "../../stores/selectStore";
import { getWaveformTrackDuration, timeToPixel } from "../../lib/trackTime";
import { getFinestPeaks, getLodPeaks, peakForPixel } from "../../lib/waveformEngine/lod";
import type { StereoPeakBucket } from "../../lib/waveformEngine/types";
import {
  interpolateSyncPoint,
  snapTrackPosition,
  subscribeWaveformFrame,
  type SyncPoint,
} from "../../lib/waveformSync";
import { hasOverview, paintOverviewStrip } from "../../lib/waveformEngine/overviewStrip";
import {
  getCachedWaveformBitmap,
  waveformBitmapKey,
} from "../../lib/waveformEngine/waveformBitmapCache";

export type { WaveformMode };

// ─── Sync ─────────────────────────────────────────────────────────────────────

const DEFAULT_SYNC: SyncPoint = {
  audioTime: 0, wallMs: 0, duration: 0, playing: false, rate: 1, totalSamples: 0,
};

function interpolate(s: SyncPoint): number {
  const t = interpolateSyncPoint(s);
  if (s.duration > 0 && s.totalSamples > 0) {
    return Math.min(s.duration, snapTrackPosition(t, s.duration, s.totalSamples));
  }
  if (s.duration > 0) return Math.min(s.duration, t);
  return t;
}
export interface WaveformHandle {
  sync(audioTime: number, wallMs: number, duration: number, playing: boolean, rate?: number): void;
}

/**
 * Mixxx VisualPlayPosition in the renderer — anchor updates on engine ticks;
 * internal RAF extrapolates between anchors without resetting wallMs each frame.
 */
function bindWaveformSync(
  syncRef: React.MutableRefObject<SyncPoint>,
  paint: () => void,
  unsubRef: React.MutableRefObject<(() => void) | null>,
): WaveformHandle["sync"] {
  return (at, wm, dur, pl, rt = 1) => {
    syncRef.current = {
      ...syncRef.current,
      audioTime: at,
      wallMs: wm,
      duration: dur,
      playing: pl,
      rate: rt,
    };
    if (pl) {
      if (!unsubRef.current) {
        unsubRef.current = subscribeWaveformFrame(() => paint());
      }
    } else {
      unsubRef.current?.();
      unsubRef.current = null;
      paint();
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16) || 0;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
const MARKER_COLOR: Record<string, [number, number, number]> = {
  hot_cue: [245, 158, 11], memory: [59, 130, 246], cue: [16, 185, 129], loop: [167, 139, 250],
};

/** HSV → RGB. H in [0,1], S in [0,1], V in [0,1]. Returns [0-255, 0-255, 0-255]. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c  = v * s;
  const hh = (h * 6) % 6;
  const x  = c * (1 - Math.abs(hh % 2 - 1));
  const m  = v - c;
  let r = 0, g = 0, b = 0;
  if      (hh < 1) { r = c; g = x; b = 0; }
  else if (hh < 2) { r = x; g = c; b = 0; }
  else if (hh < 3) { r = 0; g = c; b = x; }
  else if (hh < 4) { r = 0; g = x; b = c; }
  else if (hh < 5) { r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0];
}

// HSV hue for each mode's "deck color"
const HSV_HUE   = 0.500; // 180° cyan (Mixxx deck 2 default)
const SIMPLE_COLOR: [number, number, number] = [180, 210, 255]; // soft blue-white

/** Cap offscreen bitmap width (drawImage source must stay on-DOM in WKWebView). */
const MAX_BITMAP_WIDTH = 4096;
const GAIN = 1.5;

function trackTotalSamples(cache: WaveformCache): number {
  if (cache.sample_rate > 0 && cache.duration_seconds > 0) {
    return Math.round(cache.duration_seconds * cache.sample_rate);
  }
  let bestKey = String(cache.block_sizes[0] ?? 256);
  let bestLen = 0;
  for (const bs of cache.block_sizes) {
    const len = cache.levels[String(bs)]?.length ?? 0;
    if (len > bestLen) { bestLen = len; bestKey = String(bs); }
  }
  const blockSize = parseInt(bestKey, 10) || 256;
  return (cache.levels[bestKey]?.length ?? 0) * blockSize;
}

/** Max-pool peaks for one column when rendering a time sub-range (zoom window slice). */
function peakForTimeRange(
  peaks: StereoPeakBucket[],
  x: number,
  widthPx: number,
  totalSamples: number,
  blockSize: number,
  t0: number,
  t1: number,
  durationSec: number,
): StereoPeakBucket {
  if (peaks.length === 0 || widthPx < 1 || durationSec <= 0) {
    return { lm: 0, lx: 0, rm: 0, rx: 0 };
  }
  const span = Math.max(1e-9, t1 - t0);
  const sample0 = (t0 / durationSec) * totalSamples + (x / widthPx) * (span / durationSec) * totalSamples;
  const sample1 = (t0 / durationSec) * totalSamples + ((x + 1) / widthPx) * (span / durationSec) * totalSamples;
  const b0 = Math.max(0, Math.floor(sample0 / blockSize));
  const b1 = Math.min(peaks.length - 1, Math.floor(sample1 / blockSize));

  let lm = Infinity, lx = -Infinity, rm = Infinity, rx = -Infinity;
  for (let i = b0; i <= b1; i++) {
    const p = peaks[i];
    if (p.lm < lm) lm = p.lm;
    if (p.lx > lx) lx = p.lx;
    if (p.rm < rm) rm = p.rm;
    if (p.rx > rx) rx = p.rx;
  }
  if (lm === Infinity) return { lm: 0, lx: 0, rm: 0, rx: 0 };
  return { lm, lx, rm, rx };
}

/** Hidden host for offscreen bitmap canvases (drawImage source must be on-DOM in WKWebView). */
function ensureBitmapHost(): HTMLElement {
  const id = "odeon-wf-bitmap-host";
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    host.style.cssText = "position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(host);
  }
  return host;
}

function disposeBitmapCanvas(canvas: HTMLCanvasElement | null) {
  canvas?.parentElement?.removeChild(canvas);
}

// ─── Canvas2D column renderer (WKWebView-safe — no putImageData) ─────────────

function colorForColumn(
  cache: WaveformCache,
  mode: WaveformMode,
  trackFrac: number,
): [number, number, number] {
  const nFreq = cache.freqColors?.bass.length ?? 0;

  if (mode === "simple") return SIMPLE_COLOR;

  if (mode === "hsv" && nFreq > 0 && cache.freqColors) {
    const fi = Math.max(0, Math.min(1, trackFrac)) * (nFreq - 1);
    const i0 = Math.floor(fi);
    const i1 = Math.min(i0 + 1, nFreq - 1);
    const f = fi - i0;
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const lo = lerp(cache.freqColors.bass[i0], cache.freqColors.bass[i1]) / 255;
    const mid = lerp(cache.freqColors.mid[i0], cache.freqColors.mid[i1]) / 255;
    const hi = lerp(cache.freqColors.high[i0], cache.freqColors.high[i1]) / 255;
    const total = (lo + mid + hi) * 1.2 + 0.001;
    const loN = (lo * 2) / total;
    const hiN = (hi * 2) / total;
    return hsvToRgb(HSV_HUE, Math.max(0, 1 - hiN), Math.max(0, 1 - loN));
  }

  if (mode === "rgb" && nFreq > 0 && cache.freqColors) {
    const fi = Math.max(0, Math.min(1, trackFrac)) * (nFreq - 1);
    const i0 = Math.floor(fi);
    const i1 = Math.min(i0 + 1, nFreq - 1);
    const f = fi - i0;
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const bass = lerp(cache.freqColors.bass[i0], cache.freqColors.bass[i1]) / 255;
    const mid = lerp(cache.freqColors.mid[i0], cache.freqColors.mid[i1]) / 255;
    const high = lerp(cache.freqColors.high[i0], cache.freqColors.high[i1]) / 255;
    const mx = Math.max(bass, mid, high);
    if (mx < 0.01) return SIMPLE_COLOR;
    return [(high / mx * 255) | 0, (mid / mx * 255) | 0, (bass / mx * 255) | 0];
  }

  return [80, 160, 255];
}

function paintWaveformColumns(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  destX: number,
  widthPx: number,
  heightPx: number,
  mode: WaveformMode,
  timeRange?: { t0: number; t1: number },
  highDetail = false,
) {
  const durationSec = cache.duration_seconds;
  if (durationSec <= 0 || widthPx < 1) return;

  const totalSamples = trackTotalSamples(cache);
  if (totalSamples <= 0) return;

  const t0 = timeRange?.t0 ?? 0;
  const t1 = timeRange?.t1 ?? durationSec;
  const spanSec = Math.max(1e-9, t1 - t0);
  const pps = widthPx / spanSec;
  const fullTrack = t0 <= 0 && t1 >= durationSec - 1e-6;
  const { blockSize, peaks } = (highDetail || spanSec < 120)
    ? getFinestPeaks(cache)
    : getLodPeaks(cache, pps, widthPx);
  if (!peaks.length) return;

  const midY = heightPx / 2;

  for (let x = 0; x < widthPx; x++) {
    const b = fullTrack
      ? peakForPixel(peaks, x, widthPx, totalSamples, blockSize)
      : peakForTimeRange(peaks, x, widthPx, totalSamples, blockSize, t0, t1, durationSec);

    const trackFrac = fullTrack
      ? (x + 0.5) / widthPx
      : (t0 + ((x + 0.5) / widthPx) * spanSec) / durationSec;

    const [r, g, bl] = colorForColumn(cache, mode, trackFrac);

    const lAmp = Math.min(1, Math.max(Math.abs(b.lm), Math.abs(b.lx)) * GAIN);
    const rAmp = Math.min(1, Math.max(Math.abs(b.rm), Math.abs(b.rx)) * GAIN);
    const lH = Math.max(1, Math.round(lAmp * midY));
    const rH = Math.max(1, Math.round(rAmp * midY));

    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(destX + x, midY - lH, 1, lH);
    ctx.fillRect(destX + x, midY, 1, rH);
  }

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(destX, midY - 0.5, widthPx, 1);
}

function buildWaveformBitmap(
  cache: WaveformCache, physW: number, physH: number, bg: string, mode: WaveformMode,
): HTMLCanvasElement {
  const safeW = Math.min(Math.max(1, physW), MAX_BITMAP_WIDTH);
  const canvas = document.createElement("canvas");
  canvas.width = safeW;
  canvas.height = physH;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, safeW, physH);
    paintWaveformColumns(ctx, cache, 0, safeW, physH, mode);
  }
  ensureBitmapHost().appendChild(canvas);
  return canvas;
}

function paintWaveformImageData(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  physW: number,
  physH: number,
  bg: string,
  mode: WaveformMode,
  timeRange?: { t0: number; t1: number },
) {
  const safeW = Math.min(Math.max(1, physW), MAX_BITMAP_WIDTH);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, safeW, physH);
  paintWaveformColumns(ctx, cache, 0, safeW, physH, mode, timeRange, !!timeRange);
}

function paintWaveformWindow(
  ctx: CanvasRenderingContext2D,
  cache: WaveformCache,
  destX: number,
  destW: number,
  physH: number,
  bg: string,
  mode: WaveformMode,
  t0: number,
  t1: number,
) {
  if (destW < 1 || t1 <= t0) return;
  const safeW = Math.min(Math.max(1, Math.round(destW)), MAX_BITMAP_WIDTH);
  const dx = Math.round(destX);
  ctx.fillStyle = bg;
  ctx.fillRect(dx, 0, safeW, physH);
  paintWaveformColumns(ctx, cache, dx, safeW, physH, mode, { t0, t1 }, true);
}

function resolveRenderDuration(
  trackDurationSec: number | undefined,
  cache: WaveformCache | null | undefined,
  syncDuration: number,
): number {
  if (trackDurationSec != null && trackDurationSec > 0) return trackDurationSec;
  const waveDur = getWaveformTrackDuration(cache);
  if (waveDur > 0) return waveDur;
  if (cache?.duration_seconds != null && cache.duration_seconds > 0) return cache.duration_seconds;
  return syncDuration;
}

/** Mixxx WaveformWidgetRenderer — fixed zoom span, playhead at center (playMarkerPosition=0.5). */
const MIXXX_PLAYHEAD_FRAC = 0.5;

/** Fixed-length visible window: always 2×zoomSec, centered on playhead (can extend before 0 / after dur). */
function mixxxZoomedSpan(zoomSec: number) {
  return { halfSpan: zoomSec, fullSpan: 2 * zoomSec };
}

/** Mixxx transformSamplePositionInRendererWorld — fixed scale, playhead at center. */
function mixxxZoomedPixel(
  timeSec: number,
  playheadSec: number,
  zoomSec: number,
  pixelWidth: number,
  durationSec = 0,
  totalSamples = 0,
): number {
  const { fullSpan } = mixxxZoomedSpan(zoomSec);
  if (fullSpan <= 0 || pixelWidth <= 0) return 0;
  const t = totalSamples > 0 && durationSec > 0
    ? snapTrackPosition(timeSec, durationSec, totalSamples)
    : timeSec;
  const ph = totalSamples > 0 && durationSec > 0
    ? snapTrackPosition(playheadSec, durationSec, totalSamples)
    : playheadSec;
  return Math.round((MIXXX_PLAYHEAD_FRAC + (t - ph) / fullSpan) * pixelWidth);
}

/** Inverse: pixel → seconds (click-to-seek). */
function mixxxZoomedTimeAtPixel(pixelX: number, playheadSec: number, zoomSec: number, pixelWidth: number): number {
  const { fullSpan } = mixxxZoomedSpan(zoomSec);
  if (pixelWidth <= 0) return playheadSec;
  const frac = pixelX / pixelWidth;
  return playheadSec + (frac - MIXXX_PLAYHEAD_FRAC) * fullSpan;
}

function drawCueMarker(
  ctx: CanvasRenderingContext2D,
  mx: number,
  pH: number,
  dpr: number,
  rgb: [number, number, number],
) {
  const [mr, mg, mb] = rgb;
  ctx.fillStyle = `rgba(${mr},${mg},${mb},0.22)`;
  ctx.fillRect(mx - dpr, 0, 3 * dpr, pH);
  ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
  ctx.fillRect(mx, 0, dpr, pH);
  ctx.beginPath();
  ctx.moveTo(mx, 0);
  ctx.lineTo(mx + 8 * dpr, 0);
  ctx.lineTo(mx, 11 * dpr);
  ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
  ctx.fill();
}

/** Mixxx WaveformRenderMarkRange — shaded loop region + in/out needles. */
function drawPrerollPostroll(
  ctx: CanvasRenderingContext2D,
  playheadSec: number,
  trackDurationSec: number,
  zoomSec: number,
  pixelWidth: number,
  pixelHeight: number,
  totalSamples = 0,
) {
  if (trackDurationSec <= 0 || pixelWidth <= 0) return;
  const { halfSpan } = mixxxZoomedSpan(zoomSec);
  const visT0 = playheadSec - halfSpan;
  const visT1 = playheadSec + halfSpan;

  if (visT0 < 0) {
    const x0 = mixxxZoomedPixel(visT0, playheadSec, zoomSec, pixelWidth, trackDurationSec, totalSamples);
    const x1 = mixxxZoomedPixel(0, playheadSec, zoomSec, pixelWidth, trackDurationSec, totalSamples);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(Math.max(0, x0), 0, Math.max(1, x1 - x0), pixelHeight);
  }
  if (visT1 > trackDurationSec) {
    const x0 = mixxxZoomedPixel(trackDurationSec, playheadSec, zoomSec, pixelWidth, trackDurationSec, totalSamples);
    const x1 = mixxxZoomedPixel(visT1, playheadSec, zoomSec, pixelWidth, trackDurationSec, totalSamples);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), pixelHeight);
  }
}

/** Mixxx WaveformRenderMarkRange — shaded loop region + in/out needles. */
function drawLoopRegion(
  ctx: CanvasRenderingContext2D,
  loopIn: number,
  loopOut: number,
  loopActive: boolean,
  xAt: (timeSec: number) => number,
  pH: number,
  dpr: number,
) {
  if (loopOut <= loopIn) return;
  const x0 = xAt(loopIn);
  const x1 = xAt(loopOut);
  const left = Math.min(x0, x1);
  const width = Math.max(dpr, Math.abs(x1 - x0));
  ctx.fillStyle = loopActive ? "rgba(251,146,60,0.22)" : "rgba(251,146,60,0.10)";
  ctx.fillRect(left, 0, width, pH);
  ctx.fillStyle = loopActive ? "#fb923c" : "rgba(251,146,60,0.55)";
  ctx.fillRect(x0, 0, dpr, pH);
  ctx.fillRect(x1 - dpr, 0, dpr, pH);
}

function drawStaticMarkers(
  ctx: CanvasRenderingContext2D,
  markers: CatalogMarker[],
  durationSec: number,
  pW: number,
  pH: number,
  dpr: number,
) {
  if (!markers.length || durationSec <= 0) return;
  for (const m of markers) {
    const mx = timeToPixel(m.time_seconds, durationSec, pW);
    const rgb = m.color ? hexToRgb(m.color) : (MARKER_COLOR[m.type] ?? [255, 255, 255]);
    drawCueMarker(ctx, mx, pH, dpr, rgb);
  }
}

// ─── StaticWaveform ───────────────────────────────────────────────────────────

export function StaticWaveform({
  cache, width, height, bg = "#0a0a0a", mode = "rgb", markers, durationSec, cacheKey,
  tier = "peak",
}: {
  cache: WaveformCache;
  width: number;
  height: number;
  bg?: string;
  mode?: WaveformMode;
  markers?: CatalogMarker[];
  durationSec?: number;
  /** Audio file path — enables rendered bitmap LRU cache across catalog scroll. */
  cacheKey?: string;
  /** "overview" = fast OVW3 strip for tiny lane thumbnails; "peak" = full pyramid detail. */
  tier?: "peak" | "overview";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pW  = Math.round(width  * dpr);
    const pH  = Math.round(height * dpr);
    canvas.width  = pW;
    canvas.height = pH;
    const ctx = canvas.getContext("2d")!;

    const useOverview = tier === "overview" && hasOverview(cache);
    const variant = useOverview ? "overview" as const : "peak" as const;
    const key = cacheKey
      ? waveformBitmapKey(cacheKey, pW, pH, mode, variant)
      : null;

    const paintTo = (target: CanvasRenderingContext2D) => {
      if (useOverview && paintOverviewStrip(target, cache, pW, pH, bg)) return;
      paintWaveformImageData(target, cache, pW, pH, bg, mode);
    };

    if (key) {
      const off = getCachedWaveformBitmap(key, () => {
        const offCanvas = document.createElement("canvas");
        offCanvas.width = pW;
        offCanvas.height = pH;
        paintTo(offCanvas.getContext("2d")!);
        ensureBitmapHost().appendChild(offCanvas);
        return offCanvas;
      });
      ctx.drawImage(off, 0, 0);
    } else {
      paintTo(ctx);
    }

    if (markers?.length) {
      drawStaticMarkers(ctx, markers, durationSec ?? getWaveformTrackDuration(cache) ?? cache.duration_seconds, pW, pH, dpr);
    }
  }, [cache, width, height, bg, mode, markers, durationSec, cacheKey, tier]);
  return <canvas ref={ref} style={{ display: "block", width, height }} />;
}

// ─── Shared canvas setup ──────────────────────────────────────────────────────

function setupCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number) {
  const dpr = window.devicePixelRatio || 1;
  const pW  = Math.round(cssW * dpr);
  const pH  = Math.round(cssH * dpr);
  canvas.width  = pW;
  canvas.height = pH;
  return { dpr, pW, pH };
}

// ─── OverviewWaveform ─────────────────────────────────────────────────────────

interface OverviewProps {
  cache:    WaveformCache | null;
  width:    number;
  height:   number;
  markers?: CatalogMarker[];
  /** Mixxx track_samples equivalent — must match waveform cache length. */
  trackDurationSec?: number;
  loopIn?:  number | null;
  loopOut?: number | null;
  loopActive?: boolean;
  bg?:      string;
  mode?:    WaveformMode;
  onSeek?:  (ratio: number) => void;
  hidePlayhead?: boolean;
}

export const OverviewWaveform = forwardRef<WaveformHandle, OverviewProps>(
  function OverviewWaveform(props, ref) {
    const { cache, width, height, markers, trackDurationSec, loopIn, loopOut, loopActive, bg = "#0a0a0a", mode = "rgb", hidePlayhead, onSeek } = props;
    const signalRef   = useRef<HTMLCanvasElement>(null);
    const overlayRef  = useRef<HTMLCanvasElement>(null);
    const offRef      = useRef<HTMLCanvasElement | null>(null);
    const syncRef     = useRef<SyncPoint>({ ...DEFAULT_SYNC });
    const unsubRef    = useRef<(() => void) | null>(null);
    const propsRef    = useRef(props);
    propsRef.current = props;
    const paintRef = useRef<() => void>(() => {});

    const paintSignal = useCallback(() => {
      const canvas = signalRef.current;
      if (!canvas || !offRef.current) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const pW = canvas.width;
      const pH = canvas.height;
      ctx.drawImage(offRef.current, 0, 0, offRef.current.width, offRef.current.height, 0, 0, pW, pH);
    }, []);

    const paintOverlay = useCallback(() => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const {
        markers: mks, trackDurationSec: tds, cache: c, hidePlayhead: hidePh,
        loopIn, loopOut, loopActive,
      } = propsRef.current;

      const dpr  = window.devicePixelRatio || 1;
      const pW   = canvas.width;
      const pH   = canvas.height;
      const s    = syncRef.current;
      const t    = interpolate(s);
      const dur  = resolveRenderDuration(tds, c, s.duration);

      ctx.clearRect(0, 0, pW, pH);

      if (dur > 0 && loopIn != null && loopOut != null) {
        drawLoopRegion(
          ctx, loopIn, loopOut, !!loopActive,
          (timeSec) => timeToPixel(timeSec, dur, pW),
          pH, dpr,
        );
      }

      if (mks?.length && dur > 0) {
        for (const m of mks) {
          const mx = timeToPixel(m.time_seconds, dur, pW);
          const rgb = m.color ? hexToRgb(m.color) : (MARKER_COLOR[m.type] ?? [255, 255, 255]);
          drawCueMarker(ctx, mx, pH, dpr, rgb);
        }
      }

      if (!hidePh && dur > 0) {
        const px = timeToPixel(t, dur, pW);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(0, 0, px, pH);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(px - 2 * dpr, 0, 5 * dpr, pH);
        ctx.fillStyle = "#fff";
        ctx.fillRect(px, 0, dpr, pH);
        ctx.beginPath();
        ctx.moveTo(px - 3 * dpr, 0); ctx.lineTo(px + 3 * dpr, 0); ctx.lineTo(px, 6 * dpr);
        ctx.fill();
      }
    }, []);

    const paintOverview = useCallback(() => {
      paintSignal();
      paintOverlay();
    }, [paintSignal, paintOverlay]);

    paintRef.current = paintOverview;

    useImperativeHandle(ref, () => ({
      sync: bindWaveformSync(syncRef, () => paintRef.current(), unsubRef),
    }), []);

    useEffect(() => () => {
      unsubRef.current?.();
      unsubRef.current = null;
    }, []);

    useEffect(() => {
      const signal = signalRef.current;
      const overlay = overlayRef.current;
      if (!signal || !overlay) return;
      const { pW, pH } = setupCanvas(signal, width, height);
      setupCanvas(overlay, width, height);
      disposeBitmapCanvas(offRef.current);
      offRef.current = cache ? buildWaveformBitmap(cache, pW, pH, bg, mode) : null;
      syncRef.current.totalSamples = cache ? trackTotalSamples(cache) : 0;
      if (offRef.current) {
        const sctx = signal.getContext("2d");
        sctx?.drawImage(offRef.current, 0, 0, offRef.current.width, offRef.current.height, 0, 0, pW, pH);
      } else {
        const sctx = signal.getContext("2d");
        if (sctx) { sctx.fillStyle = bg; sctx.fillRect(0, 0, pW, pH); }
      }
      paintOverlay();
      return () => disposeBitmapCanvas(offRef.current);
    }, [cache, width, height, bg, mode, paintOverlay]);

    useEffect(() => { paintOverlay(); }, [markers, trackDurationSec, hidePlayhead, loopIn, loopOut, loopActive, paintOverlay]);

    return (
      <div
        style={{ position: "relative", width, height, cursor: onSeek ? "crosshair" : undefined }}
        onMouseDown={e => {
          if (!onSeek) return;
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }}
      >
        <canvas ref={signalRef} style={{ display: "block", width, height }} />
        <canvas ref={overlayRef} style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }} />
      </div>
    );
  }
);

// ─── TrackNavWaveform — CDJ full-track navigation strip ───────────────────────
// Full-track RGB overview with played-region dimming. Playhead drawn by parent.

export const TrackNavWaveform = forwardRef<WaveformHandle, OverviewProps>(
  function TrackNavWaveform({ cache, width, height, bg = "#030306", mode = "rgb" }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const offRef    = useRef<HTMLCanvasElement | null>(null);
    const syncRef   = useRef<SyncPoint>({ ...DEFAULT_SYNC });
    const unsubRef  = useRef<(() => void) | null>(null);
    const paintRef  = useRef<() => void>(() => {});

    const paintFrame = useCallback(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext("2d")!;

      const pW = canvas.width;
      const pH = canvas.height;
      const s  = syncRef.current;
      const t  = interpolate(s);
      const dur = s.duration;

      if (offRef.current) ctx.drawImage(offRef.current, 0, 0);
      else { ctx.fillStyle = bg; ctx.fillRect(0, 0, pW, pH); }

      if (dur > 0) {
        const px = Math.round((t / dur) * pW);
        ctx.fillStyle = "rgba(0,0,0,0.52)";
        ctx.fillRect(0, 0, px, pH);
      }
    }, [bg]);

    paintRef.current = paintFrame;

    useImperativeHandle(ref, () => ({
      sync(at, wm, dur, pl, rt = 1) {
        syncRef.current = {
          ...syncRef.current,
          audioTime: at,
          wallMs: wm,
          duration: dur,
          playing: pl,
          rate: rt,
        };
        if (pl) {
          if (!unsubRef.current) {
            unsubRef.current = subscribeWaveformFrame(() => paintRef.current());
          }
        } else {
          unsubRef.current?.();
          unsubRef.current = null;
          paintRef.current();
        }
      },
    }), []);

    useEffect(() => () => {
      unsubRef.current?.();
      unsubRef.current = null;
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const { pW, pH } = setupCanvas(canvas, width, height);
      disposeBitmapCanvas(offRef.current);
      offRef.current = cache ? buildWaveformBitmap(cache, pW, pH, bg, mode) : null;
      syncRef.current.totalSamples = cache ? trackTotalSamples(cache) : 0;
      paintFrame();
      return () => disposeBitmapCanvas(offRef.current);
    }, [cache, width, height, bg, mode, paintFrame]);

    return <canvas ref={canvasRef} style={{ display: "block", width, height }} />;
  }
);

// ─── ZoomedWaveform ───────────────────────────────────────────────────────────

interface ZoomedProps extends OverviewProps {
  beatTimes?:     number[] | null;
  zoomSeconds?:   number;
  /** Skip built-in center needle (e.g. CDJ screen overlays its own playhead). */
  hidePlayhead?:  boolean;
}

export const ZoomedWaveform = forwardRef<WaveformHandle, ZoomedProps>(
  function ZoomedWaveform(props, ref) {
    const {
      cache, width, height, markers, trackDurationSec, loopIn, loopOut, loopActive,
      bg = "#080808", mode = "rgb", beatTimes, zoomSeconds = 15, hidePlayhead, onSeek,
    } = props;
    const signalRef   = useRef<HTMLCanvasElement>(null);
    const overlayRef  = useRef<HTMLCanvasElement>(null);
    const syncRef     = useRef<SyncPoint>({ ...DEFAULT_SYNC });
    const unsubRef    = useRef<(() => void) | null>(null);
    const propsRef    = useRef(props);
    propsRef.current = props;
    const paintRef = useRef<() => void>(() => {});

    const paintSignal = useCallback(() => {
      const canvas = signalRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { trackDurationSec: tds, cache: c, zoomSeconds: zoom, bg: background, mode: renderMode } = propsRef.current;
      const s = syncRef.current;
      const t = interpolate(s);
      const dur = resolveRenderDuration(tds, c, s.duration);
      const zoomSec = zoom ?? 15;
      const pW = canvas.width;
      const pH = canvas.height;
      const bgColor = background ?? "#080808";

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, pW, pH);

      if (!c || dur <= 0) return;

      const { halfSpan } = mixxxZoomedSpan(zoomSec);
      const visT0 = t - halfSpan;
      const visT1 = t + halfSpan;
      const trackT0 = Math.max(0, visT0);
      const trackT1 = Math.min(dur, visT1);
      const samples = s.totalSamples || trackTotalSamples(c);

      if (trackT1 > trackT0) {
        const destX0 = mixxxZoomedPixel(trackT0, t, zoomSec, pW, dur, samples);
        const destX1 = mixxxZoomedPixel(trackT1, t, zoomSec, pW, dur, samples);
        const destW = Math.max(1, destX1 - destX0);
        paintWaveformWindow(ctx, c, destX0, destW, pH, bgColor, renderMode ?? "rgb", trackT0, trackT1);
      }
    }, []);

    const paintOverlay = useCallback(() => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const {
        markers: mks, trackDurationSec: tds, cache: c, beatTimes: beats,
        zoomSeconds: zoom, hidePlayhead: hidePh,
        loopIn, loopOut, loopActive,
      } = propsRef.current;

      const dpr  = window.devicePixelRatio || 1;
      const pW   = canvas.width;
      const pH   = canvas.height;
      const s    = syncRef.current;
      const t    = interpolate(s);
      const dur  = resolveRenderDuration(tds, c, s.duration);
      const zoomSec = zoom ?? 15;
      const samples = s.totalSamples || (c ? trackTotalSamples(c) : 0);

      ctx.clearRect(0, 0, pW, pH);

      if (dur <= 0) return;

      const { halfSpan } = mixxxZoomedSpan(zoomSec);
      const visT0 = t - halfSpan;
      const visT1 = t + halfSpan;

      drawPrerollPostroll(ctx, t, dur, zoomSec, pW, pH, samples);

      if (loopIn != null && loopOut != null && loopOut > loopIn) {
        const visIn = Math.max(loopIn, visT0);
        const visOut = Math.min(loopOut, visT1);
        if (visOut > visIn) {
          drawLoopRegion(
            ctx, visIn, visOut, !!loopActive,
            (timeSec) => mixxxZoomedPixel(timeSec, t, zoomSec, pW, dur, samples),
            pH, dpr,
          );
        }
      }

      if (beats?.length) {
        const bp = new Path2D();
        for (const bt of beats) {
          if (bt < visT0 || bt > visT1) continue;
          bp.rect(mixxxZoomedPixel(bt, t, zoomSec, pW, dur, samples), 0, dpr, pH);
        }
        ctx.fillStyle = "rgba(255,255,255,0.13)";
        ctx.fill(bp);
      }

      if (mks?.length) {
        for (const m of mks) {
          if (m.time_seconds < visT0 || m.time_seconds > visT1) continue;
          const mx = mixxxZoomedPixel(m.time_seconds, t, zoomSec, pW, dur, samples);
          const rgb = m.color ? hexToRgb(m.color) : (MARKER_COLOR[m.type] ?? [255, 255, 255]);
          drawCueMarker(ctx, mx, pH, dpr, rgb);
        }
      }

      if (!hidePh) {
        const cx = (pW * MIXXX_PLAYHEAD_FRAC) | 0;
        ctx.fillStyle = "rgba(0,0,0,0.45)";  ctx.fillRect(cx - 2 * dpr, 0, 5 * dpr, pH);
        ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(cx - dpr, 0, 3 * dpr, pH);
        ctx.fillStyle = "#fff";               ctx.fillRect(cx, 0, dpr, pH);
      }
    }, []);

    const paintZoomed = useCallback(() => {
      paintSignal();
      paintOverlay();
    }, [paintSignal, paintOverlay]);

    paintRef.current = paintZoomed;

    useImperativeHandle(ref, () => ({
      sync: bindWaveformSync(syncRef, () => paintRef.current(), unsubRef),
    }), []);

    useEffect(() => () => {
      unsubRef.current?.();
      unsubRef.current = null;
    }, []);

    useEffect(() => {
      const signal = signalRef.current;
      const overlay = overlayRef.current;
      if (!signal || !overlay) return;
      setupCanvas(signal, width, height);
      setupCanvas(overlay, width, height);
      syncRef.current.totalSamples = cache ? trackTotalSamples(cache) : 0;
      paintZoomed();
    }, [cache, width, height, bg, mode, paintZoomed]);

    useEffect(() => { paintOverlay(); }, [markers, trackDurationSec, beatTimes, zoomSeconds, hidePlayhead, loopIn, loopOut, loopActive, paintOverlay]);

    return (
      <div
        style={{ position: "relative", width, height, cursor: onSeek ? "crosshair" : undefined }}
        onMouseDown={e => {
          if (!onSeek) return;
          const s = syncRef.current;
          const { trackDurationSec: tds, cache: c, zoomSeconds: zoom } = propsRef.current;
          const dur = resolveRenderDuration(tds, c, s.duration);
          if (!dur) return;
          const zoomSec = zoom ?? 15;
          const overlay = overlayRef.current;
          if (!overlay) return;
          const pW = overlay.width;
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const pixelX = (e.clientX - r.left) / r.width * pW;
          const playhead = interpolate(s);
          const seekT = Math.max(0, Math.min(dur, mixxxZoomedTimeAtPixel(pixelX, playhead, zoomSec, pW)));
          onSeek(seekT / dur);
        }}
      >
        <canvas ref={signalRef} style={{ display: "block", width, height }} />
        <canvas ref={overlayRef} style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }} />
      </div>
    );
  }
);
