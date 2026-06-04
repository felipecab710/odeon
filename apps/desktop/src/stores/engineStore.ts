/**
 * Engine store — holds meter data and per-track engine state.
 */
import { create } from "zustand";

interface TrackEngineState {
  volumeDb: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  leftMeterDb: number;
  rightMeterDb: number;
}

interface EngineStoreState {
  trackStates: Record<string, TrackEngineState>;
  setTrackState: (trackId: string, patch: Partial<TrackEngineState>) => void;
  updateMeters: (meters: Record<string, { leftDb: number; rightDb: number }>) => void;
  initTrack: (trackId: string, volumeDb?: number, pan?: number) => void;
}

export const useEngineStore = create<EngineStoreState>((set) => ({
  trackStates: {},

  initTrack: (trackId, volumeDb = 0, pan = 0) =>
    set((s) => ({
      trackStates: {
        ...s.trackStates,
        [trackId]: s.trackStates[trackId] ?? {
          volumeDb,
          pan,
          muted: false,
          soloed: false,
          leftMeterDb: -120,
          rightMeterDb: -120,
        },
      },
    })),

  setTrackState: (trackId, patch) =>
    set((s) => ({
      trackStates: {
        ...s.trackStates,
        [trackId]: { ...s.trackStates[trackId], ...patch },
      },
    })),

  updateMeters: (meters) =>
    set((s) => {
      const next = { ...s.trackStates };
      for (const [id, m] of Object.entries(meters)) {
        if (next[id]) {
          next[id] = {
            ...next[id],
            leftMeterDb: m.leftDb,
            rightMeterDb: m.rightDb,
          };
        }
      }
      return { trackStates: next };
    }),
}));
