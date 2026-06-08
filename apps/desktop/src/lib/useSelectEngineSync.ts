/**
 * Loads the selected catalog track into odeon-engine deck 0 for Select preview.
 *
 * Rekordbox-style load model:
 *   • Session + deck route created once (warmed on library open)
 *   • Catalog-ready tracks are playable immediately — engine load runs in background
 *   • Hover prefetches audio + waveform before click
 *   • Track switch = hot-swap file on deck 0 — not cold graph rebuild
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useTransportStore } from "../stores/transportStore";
import { useEngineStore } from "../stores/engineStore";
import { applyDeckMixBySlot, defaultDeckMix } from "./deckMixEngine";
import { deckTrackId } from "./routeIds";
import { loadWaveformCache } from "./waveformEngine/cacheLoader";

export const SELECT_DECK_INDEX = 0;

export type SelectPlaybackMode = "full" | "vocals" | "drums" | "bass" | "other";

export type SelectStemPaths = {
  vocals?: string | null;
  drums?: string | null;
  bass?: string | null;
  other?: string | null;
};

interface LoadDeckResult {
  deckIndex: number;
  trackId: string;
  filePath: string;
  durationSeconds: number;
}

let selectSessionReady = false;
let selectSessionMixApplied = false;
let confirmedDeckPath: string | null = null;
let confirmedEntryId: string | null = null;
let loadSerial: Promise<void> = Promise.resolve();
let adoptGeneration = 0;
let currentPlaybackMode: SelectPlaybackMode = "full";
let cachedStemPaths: SelectStemPaths | null = null;
let cachedStemEntryId: string | null = null;
let selectStemLayersReady = false;
let selectStemLayersEntryId: string | null = null;

const entryLoadPromises = new Map<string, Promise<LoadDeckResult>>();

type SelectTransportBridge = {
  toggle: () => Promise<void>;
  canTransport: () => boolean;
};

let selectTransportBridge: SelectTransportBridge | null = null;

/** Global Space handler in Select — pause/resume preview deck without restarting. */
export async function toggleSelectPlayback(): Promise<void> {
  if (!selectTransportBridge?.canTransport()) return;
  await selectTransportBridge.toggle();
}

function setSelectTransportBridge(bridge: SelectTransportBridge | null): void {
  selectTransportBridge = bridge;
}

export function getSelectPlaybackMode(): SelectPlaybackMode {
  return currentPlaybackMode;
}

export function setSelectStemPaths(entryId: string, paths: SelectStemPaths): void {
  cachedStemEntryId = entryId;
  cachedStemPaths = paths;
}

export function areSelectStemLayersReady(entryId?: string): boolean {
  return selectStemLayersReady && (!entryId || selectStemLayersEntryId === entryId);
}

/** Warm DJ session once when the library opens — first click skips session setup. */
export async function warmSelectEngine(): Promise<void> {
  try {
    await runSerialized(async () => {
      await ensureSelectDjSession();
      await ensureSelectDeckMix();
    });
  } catch { /* engine may not be up yet */ }
}

/** Pre-load all stems on parallel engine routes — enables instant SRC switching. */
export async function preloadSelectStemLayers(
  entry: CatalogEntry,
  paths: SelectStemPaths,
): Promise<void> {
  const layers = (["vocals", "drums", "bass", "other"] as const)
    .filter((stem) => paths[stem])
    .map((stem) => ({
      layerId: stem,
      filePath: paths[stem]!,
      name: `${stem} — ${entry.title || entry.file_name}`,
    }));

  if (!layers.length) return;

  return runSerialized(async () => {
    await ensureSelectDjSession();
    await ensureSelectDeckMix();
    unwrapEngineResult(
      await engineClient.deckLoadStemLayers(SELECT_DECK_INDEX, layers),
    );
    selectStemLayersReady = true;
    selectStemLayersEntryId = entry.id;
    setSelectStemPaths(entry.id, paths);
  });
}

