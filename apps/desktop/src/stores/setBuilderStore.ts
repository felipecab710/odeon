import { create } from "zustand";

export interface SetCard {
  id: string;        // unique canvas ID
  entryId: string;   // CatalogEntry.id
  x: number;
  y: number;
  order: number;     // sequence order in the set
}

interface SetBuilderState {
  setName: string;
  cards: SetCard[];
  selectedCardId: string | null;

  setSetName: (name: string) => void;
  addCard: (entryId: string) => void;
  moveCard: (id: string, x: number, y: number) => void;
  removeCard: (id: string) => void;
  selectCard: (id: string | null) => void;
  reorder: (id: string, newOrder: number) => void;
  clearSet: () => void;
}

let _nextOrder = 0;

export const useSetBuilderStore = create<SetBuilderState>((set, get) => ({
  setName: "New Set",
  cards: [],
  selectedCardId: null,

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

  reorder: (id, newOrder) => set(s => ({
    cards: s.cards.map(c => c.id === id ? { ...c, order: newOrder } : c),
  })),

  clearSet: () => { _nextOrder = 0; set({ cards: [], selectedCardId: null }); },
}));
