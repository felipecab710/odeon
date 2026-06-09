/**
 * Zoom gesture state — Ableton-style camera: during pinch/scroll only viewport
 * transform updates; committed layout + waveform tiles rebuild on gesture end.
 */
import { flushZoomCommit as doFlushZoomCommit } from "./zoomGestureViewport";
import { clearZoomGestureAnchor } from "./setTimelineViewport";

let zoomEndTimer: ReturnType<typeof setTimeout> | null = null;
let gestureBaselinePps = 0;
/** Timeline content X under cursor when the gesture began. */
let gestureAnchorTimelineX = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeZoom(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isZooming(): boolean {
  return document.documentElement.dataset.zooming === "true";
}

/** Snapshot pps at pinch start — waveforms scale from this without repainting. */
export function setGestureBaselinePps(pps: number): void {
  gestureBaselinePps = pps;
}

/** Timeline content X (px) pinned under the cursor for the whole gesture. */
export function setGestureAnchorTimelineX(timelineX: number): void {
  gestureAnchorTimelineX = timelineX;
}

export function getGestureAnchorTimelineX(): number {
  return gestureAnchorTimelineX;
}

export function getGestureBaselinePps(): number {
  return gestureBaselinePps;
}

export function getZoomGestureScale(livePps: number): number {
  if (!isZooming() || gestureBaselinePps <= 0) return 1;
  return livePps / gestureBaselinePps;
}

/** Commit live zoom immediately (pinch end, ruler release). */
export function flushZoomCommitNow(): void {
  if (zoomEndTimer) {
    clearTimeout(zoomEndTimer);
    zoomEndTimer = null;
  }
  doFlushZoomCommit();
  gestureBaselinePps = 0;
  gestureAnchorTimelineX = 0;
  clearZoomGestureAnchor();
  delete document.documentElement.dataset.zooming;
  notify();
  window.dispatchEvent(new CustomEvent("odeon:zoom-end"));
}

export function markZoomActivity(): void {
  const wasZooming = isZooming();
  document.documentElement.dataset.zooming = "true";
  if (!wasZooming) notify();

  if (zoomEndTimer) clearTimeout(zoomEndTimer);
  zoomEndTimer = setTimeout(() => {
    zoomEndTimer = null;
    flushZoomCommitNow();
  }, 60);
}
