/**
 * Pro Tools / Ableton-style waveform canvas.
 *
 * Scroll model: tiles of 512px are rendered and cached; scroll blits from cache
 * via drawImage — no per-pixel repaint on scroll change.
 *
 * Zoom gesture: Ableton camera — no repaint during pinch; stretch cached tiles
 * via parent CSS scale. Zoom end: invalidate tiles and rebuild at exact LOD.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { TrackAnalysis } from "@odeon/shared";
import { useWaveformCache } from "../../hooks/useWaveformCache";
import {
  blitVisibleTiles,
  invalidateWaveformBitmap,
} from "../../lib/waveformEngine/renderBitmap";
import { paintWaveform } from "../../lib/waveformEngine";
import { isZooming } from "../../lib/zoomInteraction";
import { scheduleWavePaint } from "../../lib/wavePaintScheduler";

export const WaveformCanvas = memo(function WaveformCanvas({
  trackId,
  audioPath,
  analysis,
  cachePath,
  entryId,
  width,
  height,
  pixelsPerSecond,
  clipStartSec = 0,
  clipBgColor,
  viewportOffsetX = 0,
  viewportWidth,
  freezeRender = false,
  waveLayout = "stereo",
  waveFill,
  waveOutline,
  showCenterLine,
}: {
  trackId: string;
  audioPath: string;
  analysis?: TrackAnalysis | null;
  cachePath?: string | null;
  entryId?: string | null;
  width: number;
  height: number;
  pixelsPerSecond: number;
  clipStartSec?: number;
  clipBgColor?: string;
  viewportOffsetX?: number;
  viewportWidth?: number;
  freezeRender?: boolean;
  waveLayout?: "stereo" | "mirrored";
  waveFill?: string;
  waveOutline?: string;
  showCenterLine?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { cache } = useWaveformCache(audioPath, analysis, { cachePath, entryId });

  const renderW = viewportWidth ?? width;
  const offsetX = Math.max(0, Math.min(viewportOffsetX, width - 1));
  const [zoomEpoch, setZoomEpoch] = useState(0);

  useEffect(() => {
    const onEnd = () => {
      invalidateWaveformBitmap(trackId);
      setZoomEpoch((n) => n + 1);
    };
    window.addEventListener("odeon:zoom-end", onEnd);
    return () => window.removeEventListener("odeon:zoom-end", onEnd);
  }, [trackId]);

  const paint = useCallback((fastMode: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || !cache || renderW < 1 || height < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(renderW * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${renderW}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = "";
    canvas.style.transformOrigin = "";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const key = {
      trackId,
      width,
      height,
      pps: pixelsPerSecond,
      clipStartSec,
      clipBgColor,
      waveLayout,
      waveFill,
      waveOutline,
      showCenterLine,
    };

    if (fastMode) {
      paintWaveform(ctx, cache, {
        ...key,
        offsetX,
        renderWidth: renderW,
        fastMode: true,
      }, renderW, height);
    } else {
      blitVisibleTiles(ctx, cache, key, offsetX, renderW, height);
    }
  }, [
    cache, renderW, height, offsetX,
    trackId, width, pixelsPerSecond, clipStartSec, clipBgColor,
    waveLayout, waveFill, waveOutline, showCenterLine,
  ]);

  useEffect(() => {
    if (freezeRender || isZooming()) return;
    scheduleWavePaint(() => paint(false));
  }, [
    freezeRender, paint,
    trackId, cache, width, height, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX, renderW, zoomEpoch,
    waveLayout, waveFill, waveOutline, showCenterLine,
  ]);

  if (!cache) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-full h-px" style={{ background: "rgba(255,255,255,0.12)" }} />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{ left: offsetX, width: renderW, height: "100%", willChange: "transform" }}
    />
  );
});
