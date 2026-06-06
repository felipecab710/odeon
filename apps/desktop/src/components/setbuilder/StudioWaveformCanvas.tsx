/**
 * DJ.Studio-style mirrored waveform — thin strip, orange top / blue bottom.
 */
import { useEffect, useRef, memo } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";

interface Props {
  cache: WaveformCache | null;
  width: number;
  height: number;
  /** Deck accent — tints the header area subtly */
  accent?: string;
  /** Zoomed render window in seconds */
  timeWindow?: [number, number];
}

const BG = "#141820";
const ORANGE = { r: 255, g: 140, b: 50 };
const BLUE   = { r: 50,  g: 150, b: 240 };

export const StudioWaveformCanvas = memo(function StudioWaveformCanvas({
  cache, width, height, accent, timeWindow,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Background — dark navy inside track strip
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    if (!cache) {
      // Loading placeholder — subtle scan lines
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      return;
    }

    const midY = h / 2;
    const halfH = midY - 1;

    // Pick pyramid level — ~1 bucket per pixel for arrangement zoom
    const targetBuckets = w;
    let chosenKey = String(Math.max(...cache.block_sizes));
    for (const bs of [...cache.block_sizes].sort((a, b) => a - b)) {
      const n = cache.levels[String(bs)]?.length ?? 0;
      if (n >= targetBuckets * 0.5) chosenKey = String(bs);
    }
    const allBuckets = cache.levels[chosenKey];
    if (!allBuckets?.length) return;

    const dur = cache.duration_seconds;
    let startFrac = 0;
    let endFrac = 1;
    if (timeWindow && dur > 0) {
      startFrac = Math.max(0, timeWindow[0] / dur);
      endFrac = Math.min(1, timeWindow[1] / dur);
    }
    const buckets = allBuckets.slice(
      Math.floor(startFrac * allBuckets.length),
      Math.ceil(endFrac * allBuckets.length),
    );
    if (!buckets.length) return;

    const peakScale = cache.global_peak > 0 ? Math.min(1.2, 1 / cache.global_peak) : 1;

    // Center axis
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(0, midY - 0.5, w, 1);

    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / w) * buckets.length);
      const b = buckets[Math.min(idx, buckets.length - 1)];

      const lPeak = Math.max(Math.abs(b.lm), Math.abs(b.lx)) * peakScale;
      const rPeak = Math.max(Math.abs(b.rm), Math.abs(b.rx)) * peakScale;

      // Orange top — left channel mirrored above center
      const lTop = midY - Math.abs(b.lx) * peakScale * halfH;
      const lBot = midY - Math.abs(b.lm) * peakScale * halfH;
      const alphaTop = 0.65 + lPeak * 0.35;
      ctx.fillStyle = `rgba(${ORANGE.r},${ORANGE.g},${ORANGE.b},${alphaTop})`;
      ctx.fillRect(x, lTop, 1, Math.max(1, lBot - lTop));

      // Blue bottom — right channel mirrored below center
      const rTop = midY + Math.abs(b.rm) * peakScale * halfH;
      const rBot = midY + Math.abs(b.rx) * peakScale * halfH;
      const alphaBot = 0.65 + rPeak * 0.35;
      ctx.fillStyle = `rgba(${BLUE.r},${BLUE.g},${BLUE.b},${alphaBot})`;
      ctx.fillRect(x, rTop, 1, Math.max(1, rBot - rTop));
    }

    // Subtle accent tint at very top
    if (accent) {
      ctx.fillStyle = accent + "18";
      ctx.fillRect(0, 0, w, 2);
    }
  }, [cache, width, height, accent, timeWindow]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
});
