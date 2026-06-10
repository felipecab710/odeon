/**
 * Transport store — tracks playback state and routes commands to the native engine.
 *
 * All transport, meter, and loop control goes through engineClient (native C++
 * odeon-engine sidecar). Web Audio is no longer used for playback.
 */
import { create } from "zustand";
import { engineClient } from "../lib/engineClient";
import { useEngineStore } from "./engineStore";
import { primeSetBuilderPlaybackIfNeeded } from "../lib/setBuilderPlayback";
import { useEditSelectionStore } from "./editSelectionStore";
import type { Timebase } from "../lib/timeFormat";

export type ABMode = "reference" | "my-mix" | "matched-preview";

interface TransportState {
  isPlaying: boolean;
  /** Playhead — updated from engine:transportState events */
  positionSeconds: number;
  /** Edit cursor — follows mouse on timeline, independent of playhead */
  cursorSeconds: number;
  /** Track under the edit cursor (for per-lane dB readout) */
  cursorTrackId: string | null;
  /** Main counter display format */
  mainTimebase: Timebase;
  showSubCounter: boolean;
  bpm: number;
  isLoopEnabled: boolean;
  clickTrackEnabled: boolean;
  abMode: ABMode;
  engineReady: boolean;
  /** True once engine emits tracksReady (clips loaded into Edit — can play) */
  engineTracksReady: boolean;

  // Actions
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seek: (timeSeconds: number) => Promise<void>;
  setIsPlaying: (v: boolean) => void;
  setPosition: (s: number) => void;
  setCursor: (s: number, trackId?: string | null) => void;
  setMainTimebase: (tb: Timebase) => void;
  toggleShowSubCounter: () => void;
  setBpm: (bpm: number) => void;
  setEngineReady: (v: boolean) => void;
  setEngineTracksReady: (v: boolean) => void;
  toggleLoop: () => void;
  toggleClickTrack: () => void;
  setAbMode: (m: ABMode) => void;
}

export const useTransportStore = create<TransportState>((set, get) => {
  // Subscribe to native engine position + playing state
  engineClient.onTransportState((data) => {
    set({
      positionSeconds: data.positionSeconds,
      isPlaying: data.isPlaying,
    });
  });

  // Subscribe to native engine meters → engineStore
  engineClient.onTrackMeters((data) => {
    useEngineStore.getState().updateMeters(data.meters as never);
  });

  // tracksReady event — enables the Play button
  engineClient.onTracksReady(() => {
    set({ engineTracksReady: true });
  });

  return {
    isPlaying: false,
    positionSeconds: 0,
    cursorSeconds: 0,
    cursorTrackId: null,
    mainTimebase: "bars-beats",
    showSubCounter: false,
    bpm: 120,
    isLoopEnabled: false,
    clickTrackEnabled: false,
    abMode: "reference",
    engineReady: false,
    engineTracksReady: false,

    setIsPlaying: (v) => set({ isPlaying: v }),
    setPosition: (s) => set({ positionSeconds: s }),
    setCursor: (s, trackId) => set({
      cursorSeconds: s,
      ...(trackId !== undefined ? { cursorTrackId: trackId } : {}),
    }),
    setMainTimebase: (tb) => set({ mainTimebase: tb }),
    toggleShowSubCounter: () => set((s) => ({ showSubCounter: !s.showSubCounter })),
    setBpm: (bpm) => {
      set({ bpm });
      void engineClient.setSessionTempo(bpm);
    },
    setEngineReady: (v) => set({ engineReady: v }),
    setEngineTracksReady: (v) => set({ engineTracksReady: v }),
    toggleLoop: () => {
      const { isLoopEnabled, positionSeconds } = get();
      const next = !isLoopEnabled;
      const sel = useEditSelectionStore.getState();
      const hasSelection = sel.endSeconds > sel.startSeconds + 0.01;
      const start = hasSelection ? sel.startSeconds : positionSeconds;
      const end = hasSelection ? sel.endSeconds : positionSeconds + 16;
      void engineClient.setLoop(next, start, end);
      set({ isLoopEnabled: next });
    },
    toggleClickTrack: () => {
      const next = !get().clickTrackEnabled;
      void engineClient.setClickTrack(next);
      set({ clickTrackEnabled: next });
    },
    setAbMode: (m) => set({ abMode: m }),

    play: async () => {
      const { isPlaying, positionSeconds } = get();
      if (isPlaying) return;
      primeSetBuilderPlaybackIfNeeded();
      const tryPlay = async () => {
        await engineClient.seek(positionSeconds);
        await engineClient.play();
      };
      try {
        await tryPlay();
        set({ isPlaying: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("Engine not running")) {
          console.error("[transport] play failed:", e);
          return;
        }
        try {
          await engineClient.restartEngine();
          await tryPlay();
          set({ isPlaying: true, engineReady: true });
        } catch (retryErr) {
          console.error("[transport] play failed after engine restart:", retryErr);
          set({ engineReady: false, engineTracksReady: false });
        }
      }
    },

    pause: async () => {
      await engineClient.pause();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false });
    },

    togglePlayPause: async () => {
      if (get().isPlaying) await get().pause();
      else await get().play();
    },

    stop: async () => {
      await engineClient.stop();
      useEngineStore.getState().resetLiveMeters();
      set({ isPlaying: false, positionSeconds: 0, cursorSeconds: 0, cursorTrackId: null });
    },

    seek: async (timeSeconds) => {
      set({ positionSeconds: timeSeconds });
      await engineClient.seek(timeSeconds);
    },
  };
});
