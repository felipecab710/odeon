/**
 * Ephemeral interaction state — drag previews, pointer capture.
 * Separated from session/domain state for instant visual feedback.
 */
import { create } from "zustand";
import { dragSnapIntervalSeconds, snapToGrid } from "../lib/timelineUtils";

interface InteractionState {
  draggingTrackId: string | null;
  dragClipStartSeconds: number | null;
  /** Seconds into the clip where the user grabbed (for absolute drag positioning) */
  dragGrabOffsetSec: number | null;

  startClipDrag: (trackId: string, clipStart: number, contentX: number, pps: number) => void;
  updateClipDrag: (
    contentX: number,
    pps: number,
    sessionDuration: number,
    clipDuration: number,
    bpm?: number | null,
  ) => void;
  endClipDrag: () => { trackId: string; clipStart: number } | null;
  cancelClipDrag: () => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  draggingTrackId: null,
  dragClipStartSeconds: null,
  dragGrabOffsetSec: null,

  startClipDrag: (trackId, clipStart, contentX, pps) => {
    const clickTime = contentX / pps;
    set({
      draggingTrackId: trackId,
      dragClipStartSeconds: clipStart,
      dragGrabOffsetSec: clickTime - clipStart,
    });
  },

  updateClipDrag: (contentX, pps, sessionDuration, clipDuration, bpm) => {
    const s = get();
    if (s.dragGrabOffsetSec === null) return;
    const mouseTime = contentX / pps;
    const maxStart = Math.max(0, sessionDuration - clipDuration);
    const raw = Math.max(0, Math.min(maxStart, mouseTime - s.dragGrabOffsetSec));
    const interval = dragSnapIntervalSeconds(pps, bpm);
    const next = snapToGrid(raw, interval);
    if (next === s.dragClipStartSeconds) return;
    set({ dragClipStartSeconds: next });
  },

  endClipDrag: () => {
    const s = get();
    if (!s.draggingTrackId || s.dragClipStartSeconds === null) return null;
    const result = { trackId: s.draggingTrackId, clipStart: s.dragClipStartSeconds };
    set({
      draggingTrackId: null,
      dragClipStartSeconds: null,
      dragGrabOffsetSec: null,
    });
    return result;
  },

  cancelClipDrag: () =>
    set({
      draggingTrackId: null,
      dragClipStartSeconds: null,
      dragGrabOffsetSec: null,
    }),
}));
