/**
 * Set Builder timeline viewport — re-exports + live cursor / zoom-gesture state.
 * Coordinate math lives in SetTimelineContext.
 */
import { setGestureAnchorTimelineX } from "./zoomInteraction";
import {
  SetTimelineContext,
  type SetTimelineContextParams,
  type SetTimelineViewportMetrics,
  type TimelineHitTest,
} from "./setTimelineContext";

export type { SetTimelineContextParams, SetTimelineViewportMetrics, TimelineHitTest };
export { SetTimelineContext, createSetTimelineContext } from "./setTimelineContext";

function ctx(metrics: SetTimelineContextParams): SetTimelineContext {
  return new SetTimelineContext(metrics);
}

export function viewportXFromClientX(clientX: number, scrollEl: HTMLElement): number {
  return SetTimelineContext.viewportXFromClientX(clientX, scrollEl);
}

export function contentXFromViewportX(viewportX: number, scrollLeft: number): number {
  return scrollLeft + viewportX;
}

export function contentXFromClientX(clientX: number, scrollEl: HTMLElement): number {
  const viewportX = viewportXFromClientX(clientX, scrollEl);
  return contentXFromViewportX(viewportX, scrollEl.scrollLeft);
}

export function clampTimeSec(timeSec: number, totalSec: number): number {
  return Math.max(0, Math.min(totalSec, timeSec));
}

export function timeSecFromContentX(
  contentX: number,
  pixelsPerSecond: number,
  totalSec: number,
): number {
  return ctx({ pixelsPerSecond, scrollLeft: 0, viewportWidth: 0, totalSec }).contentXToTimeSec(contentX);
}

export function positionToTimeSec(
  viewportX: number,
  scrollLeft: number,
  pixelsPerSecond: number,
): number {
  return ctx({ pixelsPerSecond, scrollLeft, viewportWidth: 0, totalSec: Infinity }).viewportXToTimeSec(viewportX);
}

export function timeToViewportX(
  timeSec: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return ctx({ pixelsPerSecond, scrollLeft, viewportWidth: 0, totalSec: Infinity }).timeToViewportX(timeSec);
}

export function contentXFromTimeSec(timeSec: number, pixelsPerSecond: number): number {
  return ctx({ pixelsPerSecond, scrollLeft: 0, viewportWidth: 0, totalSec: Infinity }).timeSecToContentX(timeSec);
}

export function timeSecFromClientX(
  clientX: number,
  scrollEl: HTMLElement,
  metrics: Pick<SetTimelineContextParams, "pixelsPerSecond" | "totalSec">,
): number {
  return ctx({
    ...metrics,
    scrollLeft: scrollEl.scrollLeft,
    viewportWidth: scrollEl.clientWidth,
  }).timeSecFromClientX(clientX, scrollEl);
}

export function hitTestClientX(
  clientX: number,
  scrollEl: HTMLElement,
  metrics: SetTimelineContextParams,
): TimelineHitTest {
  return ctx({ ...metrics, scrollLeft: scrollEl.scrollLeft }).hitTestClientX(clientX, scrollEl);
}

export function viewTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  padSec = 2,
): { start: number; end: number } {
  return ctx({ pixelsPerSecond, scrollLeft, viewportWidth, totalSec: Infinity }).viewTimeRange(padSec);
}

export function viewTimeRangeFromMetrics(
  metrics: SetTimelineContextParams,
  padSec = 2,
): { start: number; end: number } {
  return ctx(metrics).viewTimeRange(padSec);
}

export function scrollLeftForAnchoredTime(
  timeSec: number,
  viewportX: number,
  pixelsPerSecond: number,
): number {
  return ctx({ pixelsPerSecond, scrollLeft: 0, viewportWidth: 0, totalSec: Infinity })
    .scrollLeftForAnchoredTime(timeSec, viewportX);
}

// ─── Live edit cursor (hover) ───────────────────────────────────────────────

let cursorViewportX: number | null = null;
let cursorTimeSec: number | null = null;
const cursorListeners = new Set<() => void>();

function emitCursor() {
  for (const fn of cursorListeners) fn();
}

export function subscribeTimelineCursor(cb: () => void): () => void {
  cursorListeners.add(cb);
  return () => cursorListeners.delete(cb);
}

export function getCursorViewportX(): number | null {
  return cursorViewportX;
}

export function getCursorTimeSec(): number | null {
  return cursorTimeSec;
}

export function updateTimelineCursor(
  clientX: number,
  scrollEl: HTMLElement,
  metrics: SetTimelineContextParams,
): { viewportX: number; timeSec: number } {
  const hit = hitTestClientX(clientX, scrollEl, metrics);
  cursorViewportX = hit.viewportX;
  cursorTimeSec = hit.timeSec;
  emitCursor();
  return { viewportX: hit.viewportX, timeSec: hit.timeSec };
}

export function clearTimelineCursor(): void {
  if (cursorViewportX === null && cursorTimeSec === null) return;
  cursorViewportX = null;
  cursorTimeSec = null;
  emitCursor();
}

// ─── Zoom gesture anchor ────────────────────────────────────────────────────

let gestureAnchorViewportX: number | null = null;
let gestureAnchorTimeSec: number | null = null;

export function beginZoomGestureAnchor(
  clientX: number,
  scrollEl: HTMLElement,
  metrics: SetTimelineContextParams,
): TimelineHitTest {
  const hit = hitTestClientX(clientX, scrollEl, metrics);
  gestureAnchorViewportX = hit.viewportX;
  gestureAnchorTimeSec = hit.timeSec;
  setGestureAnchorTimelineX(hit.contentX);
  return hit;
}

export function getZoomAnchorViewportX(fallback: number): number {
  return gestureAnchorViewportX ?? cursorViewportX ?? fallback;
}

export function getZoomAnchorTimeSec(): number | null {
  return gestureAnchorTimeSec ?? cursorTimeSec;
}

export function clearZoomGestureAnchor(): void {
  gestureAnchorViewportX = null;
  gestureAnchorTimeSec = null;
}
