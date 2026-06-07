/**
 * Mixxx VisualPlayPosition — interpolate playhead between sparse engine transport
 * events for smooth paint. Targets the upcoming vsync frame (see waveformSync.ts).
 */
import {
  extrapolatePlayhead,
  snapTrackPosition,
  type SyncTiming,
} from "./waveformSync";

export type { SyncTiming };

export interface LoopBounds {
  inSec: number;
  outSec: number;
}

export class VisualPlayPosition {
  private anchorSec = 0;
  private anchorMs = 0;
  private playing = false;
  private rate = 1;
  private loop: LoopBounds | null = null;
  private timing: SyncTiming = {};
  private totalSamples = 0;
  private durationSec = 0;

  /** Update audio-path timing from engine (buffer size, output latency). */
  setTiming(timing: SyncTiming) {
    this.timing = timing;
  }

  setTrackSamples(totalSamples: number, durationSec: number) {
    this.totalSamples = totalSamples;
    this.durationSec = durationSec;
  }

  sync(
    positionSec: number,
    isPlaying: boolean,
    rate = 1,
    loop?: LoopBounds | null,
  ): void {
    this.anchorSec = positionSec;
    this.anchorMs = performance.now();
    this.playing = isPlaying;
    this.rate = rate;
    this.loop = loop ?? null;
  }

  private wrapLoop(pos: number): number {
    if (!this.loop) return pos;
    const { inSec, outSec } = this.loop;
    if (outSec <= inSec + 0.05) return pos;
    if (pos < outSec) return pos;
    const span = outSec - inSec;
    return inSec + ((pos - inSec) % span);
  }

  interpolate(nowMs = performance.now()): number {
    const raw = this.playing
      ? extrapolatePlayhead(
          this.anchorSec,
          this.anchorMs,
          this.playing,
          this.rate,
          nowMs,
          this.timing,
        )
      : this.anchorSec;
    const wrapped = this.wrapLoop(raw);
    if (this.totalSamples > 0 && this.durationSec > 0) {
      return snapTrackPosition(wrapped, this.durationSec, this.totalSamples);
    }
    return wrapped;
  }
}

export { snapTrackPosition, extrapolatePlayhead };
