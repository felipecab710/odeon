/**
 * Selection store — tracks which tracks are selected / compared.
 */
import { create } from "zustand";

interface SelectionState {
  selectedTrackId: string | null;
  compareUserTrackId: string | null;
  compareRefTrackId: string | null;
  activePanel: "inspector" | "comparison" | "mixmoves";
  selectTrack: (id: string | null) => void;
  setCompareUserTrack: (id: string | null) => void;
  setCompareRefTrack: (id: string | null) => void;
  setActivePanel: (panel: SelectionState["activePanel"]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedTrackId: null,
  compareUserTrackId: null,
  compareRefTrackId: null,
  activePanel: "inspector",

  selectTrack: (id) => set({ selectedTrackId: id, activePanel: "inspector" }),
  setCompareUserTrack: (id) => set({ compareUserTrackId: id }),
  setCompareRefTrack: (id) => set({ compareRefTrackId: id }),
  setActivePanel: (panel) => set({ activePanel: panel }),
}));
