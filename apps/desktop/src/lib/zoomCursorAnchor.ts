/** Last cursor viewport X used for timeline zoom (wheel / trackpad). */
let lastViewportX: number | null = null;

export function setZoomCursorAnchor(viewportX: number): void {
  lastViewportX = viewportX;
}

export function getZoomCursorAnchor(fallback: number): number {
  return lastViewportX ?? fallback;
}

export function clearZoomCursorAnchor(): void {
  lastViewportX = null;
}
