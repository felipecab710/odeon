import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";
import { SetTimelineContext } from "./setTimelineContext";

export function nativeViewportXFromClientX(clientX: number, hostEl: HTMLElement): number {
  return SetTimelineContext.viewportXFromClientX(clientX, hostEl);
}

export function nativeTimeSecFromClientX(
  clientX: number,
  hostEl: HTMLElement,
  scrollLeft: number,
  pixelsPerSecond: number,
  totalSec: number,
): number {
  const viewportX = nativeViewportXFromClientX(clientX, hostEl);
  const contentX = scrollLeft + viewportX;
  return Math.max(0, Math.min(totalSec, contentX / Math.max(pixelsPerSecond, 1e-9)));
}

export function nativeLaneIndexFromClientY(
  clientY: number,
  hostEl: HTMLElement,
  laneYs: number[],
  laneHeights: number[],
): number | null {
  const y = clientY - hostEl.getBoundingClientRect().top;
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
): { laneIndex: number; lane: LaneLayout } | null {
  const laneIndex = nativeLaneIndexFromClientY(clientY, hostEl, laneYs, laneHeights);
  if (laneIndex == null) return null;
  const lane = lanes[laneIndex];
  if (!lane) return null;
  const timeSec = nativeTimeSecFromClientX(
    clientX,
    hostEl,
    scrollLeft,
    pixelsPerSecond,
    Number.POSITIVE_INFINITY,
  );
  if (timeSec >= lane.startSec && timeSec <= lane.endSec) {
    return { laneIndex, lane };
  }
  return null;
}
