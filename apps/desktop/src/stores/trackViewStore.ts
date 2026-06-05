import { create } from "zustand";
import type { TrackViewMode } from "../lib/trackView";

interface TrackViewState {
  modes: Record<string, TrackViewMode>;
  getMode: (trackId: string) => TrackViewMode;
  setMode: (trackId: string, mode: TrackViewMode) => void;
  clearTrack: (trackId: string) => void;
}

export const useTrackViewStore = create<TrackViewState>((set, get) => ({
  modes: {},

  getMode: (trackId) => get().modes[trackId] ?? "waveform",

  setMode: (trackId, mode) =>
    set((s) => ({ modes: { ...s.modes, [trackId]: mode } })),

  clearTrack: (trackId) =>
    set((s) => {
      const { [trackId]: _, ...rest } = s.modes;
      return { modes: rest };
    }),
}));
