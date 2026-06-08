/**
 * Timeline viewport — zoom, scroll, seek helpers.
 */
import { create } from "zustand";
import {
  MAX_PPS, MIN_PPS, DEFAULT_PPS, pxToTime,
  TRACK_H, MIN_TRACK_H, MAX_TRACK_H,
} from "../lib/timelineUtils";
import { zoomAtAnchor } from "../lib/timelineViewportZoom";

interface TimelineState {
  pixelsPerSecond: number;
  scrollLeft: number;
  trackHeights: Record<string, number>;
  setScrollLeft: (px: number) => void;
  zoomAt: (factor: number, anchorXInContent: number) => void;
  resetView: () => void;
  getTrackHeight: (trackId: string) => number;
  setTrackHeight: (trackId: string, height: number) => void;
  clearTrackHeight: (trackId: string) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  pixelsPerSecond: DEFAULT_PPS,
  scrollLeft: 0,
  trackHeights: {},

  setScrollLeft: (px) => set({ scrollLeft: Math.max(0, px) }),

  /** @param anchorViewportX — X within the visible viewport (not content-absolute) */
  zoomAt: (factor, anchorViewportX) => {
    const { pixelsPerSecond, scrollLeft } = get();
    const result = zoomAtAnchor({
      oldPps: pixelsPerSecond,
      factor,
      scrollLeft,
      anchorViewportX,
      minPps: MIN_PPS,
      maxPps: MAX_PPS,
    });
    if (!result) return;
    set({ pixelsPerSecond: result.newPps, scrollLeft: result.newScrollLeft });
  },

  resetView: () => set({ pixelsPerSecond: DEFAULT_PPS, scrollLeft: 0 }),

  getTrackHeight: (trackId) => {
    const h = get().trackHeights[trackId];
    return h ?? TRACK_H;
  },

  setTrackHeight: (trackId, height) => {
    const clamped = Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, Math.round(height)));
    set((s) => ({
      trackHeights: { ...s.trackHeights, [trackId]: clamped },
    }));
  },

  clearTrackHeight: (trackId) =>
    set((s) => {
      const { [trackId]: _, ...rest } = s.trackHeights;
      return { trackHeights: rest };
    }),
}));

/** Convert viewport X (0 = left edge of visible clip area) to timeline seconds. */
export function seekTimeFromViewportX(viewportX: number, pps: number, scrollLeft: number, maxDuration: number) {
  const t = pxToTime(scrollLeft + viewportX, pps);
  return Math.max(0, Math.min(maxDuration, t));
}
