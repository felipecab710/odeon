import { create } from "zustand";
import {
  DEFAULT_PLAYBACK_SETTINGS,
  bufferSizeMs,
  type PlaybackEngineSettings,
  type PlaybackEngineStatus,
} from "@odeon/shared";
import { engineClient } from "../lib/engineClient";
import { webAudioEngine } from "../lib/webAudioEngine";

const STORAGE_KEY = "odeon:playback-engine";

function loadLocalSettings(): PlaybackEngineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYBACK_SETTINGS };
    return { ...DEFAULT_PLAYBACK_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PLAYBACK_SETTINGS };
  }
}

function saveLocalSettings(settings: PlaybackEngineSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface PlaybackEngineState {
  isOpen: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  status: PlaybackEngineStatus | null;
  draft: PlaybackEngineSettings;

  open: () => void;
  close: () => void;
  refresh: () => Promise<void>;
  patchDraft: (patch: Partial<PlaybackEngineSettings>) => void;
  apply: () => Promise<void>;
}

export const usePlaybackEngineStore = create<PlaybackEngineState>((set, get) => ({
  isOpen: false,
  isLoading: false,
  isSaving: false,
  error: null,
  status: null,
  draft: loadLocalSettings(),

  open: () => {
    set({ isOpen: true, error: null });
    void get().refresh();
  },

  close: () => set({ isOpen: false, error: null }),

  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const status = (await engineClient.getPlaybackEngineSettings()) as PlaybackEngineStatus;
      const settings = status.settings ?? get().draft;
      set({ status, draft: settings, isLoading: false });
    } catch (e) {
      const local = loadLocalSettings();
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Engine unavailable",
        status: null,
        draft: local,
      });
    }
  },

  patchDraft: (patch) => {
    set((s) => ({ draft: { ...s.draft, ...patch } }));
  },

  apply: async () => {
    const { draft } = get();
    set({ isSaving: true, error: null });
    saveLocalSettings(draft);
    webAudioEngine.applyPlaybackSettings(draft);

    try {
      const status = (await engineClient.setPlaybackEngineSettings(
        draft as unknown as Record<string, unknown>
      )) as PlaybackEngineStatus;
      set({ status, draft: status.settings ?? draft, isSaving: false });
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Failed to apply settings";
      set({ isSaving: false, error: message });
    }
  },
}));

export function formatBufferLabel(samples: number, sampleRate: number): string {
  const ms = bufferSizeMs(samples, sampleRate);
  return `${samples} Samples (${ms.toFixed(2)} ms)`;
}
