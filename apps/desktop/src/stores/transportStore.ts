/**
 * Transport store — tracks playback state and routes commands to the native engine.
 *
 * All transport, meter, and loop control goes through engineClient (native C++
 * odeon-engine sidecar). Web Audio is no longer used for playback.
 */
import { create } from "zustand";
import { engineClient } from "../lib/engineClient";
import { useEngineStore } from "./engineStore";
import type { Timebase } from "../lib/timeFormat";

export type ABMode = "reference" | "my-mix" | "matched-preview";

interface TransportState {
  isPlaying: boolean;
  /** Playhead — updated from engine:transportState events */
  positionSeconds: number;
  /** Edit cursor — follows mouse on timeline, independent of playhead */
  cursorSeconds: number;
  /** Track under the edit cursor (for per-lane dB readout) */
  cursorTrackId: string | null;
  /** Main counter display format */
  mainTimebase: Timebase;
  showSubCounter: boolean;
  bpm: number;
  isLoopEnabled: boolean;
  abMode: ABMode;
  engineReady: boolean;
  /** True once engine emits tracksReady (clips loaded into Edit — can play) */
  engineTracksReady: boolean;

  // Actions
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seek: (timeSeconds: number) => Promise<void>;
  setIsPlaying: (v: boolean) => void;
  setPosition: (s: number) => void;
  setCursor: (s: number, trackId?: string | null) => void;
  setMainTimebase: (tb: Timebase) => void;
  toggleShowSubCounter: () => void;
  setBpm: (bpm: number) => void;
  setEngineReady: (v: boolean) => void;
  setEngineTracksReady: (v: boolean) => void;
  toggleLoop: () => void;
  setAbMode: (m: ABMode) => void;
}

export const useTransportStore = create<TransportState>((set, get) => {
  // Subscribe to native engine position + playing state
  engineClient.onTransportState((data) => {
    set({
      positionSeconds: data.positionSeconds,
      isPlaying: data.isPlaying,
    });
  });

  // Subscribe to native engine meters → engineStore
  engineClient.onTrackMeters((data) => {
    useEngineStore.getState().updateMeters(data.meters as never);
  });

  // tracksReady event — enables the Play button
  engineClient.onTracksReady(() => {
    set({ engineTracksReady: true });
  });

  return {
    isPlaying: false,
    positionSeconds: 0,
    cursorSeconds: 0,
    cursorTrackId: null,
    mainTimebase: "bars-beats",
    showSubCounter: false,
    bpm: 120,
    isLoopEnabled: false,
    abMode: "reference",
    engineReady: false,
    engineTracksReady: false,

    setIsPlaying: (v) => set({ isPlaying: v }),
    setPosition: (s) => set({ positionSeconds: s }),
    setCursor: (s, trackId) => set({
      cursorSeconds: s,
      ...(trackId !== undefined ? { cursorTrackId: trackId } : {}),
    }),
    setMainTimebase: (tb) => set({ mainTimebase: tb }),
    toggleShowSubCounter: () => set((s) => ({ showSubCounter: !s.showSubCounter })),
    setBpm: (bpm) => set({ bpm }),
    setEngineReady: (v) => set({ engineReady: v }),
    setEngineTracksReady: (v) => set({ engineTracksReady: v }),
    toggleLoop: () => {
      const { isLoopEnabled, positionSeconds } = get();
      const next = !isLoopEnabled;
      // Loop range: from current position + 8 bars (approx) when enabling
      void engineClient.setLoop(next, positionSeconds, positionSeconds + 16);
      set({ isLoopEnabled: next });
    },
    setAbMode: (m) => set({ abMode: m }),

    play: async () => {
      const { isPlaying, positionSeconds } = get();
      if (isPlaying) return;
      await engineClient.seek(positionSeconds);
      await engineClient.play();
      set({ isPlaying: true });
    },

    pause: async () => {
      await engineClient.pause();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false });
    },

    togglePlayPause: async () => {
      if (get().isPlaying) await get().pause();
      else await get().play();
    },

    stop: async () => {
      await engineClient.stop();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false, positionSeconds: 0, cursorSeconds: 0, cursorTrackId: null });
    },

    seek: async (timeSeconds) => {
      await engineClient.seek(timeSeconds);
      set({ positionSeconds: timeSeconds });
    },
  };
});
