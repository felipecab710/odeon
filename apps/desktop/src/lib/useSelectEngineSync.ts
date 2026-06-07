/**
 * Loads the selected catalog track into odeon-engine deck 0 for Select preview.
 *
 * Rekordbox-style load model:
 *   • Session + deck route created once
 *   • Track switch = hot-swap file on deck 0 (engine) — not cold graph rebuild
 *   • Play enabled as soon as loadDeck returns — waveform/markers load async in UI
 *   • Metadata (BPM/key/wavecache) comes from catalog DB, not from load path
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useTransportStore } from "../stores/transportStore";
import { useEngineStore } from "../stores/engineStore";
import { applyDeckMixBySlot, deckTrackId, defaultDeckMix } from "./deckMixEngine";
import { loadWaveformCache } from "./waveformEngine/cacheLoader";

export const SELECT_DECK_INDEX = 0;

interface LoadDeckResult {
  deckIndex: number;
  trackId: string;
  filePath: string;
  durationSeconds: number;
}

let selectSessionReady = false;
let selectSessionMixApplied = false;
let confirmedDeckPath: string | null = null;
let loadSerial: Promise<void> = Promise.resolve();
let loadToken = 0;

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = loadSerial.then(fn, fn);
  loadSerial = next.then(
    () => {},
    () => {},
  );
  return next;
}

function entryKeyFor(entry: CatalogEntry): string {
  return `${entry.id}:${entry.file_path ?? ""}:${entry.status}`;
}

function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
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

async function loadSelectDeck(entry: CatalogEntry, token: number): Promise<LoadDeckResult> {
  if (!entry.file_path) throw new Error("Track has no file path on disk");
  const filePath = entry.file_path;

  return runSerialized(async () => {
    if (token !== loadToken) throw new Error("Load cancelled");

    const wasPlaying = useTransportStore.getState().isPlaying;
    if (selectSessionReady && wasPlaying) {
      try {
        await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
      } catch { /* empty deck */ }
      useTransportStore.getState().setIsPlaying(false);
    }
    if (token !== loadToken) throw new Error("Load cancelled");

    await ensureSelectDjSession();
    if (token !== loadToken) throw new Error("Load cancelled");

    await ensureSelectDeckMix();
    if (token !== loadToken) throw new Error("Load cancelled");

    const title = entry.title || entry.file_name;
    const loaded = unwrapEngineResult<LoadDeckResult>(
      await engineClient.loadDeck(SELECT_DECK_INDEX, filePath, title, 0),
    );
    if (token !== loadToken) throw new Error("Load cancelled");

    if (!pathsMatch(loaded.filePath, filePath)) {
      throw new Error(`Engine loaded wrong file (expected ${filePath})`);
    }

    confirmedDeckPath = filePath;
    useTransportStore.getState().setPosition(0);
    useTransportStore.getState().setIsPlaying(false);
    return loaded;
  });
}

/** Warm waveform sidecar on row hover — never touches audio engine. */
export function prefetchSelectDeck(entry: CatalogEntry): void {
  if (entry.status !== "ready" || !entry.file_path) return;
  void loadWaveformCache(entry.file_path, entry.waveform_cache_path, entry.id).catch(() => {});
}

export function resetSelectEngineSession(): void {
  loadToken++;
  selectSessionReady = false;
  selectSessionMixApplied = false;
  confirmedDeckPath = null;
  loadSerial = Promise.resolve();
}

export function isSelectDeckLoaded(filePath: string | null | undefined): boolean {
  return !!filePath && confirmedDeckPath != null && pathsMatch(confirmedDeckPath, filePath) && selectSessionReady;
}

export function useSelectEngineSync(entry: CatalogEntry | null, enabled: boolean) {
  const syncGen = useRef(0);
  const readyKeyRef = useRef("");
  const entryRef = useRef<CatalogEntry | null>(null);
  entryRef.current = entry;

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [readyKey, setReadyKey] = useState("");

  const filePath = entry?.file_path ?? "";
  const entryKey = entry ? entryKeyFor(entry) : "";

  const deckPlay = useCallback(async () => {
    const current = entryRef.current;
    if (!current?.file_path) return;

    if (!isSelectDeckLoaded(current.file_path)) {
      const token = loadToken;
      await loadSelectDeck(current, token);
      if (token !== loadToken) return;
    }

    await unwrapEngineResult(await engineClient.deckPlay(SELECT_DECK_INDEX));
    useTransportStore.getState().setIsPlaying(true);
  }, []);

  const deckPause = useCallback(async () => {
    await unwrapEngineResult(await engineClient.deckPause(SELECT_DECK_INDEX));
    useTransportStore.getState().setIsPlaying(false);
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

    syncGen.current++;
    resetSelectEngineSession();
    readyKeyRef.current = "";
    setReadyKey("");
    setSyncing(false);
    setSyncError(null);
    setEngineReady(false);
    useTransportStore.getState().setEngineTracksReady(false);
    void engineClient.deckPause(SELECT_DECK_INDEX).catch(() => {});

    return () => {
      syncGen.current++;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      syncGen.current++;
      resetSelectEngineSession();
      readyKeyRef.current = "";
      setReadyKey("");
      setSyncing(false);
      setSyncError(null);
      setEngineReady(false);
      useTransportStore.getState().setEngineTracksReady(false);
      return;
    }

    if (!entry || !filePath) {
      setEngineReady(false);
      setSyncing(true);
      return;
    }

    if (entry.status !== "ready") {
      setSyncing(false);
      setSyncError(`Track not ready (${entry.status}) — scan or refresh metadata`);
      setEngineReady(false);
      setReadyKey("");
      useTransportStore.getState().setEngineTracksReady(false);
      return;
    }

    // Already on this track — instant (Rekordbox: deck already has file).
    if (readyKeyRef.current === entryKey && isSelectDeckLoaded(filePath)) {
      setEngineReady(true);
      setSyncing(false);
      setSyncError(null);
      setReadyKey(entryKey);
      useTransportStore.getState().setEngineTracksReady(true);
      return;
    }

    const gen = ++syncGen.current;
    const token = ++loadToken;

    setEngineReady(false);
    setReadyKey("");
    setSyncError(null);
    setSyncing(true);
    useTransportStore.getState().setEngineTracksReady(false);
    useTransportStore.getState().setIsPlaying(false);

    const adoptLoaded = () => {
      readyKeyRef.current = entryKey;
      setReadyKey(entryKey);
      useTransportStore.getState().setEngineTracksReady(true);
      setEngineReady(true);
      setSyncError(null);
      setSyncing(false);
    };

    void loadSelectDeck(entry, token)
      .then(() => {
        if (gen !== syncGen.current || token !== loadToken) return;
        adoptLoaded();
      })
      .catch(e => {
        if (gen !== syncGen.current || token !== loadToken) return;
        if (e instanceof Error && e.message === "Load cancelled") return;

        setEngineReady(false);
        setReadyKey("");
        confirmedDeckPath = null;
        useTransportStore.getState().setEngineTracksReady(false);
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(
          msg.includes("Engine not running") || msg.includes("Tauri not available")
            ? "Audio engine not running — launch Odeon desktop app"
            : msg,
        );
      })
      .finally(() => {
        if (gen === syncGen.current) setSyncing(false);
      });

    return () => {
      syncGen.current++;
    };
  }, [enabled, entryKey, filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const canPlay = engineReady && readyKey === entryKey && !syncing && !syncError;

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
