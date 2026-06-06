import { create } from "zustand";
import { apiClient } from "../lib/apiClient";
import type { CatalogEntry, CatalogCollection, SelectStats } from "@odeon/shared";

const POLL_INTERVAL_MS = 2000;

export type WaveformMode = "rgb" | "hsv" | "simple";

interface SelectState {
  entries:      CatalogEntry[];
  collections:  CatalogCollection[];
  stats:        SelectStats | null;
  loading:      boolean;
  selectedId:   string | null;
  filter:       string;
  isPolling:    boolean;
  waveformMode: WaveformMode;

  loadEntries:      () => Promise<void>;
  loadCollections:  () => Promise<void>;
  loadStats:        () => Promise<void>;
  selectEntry:      (id: string | null) => void;
  setFilter:        (q: string) => void;
  setWaveformMode:  (mode: WaveformMode) => void;
  importFolder:     (folderPath: string, collectionName?: string) => Promise<void>;
  analyzeAll:       () => Promise<void>;
  ensurePolling:    () => void;
  updateEntryTags:  (entryId: string, tags: string[]) => void;
}

let _pollTimer: ReturnType<typeof setTimeout> | null = null;

function isActive(e: CatalogEntry) {
  return e.status === "pending" || e.status === "analyzing";
}

export const useSelectStore = create<SelectState>((set, get) => ({
  entries:      [],
  collections:  [],
  stats:        null,
  loading:      false,
  selectedId:   null,
  filter:       "",
  isPolling:    false,
  waveformMode: "rgb",

  loadEntries: async () => {
    set({ loading: true });
    try {
      const entries = await apiClient.select.listEntries();
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadCollections: async () => {
    const collections = await apiClient.select.listCollections();
    set({ collections });
  },

  loadStats: async () => {
    const stats = await apiClient.select.stats();
    set({ stats });
  },

  selectEntry:     (id)   => set({ selectedId: id }),
  setFilter:       (filter) => set({ filter }),
  setWaveformMode: (mode)  => set({ waveformMode: mode }),

  importFolder: async (folderPath, collectionName) => {
    set({ loading: true });
    try {
      await apiClient.select.importFolder({
        folder_path: folderPath,
        recursive: true,
        collection_name: collectionName,
      });
      await get().loadEntries();
      await get().loadStats();
    } finally {
      set({ loading: false });
    }
  },

  analyzeAll: async () => {
    await apiClient.select.analyzeAll();
    get().ensurePolling();
  },

  updateEntryTags: (entryId, tags) => set(state => ({
    entries: state.entries.map(e => e.id === entryId ? { ...e, tags } : e),
  })),

  ensurePolling: () => {
    if (_pollTimer !== null) return; // already running

    const tick = async () => {
      _pollTimer = null;
      await get().loadEntries();
      await get().loadStats();

      const hasActive = get().entries.some(isActive);
      if (hasActive) {
        set({ isPolling: true });
        _pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        set({ isPolling: false });
      }
    };

    _pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    set({ isPolling: true });
  },
}));
