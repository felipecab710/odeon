/**
 * Timeline zoom math — ported from Audacity Viewport + MouseWheelHandler.
 *
 * Audacity (C++/wxWidgets, not React):
 *   steps = wheelRotation / wheelDelta
 *   zoom  = pow(2, steps / 4)
 *   anchor = time under cursor stays fixed via hpos adjustment
 *
 * Odeon Studio uses the same anchor model via timelineStore.zoomAt.
 * Set Builder should use this module instead of ad-hoc zoom code.
 */

/** Audacity MouseWheelHandler.cpp — one mouse notch ≈ pow(2, 1/4) ≈ 1.19× */
export const ZOOM_WHEEL_BASE = 2;
export const ZOOM_WHEEL_STEPS_DIVISOR = 4;
/** Toolbar +/- buttons — Audacity ViewMenus doubles/halves; we use one wheel notch per click. */
export const ZOOM_BUTTON_FACTOR = Math.pow(ZOOM_WHEEL_BASE, 1 / ZOOM_WHEEL_STEPS_DIVISOR);

const WHEEL_DELTA_PX = 120;

/**
 * Pinch-to-zoom (macOS trackpad) and Cmd/Ctrl+scroll.
 * - Chrome / WKWebView pinch: wheel + ctrlKey
 * - Cmd+scroll: metaKey
 */
export function isZoomWheelEvent(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/** Normalized wheel steps (fractional on trackpads). Positive = zoom in. */
export function wheelStepsFromEvent(e: WheelEvent): number {
  const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 20
    : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? 800
      : 1;
  // Pinch sometimes reports deltaZ; prefer deltaY when present.
  const delta = e.deltaY !== 0 ? e.deltaY : (e.deltaZ ?? 0);
  // Scroll up / pinch out (negative delta) → positive steps → zoom in (matches Audacity).
  return (-delta * scale) / WHEEL_DELTA_PX;
}

export function zoomMultiplierFromSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps === 0) return 1;
  return Math.pow(ZOOM_WHEEL_BASE, steps / ZOOM_WHEEL_STEPS_DIVISOR);
}

/**
 * Anchor-preserving horizontal zoom.
 * @param anchorViewportX — X within the scroll viewport (0 = left edge visible)
 */
export function zoomAtAnchor({
  oldPps,
  factor,
  scrollLeft,
  anchorViewportX,
  minPps,
  maxPps,
}: {
  oldPps: number;
  factor: number;
  scrollLeft: number;
  anchorViewportX: number;
  minPps: number;
  maxPps: number;
}): { newPps: number; newScrollLeft: number } | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const newPps = Math.max(minPps, Math.min(maxPps, oldPps * factor));
  if (Math.abs(newPps - oldPps) < 1e-9) return null;

  const timeAtAnchor = (scrollLeft + anchorViewportX) / oldPps;
  const newScrollLeft = Math.max(0, timeAtAnchor * newPps - anchorViewportX);
  return { newPps, newScrollLeft };
}