function resolvePlaybackPath(entry: CatalogEntry, mode: SelectPlaybackMode): string | null {
  if (mode === "full") return entry.file_path ?? null;
  if (cachedStemEntryId !== entry.id || !cachedStemPaths) return null;
  return cachedStemPaths[mode] ?? null;
}

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = loadSerial.then(fn, fn);
  loadSerial = next.then(
    () => {},
    () => {},
  );
  return next;
}

function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return false;
  }
}

function clearSelectDeckCache(): void {
  confirmedDeckPath = null;
  confirmedEntryId = null;
}

type DjStateSnapshot = {
  decks?: Array<{ loaded?: boolean; filePath?: string }>;
};

/** Ask the engine whether deck 0 actually has `filePath` loaded (TS cache can desync). */
async function engineHasDeckFile(filePath: string): Promise<boolean> {
  try {
    const state = unwrapEngineResult<DjStateSnapshot>(await engineClient.getDjState());
    const deck = state.decks?.[SELECT_DECK_INDEX];
    return !!deck?.loaded && pathsMatch(deck.filePath ?? "", filePath);
  } catch {
    return false;
  }
}

async function ensureSelectDjSession(): Promise<void> {
  if (selectSessionReady) return;
  await unwrapEngineResult(await engineClient.createDjSession(1));
  selectSessionReady = true;
  selectSessionMixApplied = false;
}

async function ensureSelectDeckMix(): Promise<void> {
  if (selectSessionMixApplied) return;
  useEngineStore.getState().initTrack(deckTrackId(SELECT_DECK_INDEX), 0, 0);
  void engineClient.setCrossfader(0.5);
  applyDeckMixBySlot(SELECT_DECK_INDEX, defaultDeckMix(), 0.5);
  selectSessionMixApplied = true;
}

async function loadSelectDeck(entry: CatalogEntry): Promise<LoadDeckResult> {
  if (!entry.file_path) throw new Error("Track has no file path on disk");
  const filePath = entry.file_path;

  return runSerialized(async () => {
    const wasPlaying = useTransportStore.getState().isPlaying;
    const sameEntry = confirmedEntryId === entry.id;
    const pinnedPos = sameEntry && !wasPlaying
      ? useTransportStore.getState().positionSeconds
      : 0;

    if (sameEntry && isSelectDeckLoaded(filePath)) {
      if (await engineHasDeckFile(filePath)) {
        return {
          deckIndex: SELECT_DECK_INDEX,
          trackId: deckTrackId(SELECT_DECK_INDEX),
          filePath,
          durationSeconds: 0,
        };
      }
      clearSelectDeckCache();
    }

    if (selectSessionReady && wasPlaying) {
      try {
        await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
      } catch { /* empty deck */ }
      useTransportStore.getState().setIsPlaying(false);
    }

    await ensureSelectDjSession();
    await ensureSelectDeckMix();

    const title = entry.title || entry.file_name;
    const loaded = unwrapEngineResult<LoadDeckResult>(
      await engineClient.loadDeck(SELECT_DECK_INDEX, filePath, title, 0),
    );

    if (!pathsMatch(loaded.filePath, filePath)) {
      throw new Error(`Engine loaded wrong file (expected ${filePath})`);
    }

    confirmedDeckPath = filePath;
    confirmedEntryId = entry.id;
    currentPlaybackMode = "full";

    if (selectStemLayersEntryId !== entry.id) {
      selectStemLayersReady = false;
      selectStemLayersEntryId = null;
    }

    if (pinnedPos > 0) {
      await unwrapEngineResult(await engineClient.deckSeek(SELECT_DECK_INDEX, pinnedPos));
      useTransportStore.getState().setPosition(pinnedPos);
    } else {
      useTransportStore.getState().setPosition(0);
    }
    useTransportStore.getState().setIsPlaying(false);
    return loaded;
  });
}

