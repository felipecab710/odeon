/**
 * Mixxx VisualPlayPosition — interpolate playhead between ~20 Hz engine transport
 * events for smooth CDJ deck screens.
 */
export class VisualPlayPosition {
  private anchorSec = 0;
  private anchorMs = 0;
  private playing = false;
  private rate = 1;

  sync(positionSec: number, isPlaying: boolean, rate = 1): void {
    this.anchorSec = positionSec;
    this.anchorMs = performance.now();
    this.playing = isPlaying;
    this.rate = rate;
  }

  interpolate(nowMs = performance.now()): number {
    if (!this.playing) return this.anchorSec;
    const elapsed = (nowMs - this.anchorMs) / 1000;
    return this.anchorSec + elapsed * this.rate;
  }
}
