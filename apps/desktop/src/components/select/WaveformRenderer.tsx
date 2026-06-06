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
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import type { CatalogMarker } from "@odeon/shared";
import type { WaveformMode } from "../../stores/selectStore";

export type { WaveformMode };

// ─── Sync ─────────────────────────────────────────────────────────────────────

interface SyncPoint { audioTime: number; wallMs: number; duration: number; playing: boolean; rate: number; }
const DEFAULT_SYNC: SyncPoint = { audioTime: 0, wallMs: 0, duration: 0, playing: false, rate: 1 };
function interpolate(s: SyncPoint): number {
  if (!s.playing || !s.duration) return s.audioTime;
  return Math.min(s.duration, s.audioTime + (performance.now() - s.wallMs) * 0.001 * s.rate);
}
export interface WaveformHandle {
  sync(audioTime: number, wallMs: number, duration: number, playing: boolean, rate?: number): void;
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

// ─── Pixel builder (physical pixels) ──────────────────────────────────────────

function buildPixels(
  cache: WaveformCache,
  physW: number,
  physH: number,
  bgR: number, bgG: number, bgB: number,
  mode: WaveformMode,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(physW * physH * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = bgR; pixels[i + 1] = bgG; pixels[i + 2] = bgB; pixels[i + 3] = 255;
  }

  // Finest pyramid level
  let bestKey = String(cache.block_sizes[0] ?? 256), bestLen = 0;
  for (const bs of cache.block_sizes) {
    const len = cache.levels[String(bs)]?.length ?? 0;
    if (len > bestLen) { bestLen = len; bestKey = String(bs); }
  }
  const buckets = cache.levels[bestKey];
  if (!buckets?.length) return pixels;

  const nFreq  = cache.freqColors?.bass.length ?? 0;
  const midY   = physH / 2;
  const midRow = Math.round(midY);
  const GAIN   = 1.5; // Mixxx allGain default (linear amplitude multiplier)

  for (let x = 0; x < physW; x++) {
    const bi = Math.min((x / physW * buckets.length) | 0, buckets.length - 1);
    const b  = buckets[bi];

    // ── Color per Mixxx mode ──────────────────────────────────────────────
    let r: number, g: number, bl: number;

    if (mode === "simple") {
      [r, g, bl] = SIMPLE_COLOR;

    } else if (mode === "hsv" && nFreq > 0 && cache.freqColors) {
      // Exact Mixxx HSV algorithm (waveformrendererhsv.cpp):
      //   total = (lo + mid + hi) * 1.2
      //   s = 1 − hi_norm, v = 1 − lo_norm
      const fi  = Math.min((x / physW * nFreq) | 0, nFreq - 1);
      const lo  = cache.freqColors.bass[fi] / 255;
      const mid = cache.freqColors.mid[fi]  / 255;
      const hi  = cache.freqColors.high[fi] / 255;
      const total = (lo + mid + hi) * 1.2 + 0.001;
      const loN = (lo * 2) / total;  // stereo: ×2 (Mixxx sums both channels)
      const hiN = (hi * 2) / total;
      const sv  = Math.max(0, 1 - loN);  // v = 1 − lo_norm
      const ss  = Math.max(0, 1 - hiN);  // s = 1 − hi_norm
      [r, g, bl] = hsvToRgb(HSV_HUE, ss, sv);

    } else if (mode === "rgb" && nFreq > 0 && cache.freqColors) {
      // Exact Mixxx RGB algorithm (waveformrendererrgb.cpp):
      //   normalize by max component, red=high, green=mid, blue=bass
      const fi   = Math.min((x / physW * nFreq) | 0, nFreq - 1);
      const bass = cache.freqColors.bass[fi] / 255;
      const mid  = cache.freqColors.mid[fi]  / 255;
      const high = cache.freqColors.high[fi] / 255;
      const mx   = Math.max(bass, mid, high, 0.001);
      r  = (high / mx * 255) | 0;
      g  = (mid  / mx * 255) | 0;
      bl = (bass / mx * 255) | 0;

    } else {
      // Fallback (no freq data)
      r = 80; g = 160; bl = 255;
    }

    // ── Linear amplitude (Mixxx: maxAll × allGain × halfBreadth / maxValue) ─
    const lAmp = Math.min(1, Math.abs(b.lx) * GAIN);
    const rAmp = Math.min(1, Math.abs(b.rx) * GAIN);
    const lH   = Math.max(1, Math.round(lAmp * midY));
    const rH   = Math.max(1, Math.round(rAmp * midY));

    for (let y = midRow - lH; y < midRow; y++) {
      const pi = (y * physW + x) * 4;
      pixels[pi] = r; pixels[pi + 1] = g; pixels[pi + 2] = bl; pixels[pi + 3] = 255;
    }
    for (let y = midRow; y < midRow + rH; y++) {
      const pi = (y * physW + x) * 4;
      pixels[pi] = r; pixels[pi + 1] = g; pixels[pi + 2] = bl; pixels[pi + 3] = 255;
    }
  }

  // Center axis hairline
  for (let x = 0; x < physW; x++) {
    const pi = (midRow * physW + x) * 4;
    pixels[pi]     = Math.min(255, pixels[pi]     + 22);
    pixels[pi + 1] = Math.min(255, pixels[pi + 1] + 22);
    pixels[pi + 2] = Math.min(255, pixels[pi + 2] + 22);
  }

  return pixels;
}

function buildOffscreen(
  cache: WaveformCache, physW: number, physH: number, bg: string, mode: WaveformMode,
): OffscreenCanvas {
  const [bgR, bgG, bgB] = hexToRgb(bg);
  const oc  = new OffscreenCanvas(physW, physH);
  const ctx = oc.getContext("2d")!;
  const id  = ctx.createImageData(physW, physH);
  id.data.set(buildPixels(cache, physW, physH, bgR, bgG, bgB, mode));
  ctx.putImageData(id, 0, 0);
  return oc;
}

// ─── StaticWaveform ───────────────────────────────────────────────────────────

export function StaticWaveform({
  cache, width, height, bg = "#0a0a0a", mode = "rgb",
}: { cache: WaveformCache; width: number; height: number; bg?: string; mode?: WaveformMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pW  = Math.round(width  * dpr);
    const pH  = Math.round(height * dpr);
    canvas.width  = pW;
    canvas.height = pH;
    canvas.getContext("2d")!.drawImage(buildOffscreen(cache, pW, pH, bg, mode), 0, 0);
  }, [cache, width, height, bg, mode]);
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
  bg?:      string;
  mode?:    WaveformMode;
  onSeek?:  (ratio: number) => void;
}

