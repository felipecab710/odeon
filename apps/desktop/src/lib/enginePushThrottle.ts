/** Coalesce high-frequency engine mix pushes during playback. */
export const ENGINE_MIX_PUSH_INTERVAL_MS = 33; // ~30 Hz — sufficient for automation

let lastPushMs = 0;

export function shouldPushEngineMix(isPlaying: boolean, force = false): boolean {
  if (force || !isPlaying) return true;
  const now = performance.now();
  if (now - lastPushMs < ENGINE_MIX_PUSH_INTERVAL_MS) return false;
  lastPushMs = now;
  return true;
}

export function markEngineMixPushed(): void {
  lastPushMs = performance.now();
}
