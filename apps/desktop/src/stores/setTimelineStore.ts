/**
 * Set Builder timeline viewport — separate from Production Studio zoom/scroll.
 * Same Audacity anchor model as timelineStore (ZoomInfo + Viewport).
 */
import { create } from "zustand";
import { markZoomActivity, setGestureBaselinePps, setGestureAnchorTimelineX, isZooming } from "../lib/zoomInteraction";
import { flushZoomCommit } from "../lib/zoomGestureViewport";
import { zoomAtAnchor } from "../lib/timelineViewportZoom";
import {
  clampPxPerSec,
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
} from "../components/setbuilder/setTimelineLayout";

const ZOOM_STORAGE_KEY = "odeon-set-timeline-px-per-sec";

function readStoredPps(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    return Number.isFinite(v) ? clampPxPerSec(v) : DEFAULT_PX_PER_SEC;
  } catch {
    return DEFAULT_PX_PER_SEC;
  }
}

function persistPps(pps: number) {
  try { localStorage.setItem(ZOOM_STORAGE_KEY, String(pps)); } catch { /* ignore */ }
}

export interface ZoomSnapshot {
  pixelsPerSecond: number;
  scrollLeft: number;
}

const MAX_ZOOM_HISTORY = 32;

interface SetTimelineState {
  pixelsPerSecond: number;
  scrollLeft: number;
  zoomHistory: ZoomSnapshot[];
  setScrollLeft: (px: number) => void;
  zoomAt: (factor: number, anchorViewportX: number, scrollLeftOverride?: number) => boolean;
  setPixelsPerSecond: (pps: number) => void;
  setView: (pps: number, scrollLeft: number) => void;
  pushZoomSnapshot: () => void;
  restorePreviousZoom: () => boolean;
  zoomToTimeRange: (startSec: number, endSec: number, viewportWidth: number, marginRatio?: number) => boolean;
  fitToDuration: (totalSec: number, viewportWidth: number) => void;
  resetView: () => void;
}

export const useSetTimelineStore = create<SetTimelineState>((set, get) => ({
  pixelsPerSecond: readStoredPps(),
  scrollLeft: 0,
  zoomHistory: [],

  setScrollLeft: (px) => set({ scrollLeft: Math.max(0, px) }),

  setPixelsPerSecond: (pps) => {
    const clamped = clampPxPerSec(pps);
    persistPps(clamped);
    set({ pixelsPerSecond: clamped });
  },

  setView: (pps, scrollLeft) => {
    const clamped = clampPxPerSec(pps);
    persistPps(clamped);
    set({ pixelsPerSecond: clamped, scrollLeft: Math.max(0, scrollLeft) });
  },

  pushZoomSnapshot: () => {
    const { pixelsPerSecond, scrollLeft, zoomHistory } = get();
    const snap: ZoomSnapshot = { pixelsPerSecond, scrollLeft };
    const last = zoomHistory[zoomHistory.length - 1];
    if (last
      && Math.abs(last.pixelsPerSecond - snap.pixelsPerSecond) < 1e-6
      && Math.abs(last.scrollLeft - snap.scrollLeft) < 0.5) {
      return;
    }
    set({ zoomHistory: [...zoomHistory, snap].slice(-MAX_ZOOM_HISTORY) });
  },

  restorePreviousZoom: () => {
    const { zoomHistory } = get();
    if (zoomHistory.length === 0) return false;
    const prev = zoomHistory[zoomHistory.length - 1];
    persistPps(prev.pixelsPerSecond);
    set({
      zoomHistory: zoomHistory.slice(0, -1),
      pixelsPerSecond: prev.pixelsPerSecond,
      scrollLeft: prev.scrollLeft,
    });
    return true;
  },

  zoomToTimeRange: (startSec, endSec, viewportWidth, marginRatio = 0.08) => {
    const span = Math.max(0.25, endSec - startSec);
    const pad = span * marginRatio;
    const t0 = Math.max(0, startSec - pad);
    const t1 = endSec + pad;
    const available = Math.max(200, viewportWidth - 48);
    const pps = clampPxPerSec(available / (t1 - t0));
    persistPps(pps);
    set({ pixelsPerSecond: pps, scrollLeft: t0 * pps });
    return true;
  },

  zoomAt: (factor, anchorViewportX, scrollLeftOverride) => {
    flushZoomCommit();
    const { pixelsPerSecond, scrollLeft } = get();
    const result = zoomAtAnchor({
      oldPps: pixelsPerSecond,
      factor,
      scrollLeft: scrollLeftOverride ?? scrollLeft,
      anchorViewportX,
      minPps: MIN_PX_PER_SEC,
      maxPps: MAX_PX_PER_SEC,
    });
    if (!result) return false;
    const sl = scrollLeftOverride ?? scrollLeft;
    if (!isZooming()) {
      setGestureBaselinePps(pixelsPerSecond);
      setGestureAnchorTimelineX(sl + anchorViewportX);
    }
    markZoomActivity();
    persistPps(result.newPps);
    set({ pixelsPerSecond: result.newPps, scrollLeft: result.newScrollLeft });
    return true;
  },

  fitToDuration: (totalSec, viewportWidth) => {
    if (totalSec <= 0) return;
    const available = Math.max(200, viewportWidth - 48);
    const pps = clampPxPerSec(available / totalSec);
    persistPps(pps);
    set({ pixelsPerSecond: pps, scrollLeft: 0 });
  },

  resetView: () => {
    persistPps(DEFAULT_PX_PER_SEC);
    set({ pixelsPerSecond: DEFAULT_PX_PER_SEC, scrollLeft: 0 });
  },
}));
