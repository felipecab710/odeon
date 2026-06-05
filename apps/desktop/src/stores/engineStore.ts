/**
 * Engine store — per-track and master mix state synced from webAudioEngine.
 * Extended to carry Ardour-style peak hold + clip latch per channel.
 */
import { create } from "zustand";
import type { MeterData } from "../lib/webAudioEngine";

export interface TrackEngineState {
  volumeDb:    number;
  pan:         number;
  muted:       boolean;
  soloed:      boolean;
  leftMeterDb:  number;
  rightMeterDb: number;
  peakLeftDb:   number;
  peakRightDb:  number;
  clipping:     boolean;
}

const TRACK_DEFAULTS: TrackEngineState = {
  volumeDb: 0, pan: 0, muted: false, soloed: false,
  leftMeterDb: -90, rightMeterDb: -90,
  peakLeftDb: -90, peakRightDb: -90,
  clipping: false,
};

interface EngineStoreState {
  trackStates:  Record<string, TrackEngineState>;
  masterMeter:  { leftDb: number; rightDb: number; peakLeftDb: number; peakRightDb: number; clipping: boolean };
  setTrackState: (trackId: string, patch: Partial<TrackEngineState>) => void;
  updateMeters:  (meters: Record<string, MeterData>) => void;
  resetClip:     (trackId: string) => void;
  initTrack:     (trackId: string, volumeDb?: number, pan?: number) => void;
}

export const useEngineStore = create<EngineStoreState>((set) => ({
  trackStates: {},
  masterMeter: { leftDb: -90, rightDb: -90, peakLeftDb: -90, peakRightDb: -90, clipping: false },

  initTrack: (trackId, volumeDb = 0, pan = 0) =>
    set((s) => ({
      trackStates: {
        ...s.trackStates,
        [trackId]: s.trackStates[trackId] ?? { ...TRACK_DEFAULTS, volumeDb, pan },
      },
    })),

  setTrackState: (trackId, patch) =>
    set((s) => ({
      trackStates: {
        ...s.trackStates,
        [trackId]: { ...(s.trackStates[trackId] ?? TRACK_DEFAULTS), ...patch },
      },
    })),

  updateMeters: (meters) =>
    set((s) => {
      const next = { ...s.trackStates };
      let masterMeter = s.masterMeter;

      for (const [id, m] of Object.entries(meters)) {
        if (id === "__master__") {
          masterMeter = {
            leftDb: m.leftDb, rightDb: m.rightDb,
            peakLeftDb: m.peakLeftDb, peakRightDb: m.peakRightDb,
            clipping: s.masterMeter.clipping || m.clipping,
          };
        } else {
          const existing = next[id] ?? TRACK_DEFAULTS;
          next[id] = {
            ...existing,
            leftMeterDb:  m.leftDb,
            rightMeterDb: m.rightDb,
            peakLeftDb:   m.peakLeftDb,
            peakRightDb:  m.peakRightDb,
            clipping:     existing.clipping || m.clipping,
          };
        }
      }
      return { trackStates: next, masterMeter };
    }),

  resetClip: (trackId) =>
    set((s) => {
      if (trackId === "__master__") {
        return { masterMeter: { ...s.masterMeter, clipping: false } };
      }
      const existing = s.trackStates[trackId];
      if (!existing) return {};
      return {
        trackStates: { ...s.trackStates, [trackId]: { ...existing, clipping: false } },
      };
    }),
}));
