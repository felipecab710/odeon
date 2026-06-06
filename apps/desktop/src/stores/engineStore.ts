/**
 * Engine store — per-track and master mix state synced from the native engine.
 * Carries Ardour-style peak hold + clip latch per channel.
 */
import { create } from "zustand";

/** Per-track meter snapshot from a single poll interval. */
export interface MeterData {
  leftDb:      number;
  rightDb:     number;
  peakLeftDb:  number;
  peakRightDb: number;
  clipping:    boolean;
  rmsLeftDb?:  number;
  rmsRightDb?: number;
}

export interface TrackEngineState {
  volumeDb:    number;
  pan:         number;
  muted:       boolean;
  soloed:      boolean;
  /** false = pre-fader meter (default), true = post-fader/post-mute */
  meterPost:   boolean;
  leftMeterDb:  number;
  rightMeterDb: number;
  peakLeftDb:   number;
  peakRightDb:  number;
  clipping:     boolean;
}

const TRACK_DEFAULTS: TrackEngineState = {
  volumeDb: 0, pan: 0, muted: false, soloed: false, meterPost: false,
  leftMeterDb: -90, rightMeterDb: -90,
  peakLeftDb: -90, peakRightDb: -90,
  clipping: false,
};

interface EngineStoreState {
  trackStates:  Record<string, TrackEngineState>;
  masterMeter:  { leftDb: number; rightDb: number; peakLeftDb: number; peakRightDb: number; clipping: boolean };
  setTrackState: (trackId: string, patch: Partial<TrackEngineState>) => void;
  updateMeters:  (meters: Record<string, MeterData>) => void;
  resetLiveMeters: () => void;
  resetClip:     (trackId: string) => void;
  initTrack:     (trackId: string, volumeDb?: number, pan?: number) => void;
  removeTrack:   (trackId: string) => void;
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
      let changed = false;

      for (const [id, m] of Object.entries(meters)) {
        if (id === "__master__") {
          const clip = s.masterMeter.clipping || m.clipping;
          if (
            s.masterMeter.leftDb !== m.leftDb ||
            s.masterMeter.rightDb !== m.rightDb ||
            s.masterMeter.peakLeftDb !== m.peakLeftDb ||
            s.masterMeter.peakRightDb !== m.peakRightDb ||
            s.masterMeter.clipping !== clip
          ) {
            changed = true;
            masterMeter = {
              leftDb: m.leftDb, rightDb: m.rightDb,
              peakLeftDb: m.peakLeftDb, peakRightDb: m.peakRightDb,
              clipping: clip,
            };
          }
        } else {
          const existing = next[id] ?? TRACK_DEFAULTS;
          const clip = existing.clipping || m.clipping;
          if (
            existing.leftMeterDb !== m.leftDb ||
            existing.rightMeterDb !== m.rightDb ||
            existing.peakLeftDb !== m.peakLeftDb ||
            existing.peakRightDb !== m.peakRightDb ||
            existing.clipping !== clip
          ) {
            changed = true;
            next[id] = {
              ...existing,
              leftMeterDb:  m.leftDb,
              rightMeterDb: m.rightDb,
              peakLeftDb:   m.peakLeftDb,
              peakRightDb:  m.peakRightDb,
              clipping:     clip,
            };
          }
        }
      }
      if (!changed) return s;
      return { trackStates: next, masterMeter };
    }),

  resetLiveMeters: () =>
    set((s) => {
      const next: Record<string, TrackEngineState> = {};
      let changed = false;
      for (const [id, t] of Object.entries(s.trackStates)) {
        if (
          t.leftMeterDb !== -90 || t.rightMeterDb !== -90 ||
          t.peakLeftDb !== -90 || t.peakRightDb !== -90 || t.clipping
        ) {
          changed = true;
          next[id] = {
            ...t,
            leftMeterDb: -90, rightMeterDb: -90,
            peakLeftDb: -90, peakRightDb: -90,
            clipping: false,
          };
        } else {
          next[id] = t;
        }
      }
      const masterSilent =
        s.masterMeter.leftDb !== -90 ||
        s.masterMeter.rightDb !== -90 ||
        s.masterMeter.clipping;
      if (!changed && !masterSilent) return s;
      return {
        trackStates: changed ? next : s.trackStates,
        masterMeter: { leftDb: -90, rightDb: -90, peakLeftDb: -90, peakRightDb: -90, clipping: false },
      };
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

  removeTrack: (trackId) =>
    set((s) => {
      const { [trackId]: _, ...rest } = s.trackStates;
      return { trackStates: rest };
    }),
}));
