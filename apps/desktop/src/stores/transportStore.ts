/**
 * Transport store — tracks playback state and interacts with the engine.
 */
import { create } from "zustand";
import { engineClient } from "../lib/engineClient";
import { webAudioEngine } from "../lib/webAudioEngine";
import { useEngineStore } from "./engineStore";

export type ABMode = "reference" | "my-mix" | "matched-preview";

interface TransportState {
  isPlaying: boolean;
  positionSeconds: number;
  bpm: number;
  isLoopEnabled: boolean;
  abMode: ABMode;
  engineReady: boolean;
  webAudioReady: boolean;   // true when ≥1 track loaded in Web Audio

  // Actions
  play: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (timeSeconds: number) => Promise<void>;
  setIsPlaying: (v: boolean) => void;
  setPosition: (s: number) => void;
  setBpm: (bpm: number) => void;
  setEngineReady: (v: boolean) => void;
  setWebAudioReady: (v: boolean) => void;
  toggleLoop: () => void;
  setAbMode: (m: ABMode) => void;
}

export const useTransportStore = create<TransportState>((set, get) => {
  // Wire Web Audio position ticker into the store
  webAudioEngine.onPositionUpdate((pos) => {
    set({ positionSeconds: pos });
    if (!webAudioEngine.isPlaying()) {
      set({ isPlaying: false });
    }
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
    bpm: 120,
    isLoopEnabled: false,
    abMode: "reference",
    engineReady: false,
    webAudioReady: false,

    setIsPlaying: (v) => set({ isPlaying: v }),
    setPosition: (s) => set({ positionSeconds: s }),
    setBpm: (bpm) => set({ bpm }),
    setEngineReady: (v) => set({ engineReady: v }),
    setWebAudioReady: (v) => set({ webAudioReady: v }),
    toggleLoop: () => set((s) => ({ isLoopEnabled: !s.isLoopEnabled })),
    setAbMode: (m) => set({ abMode: m }),

    play: async () => {
      const { positionSeconds } = get();
      // Web Audio is the primary playback path.
      // The C++ engine handles routing/render; it does not have audio files
      // loaded in the current session so we never delegate play/stop to it.
      webAudioEngine.play(positionSeconds);
      set({ isPlaying: true });
    },

    stop: async () => {
      webAudioEngine.stop();
      set({ isPlaying: false, positionSeconds: 0 });
    },

    seek: async (timeSeconds) => {
      webAudioEngine.seek(timeSeconds);
      set({ positionSeconds: timeSeconds });
    },
  };
});
