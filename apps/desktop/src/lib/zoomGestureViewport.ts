/**
 * Ableton-style zoom gesture viewport — during pinch/scroll zoom the UI is a
 * camera (CSS scale + scroll offset). Committed pps/scroll and waveform tiles
 * rebuild only when the gesture ends.
 */
import { zoomAtAnchor } from "./timelineViewportZoom";

export interface GestureViewport {
  active: boolean;
  /** livePps / baselinePps */
  scaleX: number;
  liveScrollLeft: number;
  /** Frozen viewport X of zoom anchor (playhead) for entire gesture. */
  anchorX: number;
  /** Frozen content X of zoom anchor — CSS transform-origin. */
  anchorContentX: number;
}

let baselinePps = 0;
let livePps = 0;

let snapshot: GestureViewport = {
  active: false,
  scaleX: 1,
  liveScrollLeft: 0,
  anchorX: 0,
  anchorContentX: 0,
};

const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribeGestureViewport(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getGestureViewport(): GestureViewport {
  return snapshot;
}

/**
 * Apply one zoom step during an active gesture. Does not touch Zustand/React.
 * Returns false if clamped (no change).
 */
export function applyZoomGesture(
  factor: number,
  anchorViewportX: number,
  currentScrollLeft: number,
  committedPps: number,
  minPps: number,
  maxPps: number,
): boolean {
  const starting = !snapshot.active;
  if (starting) {
    baselinePps = committedPps;
    livePps = committedPps;
  }

  // Anchor must stay frozen for the whole gesture — recomputing with committed pps drifts.
  const anchorX = snapshot.active ? snapshot.anchorX : anchorViewportX;
  const scrollLeft = snapshot.active ? snapshot.liveScrollLeft : currentScrollLeft;

  const result = zoomAtAnchor({
    oldPps: livePps,
    factor,
    scrollLeft,
    anchorViewportX: anchorX,
    minPps,
    maxPps,
  });
  if (!result) return false;

  livePps = result.newPps;
  const anchorContentX = snapshot.active
    ? snapshot.anchorContentX
    : scrollLeft + anchorX;

  snapshot = {
    active: true,
    scaleX: livePps / baselinePps,
    liveScrollLeft: result.newScrollLeft,
    anchorX,
    anchorContentX,
  };
  emit();
  return true;
}

/** Set absolute pps during ruler magnify (anchored drag). */
export function applyZoomGestureAbsolute(
  targetPps: number,
  anchorViewportX: number,
  currentScrollLeft: number,
  committedPps: number,
  minPps: number,
  maxPps: number,
): boolean {
  const clamped = Math.max(minPps, Math.min(maxPps, targetPps));
  const base = snapshot.active ? livePps : committedPps;
  if (Math.abs(clamped - base) < 1e-9) return false;
  return applyZoomGesture(
    clamped / base,
    anchorViewportX,
    currentScrollLeft,
    committedPps,
    minPps,
    maxPps,
  );
}

/** Viewport X of the frozen zoom anchor (playhead line). */
export function getZoomAnchorViewportX(fallback: number): number {
  return snapshot.active ? snapshot.anchorX : fallback;
}

export function peekZoomCommit(): { pixelsPerSecond: number; scrollLeft: number } | null {
  if (!snapshot.active) return null;
  return { pixelsPerSecond: livePps, scrollLeft: snapshot.liveScrollLeft };
}

export function clearZoomGesture(): void {
  if (!snapshot.active) return;
  baselinePps = 0;
  livePps = 0;
  snapshot = {
    active: false,
    scaleX: 1,
    liveScrollLeft: 0,
    anchorX: 0,
    anchorContentX: 0,
  };
  emit();
}

const commitHandlers = new Set<(pps: number, scrollLeft: number) => void>();

export function registerZoomCommit(
  handler: (pps: number, scrollLeft: number) => void,
): () => void {
  commitHandlers.add(handler);
  return () => commitHandlers.delete(handler);
}

export function flushZoomCommit(): void {
  const commit = peekZoomCommit();
  if (commit) {
    for (const h of commitHandlers) h(commit.pixelsPerSecond, commit.scrollLeft);
  }
  clearZoomGesture();
}
