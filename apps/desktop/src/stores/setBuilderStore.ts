import { create } from "zustand";
import { captureUndoState } from "./undoStore";

export interface SetCard {
  id: string;
  entryId: string;
  x: number;
  y: number;
  order: number;
  /** Manual start time on arrangement timeline (seconds). null = auto-overlap layout. */
  timelineStartSec: number | null;
}

export interface UserSet {
  id: string;
  name: string;
  cards: SetCard[];
  updatedAt: number;
}

export type SetViewMode = "nodes" | "arrangement" | "booth";

const STORAGE_KEY = "odeon-set-builder-v2";

interface PersistedState {
  version: 2;
  sets: UserSet[];
  activeSetId: string;
}

interface SetBuilderState {
  sets: UserSet[];
  activeSetId: string;
  selectedCardId: string | null;
  timelineSelectedCardId: string | null;
  viewMode: SetViewMode;
  selectedTransitionIndex: number | null;

  createSet: (name?: string) => string;
  deleteSet: (id: string) => void;
  selectActiveSet: (id: string) => void;
  setSetName: (name: string) => void;
  addCard: (entryId: string, setId?: string) => boolean;
  moveCard: (id: string, x: number, y: number) => void;
  removeCard: (id: string) => void;
  selectCard: (id: string | null) => void;
  selectTimelineCard: (id: string | null) => void;
  selectTransition: (index: number | null) => void;
  setViewMode: (mode: SetViewMode) => void;
  reorder: (id: string, newOrder: number) => void;
  connectAfter: (fromCardId: string, toCardId: string) => void;
  setTimelineStart: (id: string, startSec: number | null) => void;
  clearTimelinePositions: () => void;
  clearSet: () => void;
  isEntryInSet: (entryId: string, setId?: string) => boolean;
}

function createDefaultSet(name = "New Set"): UserSet {
  return {
    id: crypto.randomUUID(),
    name,
    cards: [],
    updatedAt: Date.now(),
  };
}

