/**
 * Transport store — tracks playback state and interacts with the engine.
 */
import { create } from "zustand";
import { engineClient } from "../lib/engineClient";

export type ABMode = "reference" | "my-mix" | "matched-preview";

interface TransportState {
  isPlaying: boolean;
  positionSeconds: number;
  bpm: number;
  isLoopEnabled: boolean;
  abMode: ABMode;
  engineReady: boolean;

  // Actions
  play: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (timeSeconds: number) => Promise<void>;
  setIsPlaying: (v: boolean) => void;
  setPosition: (s: number) => void;
  setBpm: (bpm: number) => void;
  setEngineReady: (v: boolean) => void;
  toggleLoop: () => void;
  setAbMode: (m: ABMode) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  isPlaying: false,
  positionSeconds: 0,
  bpm: 120,
  isLoopEnabled: false,
  abMode: "reference",
  engineReady: false,

  setIsPlaying: (v) => set({ isPlaying: v }),
  setPosition: (s) => set({ positionSeconds: s }),
  setBpm: (bpm) => set({ bpm }),
  setEngineReady: (v) => set({ engineReady: v }),
  toggleLoop: () => set((s) => ({ isLoopEnabled: !s.isLoopEnabled })),
  setAbMode: (m) => set({ abMode: m }),

  play: async () => {
    await engineClient.play();
    set({ isPlaying: true });
  },
  stop: async () => {
    await engineClient.stop();
    set({ isPlaying: false, positionSeconds: 0 });
  },
  seek: async (timeSeconds) => {
    await engineClient.seek(timeSeconds);
    set({ positionSeconds: timeSeconds });
  },
}));
