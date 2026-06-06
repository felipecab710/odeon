/**
 * Pro Tools / Ableton-style waveform canvas.
 *
 * Scroll model: tiles of 512px are rendered and cached; scroll blits from cache
 * via drawImage — no per-pixel repaint on scroll change.
 *
 * Zoom gesture: CSS scaleX stretch of last bitmap (zero repaint, 60fps).
 * Zoom end: stale tiles cleared, visible tiles repainted at snapped LOD.
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

interface PaintSnapshot {
  pps: number;
  width: number;
  renderW: number;
  offsetX: number;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  trackId,
  audioPath,
  analysis,
  width,
  height,
  pixelsPerSecond,
  clipStartSec = 0,
  clipBgColor,
  viewportOffsetX = 0,
  viewportWidth,
  freezeRender = false,
}: {
  trackId: string;
  audioPath: string;
  analysis?: TrackAnalysis | null;
  width: number;
  height: number;
  pixelsPerSecond: number;
  clipStartSec?: number;
  clipBgColor?: string;
  viewportOffsetX?: number;
  viewportWidth?: number;
  freezeRender?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<PaintSnapshot | null>(null);
  const { cache } = useWaveformCache(audioPath, analysis);

  const renderW = viewportWidth ?? width;
  const offsetX = Math.max(0, Math.min(viewportOffsetX, width - 1));
  const [zoomEpoch, setZoomEpoch] = useState(0);

  // Clear tile cache on zoom-end so tiles repaint at new pps
  useEffect(() => {
    const onEnd = () => {
      invalidateWaveformBitmap(trackId);
      setZoomEpoch((n) => n + 1);
    };
    window.addEventListener("odeon:zoom-end", onEnd);
    return () => window.removeEventListener("odeon:zoom-end", onEnd);
  }, [trackId]);

  const applyZoomScale = useCallback((canvas: HTMLCanvasElement) => {
    const snap = snapshotRef.current;
    if (!snap || snap.pps <= 0 || snap.width <= 0) return false;

    const scaleX = (pixelsPerSecond / snap.pps) * (width / snap.width);
    if (!Number.isFinite(scaleX) || Math.abs(scaleX - 1) < 0.001) return false;

    canvas.style.width = `${renderW}px`;
    canvas.style.height = "100%";
    canvas.style.transformOrigin = "left center";
    canvas.style.transform = `scaleX(${scaleX})`;
    return true;
  }, [pixelsPerSecond, width, renderW]);

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

    if (fastMode) {
      // During zoom: direct paint at coarsest LOD
      paintWaveform(ctx, cache, {
        trackId,
        width,
        height,
        pps: pixelsPerSecond,
        clipStartSec,
        clipBgColor,
        offsetX,
        renderWidth: renderW,
        fastMode: true,
      }, renderW, height);
    } else {
      // Scroll/normal: blit cached tiles (O(1) per tile if already rendered)
      blitVisibleTiles(ctx, cache, {
        trackId,
        width,
        height,
        pps: pixelsPerSecond,
        clipStartSec,
        clipBgColor,
      }, offsetX, renderW, height);
    }

    snapshotRef.current = { pps: pixelsPerSecond, width, renderW, offsetX };
  }, [
    cache, renderW, height, trackId, width, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX,
  ]);

  useEffect(() => {
    if (freezeRender) return;

    if (isZooming()) {
      const canvas = canvasRef.current;
      if (canvas && snapshotRef.current) {
        applyZoomScale(canvas);
      } else {
        paint(true);
      }
      return;
    }

    scheduleWavePaint(() => paint(false));
  }, [
    freezeRender, paint, applyZoomScale,
    // Note: offsetX intentionally included so scroll does trigger a blit,
    // but blitVisibleTiles reads from tile cache — no per-pixel work on cache hit.
    trackId, cache, width, height, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX, renderW, zoomEpoch,
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
