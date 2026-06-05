/**
 * Zoom gesture state — Ableton-style: layout updates every frame,
 * expensive waveform repaints deferred until the gesture ends.
 */

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
    delete document.documentElement.dataset.zooming;
    notify();
    window.dispatchEvent(new CustomEvent("odeon:zoom-end"));
  }, 100);
}
