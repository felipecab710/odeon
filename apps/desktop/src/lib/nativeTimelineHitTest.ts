import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";
import { SetTimelineContext } from "./setTimelineContext";

export type NativeClipEdge = "left" | "right" | "body";

export interface NativeClipHit {
  laneIndex: number;
  lane: LaneLayout;
  edge: NativeClipEdge;
}

const EDGE_HIT_PX = 8;

export function nativeLocalX(clientX: number, hostEl: HTMLElement): number {
  return clientX - hostEl.getBoundingClientRect().left;
}

export function nativeLocalY(clientY: number, hostEl: HTMLElement): number {
  return clientY - hostEl.getBoundingClientRect().top;
}

export function nativeIsDeckStripColumn(
  clientX: number,
  hostEl: HTMLElement,
  laneStripWidth: number,
): boolean {
  return laneStripWidth > 0 && nativeLocalX(clientX, hostEl) < laneStripWidth;
}

export function nativeTimelineViewportX(
  clientX: number,
  hostEl: HTMLElement,
  laneStripWidth: number,
): number {
  return nativeLocalX(clientX, hostEl) - laneStripWidth;
}

export function nativeViewportXFromClientX(
  clientX: number,
  hostEl: HTMLElement,
  laneStripWidth = 0,
): number {
  if (laneStripWidth > 0) {
    return nativeTimelineViewportX(clientX, hostEl, laneStripWidth);
  }
  return SetTimelineContext.viewportXFromClientX(clientX, hostEl);
}

export function nativeTimeSecFromClientX(
  clientX: number,
  hostEl: HTMLElement,
  scrollLeft: number,
  pixelsPerSecond: number,
  totalSec: number,
  laneStripWidth = 0,
): number {
  const viewportX = nativeViewportXFromClientX(clientX, hostEl, laneStripWidth);
  const contentX = scrollLeft + viewportX;
  return Math.max(0, Math.min(totalSec, contentX / Math.max(pixelsPerSecond, 1e-9)));
}

export function nativeLaneIndexFromClientY(
  clientY: number,
  hostEl: HTMLElement,
  laneYs: number[],
  laneHeights: number[],
): number | null {
  const y = nativeLocalY(clientY, hostEl);
  for (let i = 0; i < laneYs.length; i++) {
    if (y >= laneYs[i] && y < laneYs[i] + laneHeights[i]) return i;
  }
  return null;
}

export function nativeClipHitTest(
  clientX: number,
  clientY: number,
  hostEl: HTMLElement,
  lanes: LaneLayout[],
  laneYs: number[],
  laneHeights: number[],
  scrollLeft: number,
  pixelsPerSecond: number,
  laneStripWidth = 0,
): NativeClipHit | null {
  if (nativeIsDeckStripColumn(clientX, hostEl, laneStripWidth)) return null;

  const laneIndex = nativeLaneIndexFromClientY(clientY, hostEl, laneYs, laneHeights);
  if (laneIndex == null) return null;
  const lane = lanes[laneIndex];
  if (!lane) return null;

  const viewportX = nativeTimelineViewportX(clientX, hostEl, laneStripWidth);
  const clipLeft = lane.startSec * pixelsPerSecond - scrollLeft;
  const clipRight = lane.endSec * pixelsPerSecond - scrollLeft;

  if (viewportX < clipLeft - 2 || viewportX > clipRight + 2) return null;

  let edge: NativeClipEdge = "body";
  if (viewportX - clipLeft <= EDGE_HIT_PX) edge = "left";
  else if (clipRight - viewportX <= EDGE_HIT_PX) edge = "right";

  return { laneIndex, lane, edge };
}

export function nativeClipCursor(
  clientX: number,
  clientY: number,
  hostEl: HTMLElement,
  lanes: LaneLayout[],
  laneYs: number[],
  laneHeights: number[],
  scrollLeft: number,
  pixelsPerSecond: number,
  laneStripWidth = 0,
): string | null {
  if (nativeIsDeckStripColumn(clientX, hostEl, laneStripWidth)) return "pointer";
  const hit = nativeClipHitTest(
    clientX,
    clientY,
    hostEl,
    lanes,
    laneYs,
    laneHeights,
    scrollLeft,
    pixelsPerSecond,
    laneStripWidth,
  );
  if (!hit) return null;
  if (hit.edge === "left" || hit.edge === "right") return "ew-resize";
  return "grab";
}
