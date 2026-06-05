/**
 * Edit selection — Start / End / Length of the current timeline range.
 * Canonical values are seconds; formatted for display via timeFormat.
 */
import { create } from "zustand";

interface EditSelectionState {
  startSeconds: number;
  endSeconds: number;

  setStart: (s: number) => void;
  setEnd: (s: number) => void;
  setRange: (start: number, end: number) => void;
  /** Expand/shrink end to match session length when tracks load. */
  syncSessionEnd: (sessionSeconds: number) => void;
  clear: () => void;
}

export const useEditSelectionStore = create<EditSelectionState>((set, get) => ({
  startSeconds: 0,
  endSeconds: 0,

  setStart: (s) => {
    const end = get().endSeconds;
    set({ startSeconds: Math.max(0, Math.min(s, end)) });
  },

  setEnd: (s) => {
    const start = get().startSeconds;
    set({ endSeconds: Math.max(start, s) });
  },

  setRange: (start, end) => {
    const a = Math.max(0, Math.min(start, end));
    const b = Math.max(a, end);
    set({ startSeconds: a, endSeconds: b });
  },

  syncSessionEnd: (sessionSeconds) => {
    const { startSeconds, endSeconds } = get();
    if (endSeconds <= 0 || endSeconds < startSeconds) {
      set({ endSeconds: Math.max(startSeconds, sessionSeconds) });
    }
  },

  clear: () => set({ startSeconds: 0, endSeconds: 0 }),
}));

/** Derived length in seconds. */
export function selectionLengthSeconds(start: number, end: number): number {
  return Math.max(0, end - start);
}
