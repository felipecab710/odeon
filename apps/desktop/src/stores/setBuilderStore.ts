import { create } from "zustand";

export interface SetCard {
  id: string;        // unique canvas ID
  entryId: string;   // CatalogEntry.id
  x: number;
  y: number;
  order: number;     // sequence order in the set
}

export type SetViewMode = "nodes" | "arrangement" | "booth";

interface SetBuilderState {
  setName: string;
  cards: SetCard[];
  selectedCardId: string | null;
  viewMode: SetViewMode;
  /** Index into sorted transitions: transition i = sorted[i] → sorted[i+1] */
  selectedTransitionIndex: number | null;

  setSetName: (name: string) => void;
  addCard: (entryId: string) => void;
  moveCard: (id: string, x: number, y: number) => void;
  removeCard: (id: string) => void;
  selectCard: (id: string | null) => void;
  selectTransition: (index: number | null) => void;
  setViewMode: (mode: SetViewMode) => void;
  reorder: (id: string, newOrder: number) => void;
  clearSet: () => void;
}

let _nextOrder = 0;

export const useSetBuilderStore = create<SetBuilderState>((set, get) => ({
  setName: "New Set",
  cards: [],
  selectedCardId: null,
  viewMode: "nodes",
  selectedTransitionIndex: null,

  setSetName: (setName) => set({ setName }),

  addCard: (entryId) => {
    const existing = get().cards;
    if (existing.some(c => c.entryId === entryId)) return; // no duplicates
    const order = _nextOrder++;
    const col = existing.length % 4;
    const row = Math.floor(existing.length / 4);
    set({
      cards: [
        ...existing,
        { id: crypto.randomUUID(), entryId, x: 260 + col * 260, y: 80 + row * 360, order },
      ],
    });
  },

  moveCard: (id, x, y) => set(s => ({
    cards: s.cards.map(c => c.id === id ? { ...c, x, y } : c),
  })),

  removeCard: (id) => set(s => ({
    cards: s.cards.filter(c => c.id !== id),
    selectedCardId: s.selectedCardId === id ? null : s.selectedCardId,
  })),

  selectCard: (id) => set({ selectedCardId: id }),

  selectTransition: (index) => set(s => {
    if (index == null) return { selectedTransitionIndex: null };
    const sorted = [...s.cards].sort((a, b) => a.order - b.order);
    const fromCard = sorted[index];
    return {
      selectedTransitionIndex: index,
      selectedCardId: fromCard?.id ?? s.selectedCardId,
    };
  }),

  setViewMode: (viewMode) => set({ viewMode }),

  reorder: (id, newOrder) => set(s => ({
    cards: s.cards.map(c => c.id === id ? { ...c, order: newOrder } : c),
  })),

  clearSet: () => {
    _nextOrder = 0;
    set({ cards: [], selectedCardId: null, selectedTransitionIndex: null, viewMode: "nodes" });
  },
}));
