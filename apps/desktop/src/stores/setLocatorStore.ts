/**
 * Ableton-style arrangement locators — per-set song section markers.
 */
import { create } from "zustand";
import { captureUndoState, isRestoringUndo, isUndoGestureActive } from "./undoStore";
import { useSetBuilderStore } from "./setBuilderStore";

export interface SetLocator {
  id: string;
  timeSec: number;
  name: string;
  /** Optional key binding when in Key Map mode (e.g. "1", "q"). */
  keyBinding?: string;
}

const STORAGE_KEY = "odeon-set-locators-v1";

type LocatorMap = Record<string, SetLocator[]>;

function loadAll(): LocatorMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LocatorMap;
  } catch {
    return {};
  }
}

function persistAll(map: LocatorMap) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function activeSetId(): string {
  return useSetBuilderStore.getState().activeSetId;
}

function sortLocators(locators: SetLocator[]): SetLocator[] {
  return [...locators].sort((a, b) => a.timeSec - b.timeSec);
}

interface SetLocatorState {
  locators: SetLocator[];
  selectedId: string | null;
  keyMapMode: boolean;
  pendingKeyMapLocatorId: string | null;
  renamingId: string | null;
  loadForActiveSet: () => void;
  addLocator: (timeSec: number, name?: string) => string;
  updateLocator: (id: string, patch: Partial<Pick<SetLocator, "timeSec" | "name" | "keyBinding">>) => void;
  removeLocator: (id: string) => void;
  selectLocator: (id: string | null) => void;
  setKeyMapMode: (on: boolean) => void;
  requestKeyBinding: (locatorId: string) => void;
  setRenamingId: (id: string | null) => void;
  assignKeyBinding: (locatorId: string, key: string) => void;
  locatorForKey: (key: string) => SetLocator | undefined;
  adjacentLocator: (id: string | null, direction: -1 | 1) => SetLocator | null;
  replaceLocators: (locators: SetLocator[]) => void;
}

function writeSetLocators(setId: string, locators: SetLocator[]) {
  const all = loadAll();
  all[setId] = sortLocators(locators);
  persistAll(all);
}

export const useSetLocatorStore = create<SetLocatorState>((set, get) => ({
  locators: [],
  selectedId: null,
  keyMapMode: false,
  pendingKeyMapLocatorId: null,
  renamingId: null,

  loadForActiveSet: () => {
    const setId = activeSetId();
    const all = loadAll();
    set({ locators: sortLocators(all[setId] ?? []), selectedId: null, renamingId: null });
  },

  addLocator: (timeSec, name) => {
    if (!isRestoringUndo()) captureUndoState();
    const setId = activeSetId();
    const id = crypto.randomUUID();
    const count = get().locators.length + 1;
    const locator: SetLocator = {
      id,
      timeSec: Math.max(0, timeSec),
      name: name ?? `Locator ${count}`,
    };
    const next = sortLocators([...get().locators, locator]);
    writeSetLocators(setId, next);
    set({ locators: next, selectedId: id });
    return id;
  },

  updateLocator: (id, patch) => {
    if (!isRestoringUndo() && !isUndoGestureActive()) captureUndoState();
    const setId = activeSetId();
    const next = sortLocators(
      get().locators.map(l => l.id === id ? { ...l, ...patch } : l),
    );
    writeSetLocators(setId, next);
    set({ locators: next });
  },

  removeLocator: (id) => {
    if (!isRestoringUndo()) captureUndoState();
    const setId = activeSetId();
    const next = get().locators.filter(l => l.id !== id);
    writeSetLocators(setId, next);
    set({
      locators: next,
      selectedId: get().selectedId === id ? null : get().selectedId,
      renamingId: get().renamingId === id ? null : get().renamingId,
    });
  },

  selectLocator: (id) => set({ selectedId: id }),

  setKeyMapMode: (on) => set({
    keyMapMode: on,
    pendingKeyMapLocatorId: null,
    renamingId: null,
  }),

  requestKeyBinding: (locatorId) => set({
    keyMapMode: true,
    pendingKeyMapLocatorId: locatorId,
    selectedId: locatorId,
  }),

  setRenamingId: (id) => set({ renamingId: id }),

  assignKeyBinding: (locatorId, key) => {
    if (!isRestoringUndo()) captureUndoState();
    const setId = activeSetId();
    const next = get().locators.map(l => ({
      ...l,
      keyBinding: l.id === locatorId ? key : (l.keyBinding === key ? undefined : l.keyBinding),
    }));
    writeSetLocators(setId, next);
    set({ locators: next, keyMapMode: false, pendingKeyMapLocatorId: null });
  },

  locatorForKey: (key) => get().locators.find(l => l.keyBinding === key),

  adjacentLocator: (id, direction) => {
    const locs = get().locators;
    if (!locs.length) return null;
    if (!id) return direction === 1 ? locs[0] : locs[locs.length - 1];
    const idx = locs.findIndex(l => l.id === id);
    if (idx < 0) return direction === 1 ? locs[0] : locs[locs.length - 1];
    const next = idx + direction;
    if (next < 0 || next >= locs.length) return null;
    return locs[next];
  },

  replaceLocators: (locators) => {
    const setId = activeSetId();
    const sorted = sortLocators(locators);
    writeSetLocators(setId, sorted);
    set({ locators: sorted });
  },
}));
