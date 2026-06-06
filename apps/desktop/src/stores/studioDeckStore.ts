/**
 * Studio timeline deck mixes — shared between lane strips and Pioneer booth mirror.
 */
import { create } from "zustand";
import { type DeckMix, defaultDeckMix } from "../lib/deckMixEngine";

interface StudioDeckStoreState {
  mixes: Record<number, DeckMix>;
  setMix: (laneIndex: number, mix: DeckMix) => void;
  setMixes: (mixes: Record<number, DeckMix>) => void;
  getMix: (laneIndex: number) => DeckMix;
  reset: () => void;
}

export const useStudioDeckStore = create<StudioDeckStoreState>((set, get) => ({
  mixes: {},

  setMix: (laneIndex, mix) =>
    set(s => ({ mixes: { ...s.mixes, [laneIndex]: mix } })),

  setMixes: (mixes) => set({ mixes }),

  getMix: (laneIndex) => get().mixes[laneIndex] ?? defaultDeckMix(),

  reset: () => set({ mixes: {} }),
}));
