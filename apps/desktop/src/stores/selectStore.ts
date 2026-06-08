import { create } from "zustand";
import { apiClient, type StemSummaryEntry } from "../lib/apiClient";
import type { CatalogEntry, CatalogCollection, SelectStats } from "@odeon/shared";

const POLL_INTERVAL_MS = 2000;
const CATALOG_FOLDER_KEY = "odeon-catalog-folder";

function loadCatalogFolderPath(): string | null {
  try {
    return localStorage.getItem(CATALOG_FOLDER_KEY);
  } catch {
    return null;
  }
}

function saveCatalogFolderPath(path: string) {
  try {
    localStorage.setItem(CATALOG_FOLDER_KEY, path);
  } catch { /* ignore */ }
}

/** Best-guess catalog root from already-imported file paths. */
export function inferCatalogFolder(entries: CatalogEntry[]): string | null {
  if (!entries.length) return null;
  let prefix = entries[0].file_path;
  const slash = prefix.lastIndexOf("/");
  if (slash <= 0) return null;
  prefix = prefix.slice(0, slash);

  for (const entry of entries.slice(1)) {
    let p = entry.file_path;
    const s = p.lastIndexOf("/");
    if (s <= 0) return null;
    p = p.slice(0, s);
    while (!p.startsWith(prefix)) {
      const idx = prefix.lastIndexOf("/");
      if (idx <= 0) return null;
      prefix = prefix.slice(0, idx);
    }
  }
  return prefix || null;
}

export type WaveformMode = "rgb" | "hsv" | "simple";

const WAVEFORM_MODE_KEY = "odeon-waveform-mode";

function loadWaveformMode(): WaveformMode {
  try {
    const v = localStorage.getItem(WAVEFORM_MODE_KEY);
    if (v === "rgb" || v === "hsv" || v === "simple") return v;
  } catch { /* ignore */ }
  return "rgb";
}

interface SelectState {
  entries:            CatalogEntry[];
  collections:        CatalogCollection[];
  stats:              SelectStats | null;
  loading:            boolean;
  scanning:           boolean;
  selectedId:         string | null;
  filter:             string;
  isPolling:          boolean;
  waveformMode:       WaveformMode;
  catalogFolderPath:  string | null;
  stemsSummary:       Record<string, StemSummaryEntry>;

  loadEntries:      (opts?: { silent?: boolean }) => Promise<void>;
  loadStemsSummary: () => Promise<void>;
  loadCollections:  () => Promise<void>;
  loadStats:        () => Promise<void>;
  selectEntry:      (id: string | null) => void;
  setFilter:        (q: string) => void;
  setWaveformMode:  (mode: WaveformMode) => void;
  importFolder:     (folderPath: string, collectionName?: string) => Promise<number>;
  scanFolder:       () => Promise<number>;
  analyzeAll:       () => Promise<void>;
  ensurePolling:    () => void;
  updateEntryTags:  (entryId: string, tags: string[]) => void;
}

let _pollTimer: ReturnType<typeof setTimeout> | null = null;

function isActive(e: CatalogEntry) {
  return e.status === "pending" || e.status === "analyzing";
}

export const useSelectStore = create<SelectState>((set, get) => ({
  entries:            [],
  collections:        [],
  stats:              null,
  loading:            false,
  scanning:           false,
  selectedId:         null,
  filter:             "",
  isPolling:          false,
  waveformMode:       loadWaveformMode(),
  catalogFolderPath:  loadCatalogFolderPath(),
  stemsSummary:       {},

  loadStemsSummary: async () => {
    try {
      const { entries: summary } = await apiClient.select.stemsSummary();
      set({ stemsSummary: summary });
    } catch { /* ignore */ }
  },

  loadEntries: async (opts) => {
    const silent = opts?.silent ?? false;
    if (!silent) set({ loading: true });
    try {
      const entries = await apiClient.select.listEntries({ limit: 2000 });
      const state = get();
      const catalogFolderPath = state.catalogFolderPath ?? inferCatalogFolder(entries);
      if (catalogFolderPath && !state.catalogFolderPath) {
        saveCatalogFolderPath(catalogFolderPath);
      }
      set({ entries, catalogFolderPath, ...(silent ? {} : { loading: false }) });
      void get().loadStemsSummary();
    } catch (err) {
      console.error("Select loadEntries failed:", err);
    } finally {
      if (!silent) set({ loading: false });
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
  setWaveformMode: (mode) => {
    try { localStorage.setItem(WAVEFORM_MODE_KEY, mode); } catch { /* ignore */ }
    set({ waveformMode: mode });
  },

  importFolder: async (folderPath, collectionName) => {
    saveCatalogFolderPath(folderPath);
    set({ loading: true, catalogFolderPath: folderPath });
    const beforeIds = new Set(get().entries.map(e => e.id));
    try {
      await apiClient.select.importFolder({
        folder_path: folderPath,
        recursive: true,
        collection_name: collectionName,
      });
      await get().loadEntries();
      await get().loadStats();
      const added = get().entries.filter(e => !beforeIds.has(e.id)).length;
      if (added > 0) {
        await get().analyzeAll();
        get().ensurePolling();
      }
      return added;
    } finally {
      set({ loading: false });
    }
  },

  scanFolder: async () => {
    const folderPath = get().catalogFolderPath ?? inferCatalogFolder(get().entries);
    if (!folderPath) return 0;

    saveCatalogFolderPath(folderPath);
    set({ scanning: true, catalogFolderPath: folderPath });
    const beforeIds = new Set(get().entries.map(e => e.id));
    try {
      await apiClient.select.importFolder({
        folder_path: folderPath,
        recursive: true,
      });
      await get().loadEntries();
      await get().loadStats();
      const added = get().entries.filter(e => !beforeIds.has(e.id)).length;
      if (added > 0) {
        await get().analyzeAll();
        get().ensurePolling();
      }
      return added;
    } finally {
      set({ scanning: false });
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
      await get().loadStemsSummary();

      const hasActive = get().entries.some(isActive);
      if (hasActive) {
        await get().loadEntries({ silent: true });
        await get().loadStats();
      }

      const hasStemWork = Object.values(get().stemsSummary).some(
        (s) => s.job_status === "queued" || s.job_status === "running",
      );
      if (hasActive || hasStemWork) {
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