/** Deduped engine load — hover prefetch and click share the same promise. */
export async function ensureSelectEntryLoaded(entry: CatalogEntry): Promise<LoadDeckResult> {
  if (!entry.file_path) {
    throw new Error("Track has no file path on disk");
  }

  if (isSelectDeckLoaded(entry.file_path) && confirmedEntryId === entry.id) {
    if (await engineHasDeckFile(entry.file_path)) {
      return {
        deckIndex: SELECT_DECK_INDEX,
        trackId: deckTrackId(SELECT_DECK_INDEX),
        filePath: entry.file_path,
        durationSeconds: 0,
      };
    }
    clearSelectDeckCache();
  }

  const existing = entryLoadPromises.get(entry.id);
  if (existing) return existing;

  const promise = loadSelectDeck(entry).finally(() => {
    entryLoadPromises.delete(entry.id);
  });
  entryLoadPromises.set(entry.id, promise);
  return promise;
}

/** Instant layer switch when pre-loaded; falls back to file swap otherwise. */
export async function switchSelectPlaybackSource(
  entry: CatalogEntry,
  mode: SelectPlaybackMode,
  opts?: { position?: number; playing?: boolean; preserveTransport?: boolean },
): Promise<void> {
  const path = resolvePlaybackPath(entry, mode);
  if (!path) {
    throw new Error(mode === "full" ? "Track has no file path" : `${mode} stem not available`);
  }

  const layersReady = selectStemLayersReady && selectStemLayersEntryId === entry.id;
  if (layersReady) {
    const pinnedPos = opts?.position
      ?? (opts?.preserveTransport !== false ? useTransportStore.getState().positionSeconds : 0);
    confirmedDeckPath = path;
    currentPlaybackMode = mode;
    const result = unwrapEngineResult<{
      deckIndex: number;
      activeLayer: string;
      localPositionSeconds: number;
      isPlaying: boolean;
    }>(await engineClient.deckSetStemLayer(SELECT_DECK_INDEX, mode));
    if (Number.isFinite(result.localPositionSeconds)) {
      useTransportStore.getState().setPosition(result.localPositionSeconds);
    } else if (pinnedPos > 0) {
      useTransportStore.getState().setPosition(pinnedPos);
    }
    return;
  }

  const preserve = opts?.preserveTransport !== false;
  const wasPlaying = opts?.playing ?? (preserve && useTransportStore.getState().isPlaying);
  const position = opts?.position ?? (preserve ? useTransportStore.getState().positionSeconds : 0);
  const title = mode === "full"
    ? (entry.title || entry.file_name)
    : `${mode} — ${entry.title || entry.file_name}`;

  return runSerialized(async () => {
    await ensureSelectDjSession();
    await ensureSelectDeckMix();

    if (wasPlaying) {
      try {
        await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
      } catch { /* empty deck */ }
    }

    unwrapEngineResult<LoadDeckResult>(
      await engineClient.loadDeck(SELECT_DECK_INDEX, path, title, 0),
    );
    confirmedDeckPath = path;
    confirmedEntryId = entry.id;
    currentPlaybackMode = mode;

    if (preserve && position > 0) {
      await unwrapEngineResult(await engineClient.deckSeek(SELECT_DECK_INDEX, position));
      useTransportStore.getState().setPosition(position);
    } else if (!preserve) {
      useTransportStore.getState().setPosition(0);
    }

    if (wasPlaying) {
      await unwrapEngineResult(await engineClient.deckPlay(SELECT_DECK_INDEX));
      useTransportStore.getState().setIsPlaying(true);
    }
  });
}

/** Play a separated stem WAV on the Select preview deck (native engine). */
export async function playSelectStemFile(
  filePath: string,
  title: string,
  mode?: SelectPlaybackMode,
): Promise<void> {
  if (!filePath) throw new Error("Stem file path missing");
  if (mode && selectStemLayersReady && cachedStemEntryId && selectStemLayersEntryId === cachedStemEntryId) {
    confirmedDeckPath = filePath;
    currentPlaybackMode = mode;
    void engineClient.deckSetStemLayer(SELECT_DECK_INDEX, mode).then(() =>
      engineClient.deckPlay(SELECT_DECK_INDEX),
    ).catch(() => {});
    useTransportStore.getState().setIsPlaying(true);
    return;
  }

  return runSerialized(async () => {
    await ensureSelectDjSession();
    await ensureSelectDeckMix();
    try {
      await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
    } catch { /* empty deck */ }
    useTransportStore.getState().setIsPlaying(false);

    unwrapEngineResult<LoadDeckResult>(
      await engineClient.loadDeck(SELECT_DECK_INDEX, filePath, title, 0),
    );
    confirmedDeckPath = filePath;
    if (mode) currentPlaybackMode = mode;
    useTransportStore.getState().setPosition(0);
    await unwrapEngineResult(await engineClient.deckPlay(SELECT_DECK_INDEX));
    useTransportStore.getState().setIsPlaying(true);
  });
}

