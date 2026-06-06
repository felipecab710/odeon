/**
 * Mixxx VisualPlayPosition — interpolate playhead between ~20 Hz engine transport
 * events for smooth CDJ deck screens.
 */
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

  /** Mixxx determinePlayPosInLoopBoundries — wrap inside active loop. */
  private wrapLoop(pos: number): number {
    if (!this.loop) return pos;
    const { inSec, outSec } = this.loop;
    if (outSec <= inSec + 0.05) return pos;
    if (pos < outSec) return pos;
    const span = outSec - inSec;
    return inSec + ((pos - inSec) % span);
  }

  interpolate(nowMs = performance.now()): number {
    if (!this.playing) return this.anchorSec;
    const elapsed = (nowMs - this.anchorMs) / 1000;
    return this.wrapLoop(this.anchorSec + elapsed * this.rate);
  }
}