export const OverviewWaveform = forwardRef<WaveformHandle, OverviewProps>(
  function OverviewWaveform({ cache, width, height, markers, bg = "#0a0a0a", mode = "rgb", onSeek }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const offRef    = useRef<OffscreenCanvas | null>(null);
    const syncRef   = useRef<SyncPoint>({ ...DEFAULT_SYNC });
    const rafId     = useRef(0);

    useImperativeHandle(ref, () => ({
      sync(at, wm, dur, pl, rt = 1) { syncRef.current = { audioTime: at, wallMs: wm, duration: dur, playing: pl, rate: rt }; },
    }));

    // Rebuild offscreen when cache/size/mode changes
    useEffect(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const { pW, pH } = setupCanvas(canvas, width, height);
      offRef.current = cache ? buildOffscreen(cache, pW, pH, bg, mode) : null;
    }, [cache, width, height, bg, mode]);

    // RAF
    useEffect(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext("2d")!;

      const frame = () => {
        rafId.current = requestAnimationFrame(frame);
        const dpr  = window.devicePixelRatio || 1;
        const pW   = canvas.width;
        const pH   = canvas.height;
        const s    = syncRef.current;
        const t    = interpolate(s);
        const dur  = s.duration;

        if (offRef.current) ctx.drawImage(offRef.current, 0, 0);
        else { ctx.fillStyle = bg; ctx.fillRect(0, 0, pW, pH); }

        // Markers
        if (markers?.length && dur > 0) {
          for (const m of markers) {
            const mx = Math.round(m.time_seconds / dur * pW);
            const [mr, mg, mb] = m.color ? hexToRgb(m.color) : (MARKER_COLOR[m.type] ?? [255,255,255]);
            ctx.fillStyle = `rgba(${mr},${mg},${mb},0.2)`;
            ctx.fillRect(mx - dpr, 0, 3 * dpr, pH);
            ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
            ctx.fillRect(mx, 0, dpr, pH);
          }
        }

        // Playhead
        const ph = dur > 0 ? t / dur : 0;
        const px = Math.round(ph * pW);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(0, 0, px, pH);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(px - 2 * dpr, 0, 5 * dpr, pH);
        ctx.fillStyle = "#fff";
        ctx.fillRect(px, 0, dpr, pH);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(px - 3 * dpr, 0); ctx.lineTo(px + 3 * dpr, 0); ctx.lineTo(px, 6 * dpr);
        ctx.fill();
      };

      frame();
      return () => cancelAnimationFrame(rafId.current);
    }, [cache, width, height, bg, markers, mode]);

    return (
      <canvas ref={canvasRef} style={{ display: "block", width, height, cursor: "crosshair" }}
        onMouseDown={e => {
          if (!onSeek) return;
          const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }} />
    );
  }
);

// ─── ZoomedWaveform ───────────────────────────────────────────────────────────

