/**
 * Zoom gesture state — Ableton-style camera: during pinch/scroll only viewport
 * transform updates; committed layout + waveform tiles rebuild on gesture end.
 */
import { flushZoomCommit } from "./zoomGestureViewport";

let zoomEndTimer: ReturnType<typeof setTimeout> | null = null;
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

export function markZoomActivity(): void {
  const wasZooming = isZooming();
  document.documentElement.dataset.zooming = "true";
  if (!wasZooming) notify();

  if (zoomEndTimer) clearTimeout(zoomEndTimer);
  zoomEndTimer = setTimeout(() => {
    flushZoomCommit();
    delete document.documentElement.dataset.zooming;
    notify();
    window.dispatchEvent(new CustomEvent("odeon:zoom-end"));
  }, 60);
}
