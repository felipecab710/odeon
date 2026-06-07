/**
 * Mixxx-style waveform sync helpers — vsync lookahead, pixel snap, shared RAF loop.
 */

export const VSYNC_FRAME_MS = 1000 / 60;

export interface SyncTiming {
  /** Audio buffer duration (ms) — default ~512 samples @ 44.1kHz */
  bufferMs?: number;
  /** Device output latency (ms) */
  outputLatencyMs?: number;
}

const DEFAULT_BUFFER_MS = (512 / 44100) * 1000;

/** Extrapolate playhead to the upcoming display frame (Mixxx calcOffsetAtNextVSync simplified). */
export function extrapolatePlayhead(
  anchorSec: number,
  anchorMs: number,
  playing: boolean,
  rate: number,
  nowMs = performance.now(),
  timing: SyncTiming = {},
): number {
  if (!playing) return anchorSec;
  const bufferMs = timing.bufferMs ?? DEFAULT_BUFFER_MS;
  const outputMs = timing.outputLatencyMs ?? 0;
  const aheadMs = VSYNC_FRAME_MS + bufferMs * 0.5 + outputMs;
  return anchorSec + ((nowMs + aheadMs - anchorMs) / 1000) * rate;
}

/** Mixxx pixel snap — eliminates 1px playhead jitter at coarse zoom. */
export function snapTrackPosition(
  timeSec: number,
  durationSec: number,
  totalSamples: number,
): number {
  if (durationSec <= 0 || totalSamples <= 0) return timeSec;
  const sampleIndex = Math.round((timeSec / durationSec) * totalSamples);
  return (sampleIndex / totalSamples) * durationSec;
}

export interface SyncPoint {
  audioTime: number;
  wallMs: number;
  duration: number;
  playing: boolean;
  rate: number;
  totalSamples: number;
}

export function interpolateSyncPoint(
  s: SyncPoint,
  timing: SyncTiming = {},
  nowMs = performance.now(),
): number {
  const raw = extrapolatePlayhead(s.audioTime, s.wallMs, s.playing, s.rate, nowMs, timing);
  if (s.duration > 0) return Math.min(s.duration, raw);
  return raw;
}

// ─── Shared 60fps paint loop (one RAF for all waveform widgets) ───────────────

type FrameCallback = () => void;
const subscribers = new Set<FrameCallback>();
let rafId = 0;
let subscriberCount = 0;

function frameTick() {
  rafId = requestAnimationFrame(frameTick);
  for (const cb of subscribers) cb();
}

export function subscribeWaveformFrame(cb: FrameCallback): () => void {
  subscribers.add(cb);
  subscriberCount++;
  if (subscriberCount === 1 && !rafId) {
    rafId = requestAnimationFrame(frameTick);
  }
  return () => {
    subscribers.delete(cb);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0 && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

export function requestWaveformPaint(cb: FrameCallback): void {
  cb();
}
