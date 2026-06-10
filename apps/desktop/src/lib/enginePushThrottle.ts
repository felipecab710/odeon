/** Coalesce high-frequency engine mix pushes during playback. */
export const ENGINE_MIX_PUSH_INTERVAL_MS = 33; // ~30 Hz — sufficient for automation

/** Max rate for UI gestures (fader drag, strip toggles) — one push per frame. */
export const ENGINE_GESTURE_PUSH_INTERVAL_MS = 16;

let lastPushMs = 0;
let lastGesturePushMs = 0;

export function shouldPushEngineMix(isPlaying: boolean, force = false): boolean {
  if (force || !isPlaying) return true;
  const now = performance.now();
  if (now - lastPushMs < ENGINE_MIX_PUSH_INTERVAL_MS) return false;
  lastPushMs = now;
  return true;
}

/** Throttle mix pushes during drag/hover gestures (still allows ~60 Hz). */
export function shouldPushEngineMixGesture(force = false): boolean {
  if (force) return true;
  const now = performance.now();
  if (now - lastGesturePushMs < ENGINE_GESTURE_PUSH_INTERVAL_MS) return false;
  lastGesturePushMs = now;
  return true;
}

export function markEngineMixPushed(): void {
  lastPushMs = performance.now();
}

export function resetEngineMixPushThrottle(): void {
  lastPushMs = 0;
  lastGesturePushMs = 0;
}
