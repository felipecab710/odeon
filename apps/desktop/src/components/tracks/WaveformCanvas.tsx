/**
 * Pro Tools / Ableton-style waveform canvas.
 *
 * Zoom gesture: CSS scaleX stretch of last bitmap (zero repaint, 60fps).
 * Zoom end: time-sliced high-quality LOD / sample-accurate repaint.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { TrackAnalysis } from "@odeon/shared";
import { useWaveformCache } from "../../hooks/useWaveformCache";
import { useTrackBuffer } from "../../hooks/useTrackBuffer";
import {
  paintWaveform,
  waveformCacheFromBuffer,
  seedWaveformCache,
  isFullWaveformCache,
} from "../../lib/waveformEngine";
import { webAudioEngine } from "../../lib/webAudioEngine";
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
  const { cache: fileCache } = useWaveformCache(audioPath, analysis);
  const audioBuffer = useTrackBuffer(trackId);
  const [bufferCache, setBufferCache] = useState<ReturnType<typeof waveformCacheFromBuffer> | null>(null);
  const [zoomEpoch, setZoomEpoch] = useState(0);

  const cache =
    fileCache && isFullWaveformCache(fileCache)
      ? fileCache
      : bufferCache ?? fileCache;

  const renderW = viewportWidth ?? width;
  const offsetX = Math.max(0, Math.min(viewportOffsetX, width - 1));

  useEffect(() => {
    if (!audioPath) return;
    void webAudioEngine.loadTrack(trackId, audioPath);
  }, [trackId, audioPath]);

  useEffect(() => {
    if (!audioBuffer || (fileCache && isFullWaveformCache(fileCache))) {
      setBufferCache(null);
      return;
    }
    if (isZooming()) return;

    let cancelled = false;
    const build = () => {
      if (cancelled || isZooming()) return;
      const built = waveformCacheFromBuffer(audioBuffer);
      setBufferCache(built);
      if (!fileCache) seedWaveformCache(audioPath, built);
    };

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(build, { timeout: 500 });
      return () => { cancelled = true; cancelIdleCallback(id); };
    }
    const t = window.setTimeout(build, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [audioBuffer, fileCache, audioPath]);

  useEffect(() => {
    const onEnd = () => setZoomEpoch((n) => n + 1);
    window.addEventListener("odeon:zoom-end", onEnd);
    return () => window.removeEventListener("odeon:zoom-end", onEnd);
  }, []);

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

    paintWaveform(ctx, cache, {
      trackId,
      width,
      height,
      pps: pixelsPerSecond,
      clipStartSec,
      clipBgColor,
      offsetX,
      renderWidth: renderW,
      audioBuffer,
      fastMode,
    }, renderW, height);

    snapshotRef.current = { pps: pixelsPerSecond, width, renderW, offsetX };
  }, [
    cache, renderW, height, trackId, width, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX, audioBuffer,
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
    trackId, cache, width, height, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX, renderW, audioBuffer, zoomEpoch,
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
