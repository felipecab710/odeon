import { create } from "zustand";
import type { OdeonTrack } from "@odeon/shared";
import type { TrackViewMode } from "../lib/trackView";
import {
  defaultAutomation,
  type AutomationPoint,
  isAutomationMode,
} from "../lib/trackAutomation";

type TrackAutomationMap = Record<string, Partial<Record<TrackViewMode, AutomationPoint[]>>>;

interface TrackAutomationState {
  playlists: TrackAutomationMap;
  getPoints: (track: OdeonTrack, mode: TrackViewMode) => AutomationPoint[];
  setPoints: (trackId: string, mode: TrackViewMode, points: AutomationPoint[]) => void;
  ensureDefaults: (track: OdeonTrack, mode: TrackViewMode) => void;
}

export const useTrackAutomationStore = create<TrackAutomationState>((set, get) => ({
  playlists: {},

  getPoints: (track, mode) => {
    if (!isAutomationMode(mode)) return [];
    const stored = get().playlists[track.id]?.[mode];
    if (stored?.length) return stored;
    const duration = track.analysis?.duration_seconds ?? 60;
    return defaultAutomation(track, mode, duration);
  },

  ensureDefaults: (track, mode) => {
    if (!isAutomationMode(mode)) return;
    const existing = get().playlists[track.id]?.[mode];
    if (existing?.length) return;
    const duration = track.analysis?.duration_seconds ?? 60;
    const points = defaultAutomation(track, mode, duration);
    set((s) => ({
      playlists: {
        ...s.playlists,
        [track.id]: { ...s.playlists[track.id], [mode]: points },
      },
    }));
  },

  setPoints: (trackId, mode, points) =>
    set((s) => ({
      playlists: {
        ...s.playlists,
        [trackId]: { ...s.playlists[trackId], [mode]: points },
      },
    })),
}));