function nextSetName(sets: UserSet[]): string {
  const used = new Set(sets.map(s => s.name.toLowerCase()));
  if (!used.has("new set")) return "New Set";
  for (let i = 2; i < 1000; i++) {
    const candidate = `New Set ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `New Set ${Date.now()}`;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedState;
    if (data.version !== 2 || !Array.isArray(data.sets) || !data.sets.length) return null;
    return data;
  } catch {
    return null;
  }
}

function persist(state: Pick<SetBuilderState, "sets" | "activeSetId">) {
  try {
    const payload: PersistedState = {
      version: 2,
      sets: state.sets,
      activeSetId: state.activeSetId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore quota */ }
}

const persisted = loadPersisted();
const initialSets = persisted?.sets?.length ? persisted.sets : [createDefaultSet()];
const initialActiveId =
  persisted?.activeSetId && initialSets.some(s => s.id === persisted.activeSetId)
    ? persisted.activeSetId
    : initialSets[0].id;

export function getActiveUserSet(state: Pick<SetBuilderState, "sets" | "activeSetId">): UserSet {
  return state.sets.find(s => s.id === state.activeSetId) ?? state.sets[0];
}

function mapActiveSet(
  state: SetBuilderState,
  updater: (set: UserSet) => UserSet,
): Partial<SetBuilderState> {
  return {
    sets: state.sets.map(s => (s.id === state.activeSetId ? updater(s) : s)),
  };
}

export const useSetBuilderStore = create<SetBuilderState>((set, get) => ({
  sets: initialSets,
  activeSetId: initialActiveId,
  selectedCardId: null,
  timelineSelectedCardId: null,
  viewMode: "nodes",
  selectedTransitionIndex: null,

  createSet: (name) => {
    const next = createDefaultSet(name?.trim() || nextSetName(get().sets));
    set(s => {
      const sets = [...s.sets, next];
      persist({ sets, activeSetId: next.id });
      return {
        sets,
        activeSetId: next.id,
        selectedCardId: null,
        timelineSelectedCardId: null,
        selectedTransitionIndex: null,
      };
    });
    return next.id;
  },

  deleteSet: (id) => {
    const { sets, activeSetId } = get();
    if (sets.length <= 1) return;
    const nextSets = sets.filter(s => s.id !== id);
    const nextActive = activeSetId === id ? nextSets[0].id : activeSetId;
    set({
      sets: nextSets,
      activeSetId: nextActive,
      selectedCardId: null,
      timelineSelectedCardId: null,
      selectedTransitionIndex: null,
    });
    persist({ sets: nextSets, activeSetId: nextActive });
  },

  selectActiveSet: (id) => {
    if (!get().sets.some(s => s.id === id)) return;
    set({
      activeSetId: id,
      selectedCardId: null,
      timelineSelectedCardId: null,
      selectedTransitionIndex: null,
    });
    persist({ sets: get().sets, activeSetId: id });
  },

  setSetName: (name) => {
    const trimmed = name.trim() || "New Set";
    set(s => {
      const sets = s.sets.map(userSet =>
        userSet.id === s.activeSetId
          ? { ...userSet, name: trimmed, updatedAt: Date.now() }
          : userSet,
      );
      persist({ sets, activeSetId: s.activeSetId });
      return { sets };
    });
  },

  addCard: (entryId, setId) => {
    const targetId = setId ?? get().activeSetId;
    const target = get().sets.find(s => s.id === targetId);
    if (!target) return false;
    if (target.cards.some(c => c.entryId === entryId)) return false;

    if (targetId === get().activeSetId) captureUndoState();

    const existing = target.cards;
    const order = existing.length;
    const col = existing.length % 4;
    const row = Math.floor(existing.length / 4);
    const newCard: SetCard = {
      id: crypto.randomUUID(),
      entryId,
      x: 260 + col * 260,
      y: 80 + row * 360,
      order,
      timelineStartSec: null,
    };

    set(s => {
      const sets = s.sets.map(userSet =>
        userSet.id === targetId
          ? { ...userSet, cards: [...userSet.cards, newCard], updatedAt: Date.now() }
          : userSet,
      );
      persist({ sets, activeSetId: s.activeSetId });
      return { sets };
    });
    return true;
  },

  isEntryInSet: (entryId, setId) => {
    const target = get().sets.find(s => s.id === (setId ?? get().activeSetId));
    return !!target?.cards.some(c => c.entryId === entryId);
  },

  moveCard: (id, x, y) => set(s => ({
    ...mapActiveSet(s, userSet => ({
      ...userSet,
      cards: userSet.cards.map(c => (c.id === id ? { ...c, x, y } : c)),
      updatedAt: Date.now(),
    })),
  })),

  removeCard: (id) => {
    captureUndoState();
    set(s => {
      const active = getActiveUserSet(s);
      const sorted = [...active.cards].filter(c => c.id !== id).sort((a, b) => a.order - b.order);
      const cards = sorted.map((c, i) => ({ ...c, order: i }));
      const sets = s.sets.map(userSet =>
        userSet.id === s.activeSetId
          ? { ...userSet, cards, updatedAt: Date.now() }
          : userSet,
      );
      persist({ sets, activeSetId: s.activeSetId });
      return {
        sets,
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
    ...mapActiveSet(s, userSet => ({
      ...userSet,
      cards: userSet.cards.map(c => (c.id === id ? { ...c, order: newOrder } : c)),
      updatedAt: Date.now(),
    })),
  })),

  connectAfter: (fromCardId, toCardId) => set(s => {
    if (fromCardId === toCardId) return s;
    const active = getActiveUserSet(s);
    const sorted = [...active.cards].sort((a, b) => a.order - b.order);
    const toCard = sorted.find(c => c.id === toCardId);
    if (!toCard) return s;
    const without = sorted.filter(c => c.id !== toCardId);
    const fromIdx = without.findIndex(c => c.id === fromCardId);
    if (fromIdx < 0) return s;
    without.splice(fromIdx + 1, 0, toCard);
    const cards = active.cards.map(c => ({
      ...c,
      order: without.findIndex(x => x.id === c.id),
    }));
    const sets = s.sets.map(userSet =>
      userSet.id === s.activeSetId
        ? { ...userSet, cards, updatedAt: Date.now() }
        : userSet,
    );
    persist({ sets, activeSetId: s.activeSetId });
    return { ...s, sets };
  }),

  setTimelineStart: (id, startSec) => {
    captureUndoState();
    set(s => ({
      ...mapActiveSet(s, userSet => ({
        ...userSet,
        cards: userSet.cards.map(c => (c.id === id ? { ...c, timelineStartSec: startSec } : c)),
        updatedAt: Date.now(),
      })),
    }));
  },

  clearTimelinePositions: () => set(s => ({
    ...mapActiveSet(s, userSet => ({
      ...userSet,
      cards: userSet.cards.map(c => ({ ...c, timelineStartSec: null })),
      updatedAt: Date.now(),
    })),
  })),

  clearSet: () => {
    set(s => {
      const sets = s.sets.map(userSet =>
        userSet.id === s.activeSetId
          ? { ...userSet, cards: [], updatedAt: Date.now() }
          : userSet,
      );
      persist({ sets, activeSetId: s.activeSetId });
      return {
        sets,
        selectedCardId: null,
        timelineSelectedCardId: null,
        selectedTransitionIndex: null,
      };
    });
  },
}));