export async function pauseSelectStemPreview(): Promise<void> {
  try {
    await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
  } catch { /* ignore */ }
  useTransportStore.getState().setIsPlaying(false);
}

/** Warm waveform always; engine prefetch must not replace the selected preview deck. */
export function prefetchSelectDeck(
  entry: CatalogEntry,
  opts?: { engine?: boolean; activeEntryId?: string | null },
): void {
  if (entry.status !== "ready" || !entry.file_path) return;
  void loadWaveformCache(entry.file_path, entry.waveform_cache_path, entry.id).catch(() => {});

  const warmEngine = opts?.engine ?? false;
  if (!warmEngine) return;

  // Hovering other rows only warms waveform — never steal deck 0 from the paused selection.
  if (opts?.activeEntryId && opts.activeEntryId !== entry.id) return;

  if (isSelectDeckLoaded(entry.file_path) && confirmedEntryId === entry.id) return;
  void ensureSelectEntryLoaded(entry).catch(() => {});
}

export function resetSelectEngineSession(): void {
  adoptGeneration++;
  selectSessionReady = false;
  selectSessionMixApplied = false;
  confirmedDeckPath = null;
  confirmedEntryId = null;
  currentPlaybackMode = "full";
  cachedStemPaths = null;
  cachedStemEntryId = null;
  selectStemLayersReady = false;
  selectStemLayersEntryId = null;
  entryLoadPromises.clear();
  loadSerial = Promise.resolve();
}

export function isSelectDeckLoaded(filePath: string | null | undefined): boolean {
  return !!filePath && confirmedDeckPath != null && pathsMatch(confirmedDeckPath, filePath) && selectSessionReady;
}

