/**
 * Time-sliced waveform repaint queue — spreads canvas work across frames
 * so zoom-end refresh never blocks a single frame (Ableton / Live GPU-style budgeting).
 */

const queue: Array<() => void> = [];
let draining = false;

const FRAME_BUDGET_MS = 10;

export function scheduleWavePaint(job: () => void): void {
  queue.push(job);
  if (!draining) drain();
}

export function flushWavePaintQueue(): void {
  while (queue.length) queue.shift()!();
  draining = false;
}

function drain(): void {
  draining = true;
  requestAnimationFrame(() => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < FRAME_BUDGET_MS) {
      queue.shift()!();
    }
    if (queue.length) drain();
    else draining = false;
  });
}