const ATLAS_SCALE = 4;

interface ZoomedProps extends OverviewProps {
  beatTimes?:   number[] | null;
  zoomSeconds?: number;
}

export const ZoomedWaveform = forwardRef<WaveformHandle, ZoomedProps>(
  function ZoomedWaveform(
    { cache, width, height, markers, bg = "#080808", mode = "rgb", beatTimes, zoomSeconds = 15, onSeek },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const offRef    = useRef<OffscreenCanvas | null>(null);
    const syncRef   = useRef<SyncPoint>({ ...DEFAULT_SYNC });
    const rafId     = useRef(0);

    useImperativeHandle(ref, () => ({
      sync(at, wm, dur, pl, rt = 1) { syncRef.current = { audioTime: at, wallMs: wm, duration: dur, playing: pl, rate: rt }; },
    }));

    useEffect(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const { pW, pH } = setupCanvas(canvas, width, height);
      offRef.current = cache ? buildOffscreen(cache, pW * ATLAS_SCALE, pH, bg, mode) : null;
    }, [cache, width, height, bg, mode]);

    useEffect(() => {
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext("2d")!;

      const frame = () => {
        rafId.current = requestAnimationFrame(frame);
        const dpr  = window.devicePixelRatio || 1;
        const pW   = canvas.width;
        const pH   = canvas.height;
        const s    = syncRef.current;
        const t    = interpolate(s);
        const dur  = s.duration;

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, pW, pH);

        if (offRef.current && dur > 0) {
          const atlasW   = offRef.current.width;
          const pxPerSec = atlasW / dur;
          const t0  = Math.max(0, t - zoomSeconds);
          const t1  = Math.min(dur, t + zoomSeconds);
          const srcX = t0 * pxPerSec;
          const srcW = (t1 - t0) * pxPerSec;
          const destX = -((t - t0) / (t1 - t0) * pW - pW / 2);
          const destW = pW * (t1 - t0) / (zoomSeconds * 2);
          ctx.drawImage(offRef.current, srcX, 0, srcW, pH, destX, 0, destW, pH);
        }

        // Beat grid — single Path2D batch draw
        if (beatTimes?.length && dur > 0) {
          const t0  = Math.max(0, t - zoomSeconds);
          const t1  = Math.min(dur, t + zoomSeconds);
          const win = t1 - t0;
          if (win > 0) {
            const bp = new Path2D();
            for (const bt of beatTimes) {
              if (bt < t0 || bt > t1) continue;
              bp.rect(Math.round(((bt - t0) / win) * pW), 0, dpr, pH);
            }
            ctx.fillStyle = "rgba(255,255,255,0.13)";
            ctx.fill(bp);
          }
        }

        // Cue markers
        if (markers?.length && dur > 0) {
          const t0  = Math.max(0, t - zoomSeconds);
          const t1  = Math.min(dur, t + zoomSeconds);
          const win = t1 - t0;
          if (win > 0) {
            for (const m of markers) {
              if (m.time_seconds < t0 || m.time_seconds > t1) continue;
              const mx = Math.round(((m.time_seconds - t0) / win) * pW);
              const [mr, mg, mb] = m.color ? hexToRgb(m.color) : (MARKER_COLOR[m.type] ?? [255,255,255]);
              ctx.fillStyle = `rgba(${mr},${mg},${mb},0.25)`;
              ctx.fillRect(mx - dpr, 0, 4 * dpr, pH);
              ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
              ctx.fillRect(mx, 0, 2 * dpr, pH);
              ctx.beginPath();
              ctx.moveTo(mx, 0); ctx.lineTo(mx + 8 * dpr, 0); ctx.lineTo(mx, 11 * dpr);
              ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
              ctx.fill();
            }
          }
        }

        // Fixed center needle
        const cx = pW / 2 | 0;
        ctx.fillStyle = "rgba(0,0,0,0.45)";  ctx.fillRect(cx - 2 * dpr, 0, 5 * dpr, pH);
        ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(cx - dpr, 0, 3 * dpr, pH);
        ctx.fillStyle = "#fff";               ctx.fillRect(cx, 0, dpr, pH);
      };

      frame();
      return () => cancelAnimationFrame(rafId.current);
    }, [cache, width, height, bg, markers, beatTimes, zoomSeconds, mode]);

    return (
      <canvas ref={canvasRef} style={{ display: "block", width, height, cursor: "crosshair" }}
        onMouseDown={e => {
          if (!onSeek) return;
          const s = syncRef.current; if (!s.duration) return;
          const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width - 0.5;
          const t = Math.max(0, Math.min(s.duration, interpolate(s) + frac * zoomSeconds * 2));
          onSeek(t / s.duration);
        }} />
    );
  }
);