export function useSelectEngineSync(entry: CatalogEntry | null, enabled: boolean) {
  const adoptGenRef = useRef(0);
  const readyEntryIdRef = useRef<string | null>(null);
  const entryRef = useRef<CatalogEntry | null>(null);
  entryRef.current = entry;

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [readyEntryId, setReadyEntryId] = useState<string | null>(null);

  const filePath = entry?.file_path ?? "";
  const entryId = entry?.id ?? "";

  const deckPlay = useCallback(async () => {
    const current = entryRef.current;
    if (!current?.file_path) return;

    await ensureSelectEntryLoaded(current);

    const wantPath = resolvePlaybackPath(current, currentPlaybackMode) ?? current.file_path;
    if (!(await engineHasDeckFile(wantPath))) {
      clearSelectDeckCache();
      entryLoadPromises.delete(current.id);
      if (currentPlaybackMode === "full" || !selectStemLayersReady) {
        await loadSelectDeck(current);
      } else {
        await switchSelectPlaybackSource(current, currentPlaybackMode, { preserveTransport: true });
      }
    }

    await unwrapEngineResult(await engineClient.deckPlay(SELECT_DECK_INDEX));
    useTransportStore.getState().setIsPlaying(true);
  }, []);

  const deckPause = useCallback(async () => {
    const result = unwrapEngineResult<{ deckIndex: number; localPositionSeconds: number }>(
      await engineClient.deckPause(SELECT_DECK_INDEX),
    );
    useTransportStore.getState().setIsPlaying(false);
    if (Number.isFinite(result.localPositionSeconds)) {
      useTransportStore.getState().setPosition(result.localPositionSeconds);
    }
  }, []);

  const deckToggle = useCallback(async () => {
    try {
      if (useTransportStore.getState().isPlaying) await deckPause();
      else await deckPlay();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncError(msg);
      useTransportStore.getState().setIsPlaying(false);
    }
  }, [deckPlay, deckPause]);

  const deckSeekTo = useCallback(async (localSeconds: number) => {
    await unwrapEngineResult(await engineClient.deckSeek(SELECT_DECK_INDEX, localSeconds));
    useTransportStore.getState().setPosition(localSeconds);
  }, []);

  useEffect(() => {
    if (enabled) return;

    adoptGenRef.current = ++adoptGeneration;
    resetSelectEngineSession();
    readyEntryIdRef.current = null;
    setReadyEntryId(null);
    setSyncing(false);
    setSyncError(null);
    setEngineReady(false);
    useTransportStore.getState().setEngineTracksReady(false);
    void engineClient.deckPause(SELECT_DECK_INDEX).catch(() => {});

    return () => {
      adoptGenRef.current = ++adoptGeneration;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      adoptGenRef.current = ++adoptGeneration;
      resetSelectEngineSession();
      readyEntryIdRef.current = null;
      setReadyEntryId(null);
      setSyncing(false);
      setSyncError(null);
      setEngineReady(false);
      useTransportStore.getState().setEngineTracksReady(false);
      return;
    }

    if (!entry || !filePath) {
      setEngineReady(false);
      setSyncing(false);
      return;
    }

    if (entry.status !== "ready") {
      setSyncing(false);
      setSyncError(`Track not ready (${entry.status}) — scan or refresh metadata`);
      setEngineReady(false);
      setReadyEntryId(null);
      useTransportStore.getState().setEngineTracksReady(false);
      return;
    }

    setSyncError(null);
    if (readyEntryIdRef.current !== entryId) {
      currentPlaybackMode = "full";
    }
    // Catalog-ready = playable now (Rekordbox). Engine catches up in background.
    setEngineReady(true);
    setReadyEntryId(entryId);
    readyEntryIdRef.current = entryId;
    useTransportStore.getState().setEngineTracksReady(true);

    const gen = adoptGenRef.current;

    void (async () => {
      const alreadyOnDeck = isSelectDeckLoaded(filePath)
        && confirmedEntryId === entryId
        && await engineHasDeckFile(filePath);
      if (gen !== adoptGenRef.current) return;
      if (alreadyOnDeck) {
        setSyncing(false);
        return;
      }

      setSyncing(true);
      try {
        await ensureSelectEntryLoaded(entry);
        if (gen !== adoptGenRef.current) return;
        setSyncing(false);
      } catch (e) {
        if (gen !== adoptGenRef.current) return;
        setSyncing(false);
        setEngineReady(false);
        setReadyEntryId(null);
        readyEntryIdRef.current = null;
        clearSelectDeckCache();
        useTransportStore.getState().setEngineTracksReady(false);
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(
          msg.includes("Engine not running") || msg.includes("Tauri not available")
            ? "Audio engine not running — launch Odeon desktop app"
            : msg,
        );
      }
    })();

    return () => {
      adoptGenRef.current = ++adoptGeneration;
    };
  }, [enabled, entryId, filePath, entry?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const canPlay = !!entry
    && entry.status === "ready"
    && !!filePath
    && engineReady
    && readyEntryId === entryId
    && !syncError;

  const canPlayRef = useRef(canPlay);
  canPlayRef.current = canPlay;

  useEffect(() => {
    if (!enabled) {
      setSelectTransportBridge(null);
      return;
    }
    setSelectTransportBridge({
      toggle: deckToggle,
      canTransport: () =>
        useTransportStore.getState().isPlaying || canPlayRef.current,
    });
    return () => setSelectTransportBridge(null);
  }, [enabled, deckToggle]);

  return {
    syncing,
    syncError,
    engineReady,
    canPlay,
    deckPlay,
    deckPause,
    deckToggle,
    deckSeekTo,
  };
}

/** Linear 0..1 → fader dB for deck channel mix. */
export function volumeLinearToFaderDb(linear: number): number {
  const v = Math.max(0.0001, Math.min(1, linear));
  return Math.max(-60, 20 * Math.log10(v));
}
