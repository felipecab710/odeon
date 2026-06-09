/**
 * Waveform canvas — tile cache + viewport blit.
 * Zoom uses the same live pps/scrollLeft as the grid (no CSS scale).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { TrackAnalysis } from "@odeon/shared";
import { useWaveformCache } from "../../hooks/useWaveformCache";
import { blitVisibleTiles, prefetchClipTiles } from "../../lib/waveformEngine/renderBitmap";
import { isZooming, subscribeZoom } from "../../lib/zoomInteraction";
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
  const cameraRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wasZoomingRef = useRef(false);
  const prefetchGenRef = useRef(0);
  const { cache } = useWaveformCache(audioPath, analysis, { cachePath, entryId });

  const renderW = viewportWidth ?? width;
  const offsetX = Math.max(0, Math.min(viewportOffsetX, width - 1));
  const zooming = useSyncExternalStore(subscribeZoom, isZooming, () => false);

  const renderKey = useCallback((fastMode: boolean) => ({
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
    fastMode,
  }), [
    trackId, width, height, pixelsPerSecond, clipStartSec, clipBgColor,
    waveLayout, waveFill, waveOutline, showCenterLine,
  ]);

  const paint = useCallback((fastMode: boolean) => {
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!camera || !canvas || !cache || renderW < 1 || height < 2) return;

    camera.style.left = `${offsetX}px`;
    camera.style.width = `${renderW}px`;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(renderW * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${renderW}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    blitVisibleTiles(
      ctx,
      cache,
      renderKey(fastMode),
      offsetX,
      renderW,
      height,
    );
  }, [cache, height, renderW, offsetX, renderKey]);

  // Idle: warm tile cache for the full clip.
  useEffect(() => {
    if (!cache || width < 1 || height < 2 || zooming) return;

    const gen = ++prefetchGenRef.current;
    let nextTile = 0;

    const step = () => {
      if (gen !== prefetchGenRef.current || isZooming()) return;
      const result = prefetchClipTiles(cache, renderKey(false), nextTile, 10);
      nextTile = result.nextTile;
      if (!result.done) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
    return () => { prefetchGenRef.current++; };
  }, [cache, renderKey, height, zooming]);

  // Scroll / idle: async repaint (never blocks scroll).
  useEffect(() => {
    if (freezeRender || zooming) return;
    scheduleWavePaint(() => paint(false));
  }, [
    freezeRender, zooming, paint,
    trackId, cache, width, height, pixelsPerSecond,
    clipStartSec, clipBgColor, offsetX, renderW,
    waveLayout, waveFill, waveOutline, showCenterLine,
  ]);

  // Zoom: sync repaint at live pps/scroll (coarse LOD, full quality on release).
  useLayoutEffect(() => {
    if (freezeRender) return;

    if (zooming) {
      wasZoomingRef.current = true;
      paint(true);
      return;
    }

    if (wasZoomingRef.current) {
      wasZoomingRef.current = false;
      paint(false);
      return;
    }

    const camera = cameraRef.current;
    if (camera) {
      camera.style.left = `${offsetX}px`;
      camera.style.width = `${renderW}px`;
    }
  }, [
    freezeRender, zooming, paint, offsetX, renderW,
    pixelsPerSecond, width, height,
  ]);

  if (!cache) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-full h-px" style={{ background: "rgba(255,255,255,0.12)" }} />
      </div>
    );
  }

  return (
    <div
      ref={cameraRef}
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{ height: "100%" }}
    >
      <canvas
        ref={canvasRef}
        className="block pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
});
