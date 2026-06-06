import { create } from "zustand";
import { captureUndoState } from "./undoStore";

export interface SetCard {
  id: string;        // unique canvas ID
  entryId: string;   // CatalogEntry.id
  x: number;
  y: number;
  order: number;     // sequence order in the set
  /** Manual start time on arrangement timeline (seconds). null = auto-overlap layout. */
  timelineStartSec: number | null;
}

export type SetViewMode = "nodes" | "arrangement" | "booth";

interface SetBuilderState {
  setName: string;
  cards: SetCard[];
  selectedCardId: string | null;
  /** Track selected on the Studio timeline — drives the track analysis panel. */
  timelineSelectedCardId: string | null;
  viewMode: SetViewMode;
  /** Index into sorted transitions: transition i = sorted[i] → sorted[i+1] */
  selectedTransitionIndex: number | null;

  setSetName: (name: string) => void;
  addCard: (entryId: string) => void;
  moveCard: (id: string, x: number, y: number) => void;
  removeCard: (id: string) => void;
  selectCard: (id: string | null) => void;
  selectTimelineCard: (id: string | null) => void;
  selectTransition: (index: number | null) => void;
  setViewMode: (mode: SetViewMode) => void;
  reorder: (id: string, newOrder: number) => void;
  /** Place toCard immediately after fromCard in the set sequence. */
  connectAfter: (fromCardId: string, toCardId: string) => void;
  setTimelineStart: (id: string, startSec: number | null) => void;
  clearTimelinePositions: () => void;
  clearSet: () => void;
}

let _nextOrder = 0;

export const useSetBuilderStore = create<SetBuilderState>((set, get) => ({
  setName: "New Set",
  cards: [],
  selectedCardId: null,
  timelineSelectedCardId: null,
  viewMode: "nodes",
  selectedTransitionIndex: null,

  setSetName: (setName) => set({ setName }),

  addCard: (entryId) => {
    const existing = get().cards;
    if (existing.some(c => c.entryId === entryId)) return; // no duplicates
    captureUndoState();
    const order = _nextOrder++;
    const col = existing.length % 4;
    const row = Math.floor(existing.length / 4);
    set({
      cards: [
        ...existing,
        { id: crypto.randomUUID(), entryId, x: 260 + col * 260, y: 80 + row * 360, order, timelineStartSec: null },
      ],
    });
  },

  moveCard: (id, x, y) => set(s => ({
    cards: s.cards.map(c => c.id === id ? { ...c, x, y } : c),
  })),

  removeCard: (id) => {
    captureUndoState();
    set(s => {
    const sorted = [...s.cards].filter(c => c.id !== id).sort((a, b) => a.order - b.order);
    const cards = sorted.map((c, i) => ({ ...c, order: i }));
    _nextOrder = cards.length;
    return {
      cards,
      selectedCardId: s.selectedCardId === id ? null : s.selectedCardId,
      timelineSelectedCardId: s.timelineSelectedCardId === id ? null : s.timelineSelectedCardId,
    };
    });
  },

  selectCard: (id) => set(s => ({
    selectedCardId: id,
    selectedTransitionIndex: id != null ? null : s.selectedTransitionIndex,
  })),

  selectTimelineCard: (id) => set({ timelineSelectedCardId: id }),

  selectTransition: (index) => set(s => ({
    selectedTransitionIndex: index,
    selectedCardId: index != null ? null : s.selectedCardId,
  })),

  setViewMode: (viewMode) => set({ viewMode }),

  reorder: (id, newOrder) => set(s => ({
    cards: s.cards.map(c => c.id === id ? { ...c, order: newOrder } : c),
  })),

  connectAfter: (fromCardId, toCardId) => set(s => {
    if (fromCardId === toCardId) return s;
    const sorted = [...s.cards].sort((a, b) => a.order - b.order);
    const toCard = sorted.find(c => c.id === toCardId);
    if (!toCard) return s;
    const without = sorted.filter(c => c.id !== toCardId);
    const fromIdx = without.findIndex(c => c.id === fromCardId);
    if (fromIdx < 0) return s;
    without.splice(fromIdx + 1, 0, toCard);
    const cards = s.cards.map(c => ({
      ...c,
      order: without.findIndex(x => x.id === c.id),
    }));
    return { ...s, cards };
  }),

  setTimelineStart: (id, startSec) => {
    captureUndoState();
    set(s => ({
      cards: s.cards.map(c => c.id === id ? { ...c, timelineStartSec: startSec } : c),
    }));
  },

  clearTimelinePositions: () => set(s => ({
    cards: s.cards.map(c => ({ ...c, timelineStartSec: null })),
  })),

  clearSet: () => {
    _nextOrder = 0;
    set({ cards: [], selectedCardId: null, timelineSelectedCardId: null, selectedTransitionIndex: null, viewMode: "nodes" });
  },
}));
