/**
 * Transport store — tracks playback state and interacts with the engine.
 */
import { create } from "zustand";
import { engineClient } from "../lib/engineClient";
import { webAudioEngine } from "../lib/webAudioEngine";
import { useEngineStore } from "./engineStore";
import type { Timebase } from "../lib/timeFormat";

export type ABMode = "reference" | "my-mix" | "matched-preview";

interface TransportState {
  isPlaying: boolean;
  /** Playhead — advances during playback */
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
  webAudioReady: boolean;   // true when ≥1 track loaded in Web Audio

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
  setWebAudioReady: (v: boolean) => void;
  toggleLoop: () => void;
  setAbMode: (m: ABMode) => void;
}

export const useTransportStore = create<TransportState>((set, get) => {
  // Playhead ticker — does not move the edit cursor
  webAudioEngine.onPositionUpdate((pos) => {
    set({
      positionSeconds: pos,
      isPlaying: webAudioEngine.isPlaying(),
    });
  });

  webAudioEngine.onReadyChange((ready) => {
    set({ webAudioReady: ready });
  });

  // Wire live meter data from Web Audio analysers → engineStore (full MeterData passthrough)
  webAudioEngine.onMeterUpdate((meters) => {
    useEngineStore.getState().updateMeters(meters);
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
    webAudioReady: false,

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
    setWebAudioReady: (v) => set({ webAudioReady: v }),
    toggleLoop: () => set((s) => ({ isLoopEnabled: !s.isLoopEnabled })),
    setAbMode: (m) => set({ abMode: m }),

    play: async () => {
      if (webAudioEngine.isPlaying()) return;
      const { positionSeconds } = get();
      webAudioEngine.play(positionSeconds);
      set({ isPlaying: true });
    },

    pause: async () => {
      if (!webAudioEngine.isPlaying()) {
        set({ isPlaying: false });
        return;
      }
      webAudioEngine.pause();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false, positionSeconds: webAudioEngine.getPosition() });
    },

    togglePlayPause: async () => {
      if (webAudioEngine.isPlaying()) await get().pause();
      else await get().play();
    },

    stop: async () => {
      webAudioEngine.stop();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false, positionSeconds: 0, cursorSeconds: 0, cursorTrackId: null });
    },

    seek: async (timeSeconds) => {
      webAudioEngine.seek(timeSeconds);
      set({ positionSeconds: timeSeconds });
    },
  };
});
