/**
 * PlayerStrip — Mixxx-grade preview deck for Odeon Select.
 *
 * Hot cue system mirrors Mixxx CueControl:
 *   • 8 slots (indices 0-7), label field stores "1"-"8"
 *   • Click empty slot → set cue at currentTime
 *   • Click set slot → seek + play
 *   • Shift+click or right-click → delete
 *   • Keys 1-8 = set/jump, Shift+1-8 = delete
 *   • Hot cues appear as colored needles on both waveforms
 *
 * Waveform rendering: zero React re-renders during playback — all
 * animation runs in RAF inside WaveformRenderer via wall-clock interpolation.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSelectStore } from "../../stores/selectStore";
import type { WaveformMode } from "../../stores/selectStore";
import { useTransportStore } from "../../stores/transportStore";
import { apiClient } from "../../lib/apiClient";
import { loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import { resolveTrackDuration, snapToBeatGrid } from "../../lib/trackTime";
import { VisualPlayPosition } from "../../lib/visualPlayPosition";
import { subscribeWaveformFrame } from "../../lib/waveformSync";
import {
  SELECT_DECK_INDEX,
  useSelectEngineSync,
  volumeLinearToFaderDb,
} from "../../lib/useSelectEngineSync";
import { engineClient, unwrapEngineResult } from "../../lib/engineClient";
import { applyDeckMixBySlot, defaultDeckMix } from "../../lib/deckMixEngine";
import { OverviewWaveform, ZoomedWaveform, type WaveformHandle } from "./WaveformRenderer";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import type { CatalogMarker, CreateMarkerRequest } from "@odeon/shared";

// ─── Hot cue palette (Mixxx defaults) ────────────────────────────────────────

export const HOT_CUE_COLORS = [
  "#ff2244", // 1  red
  "#ff7700", // 2  orange
  "#ddcc00", // 3  yellow
  "#22bb44", // 4  green
  "#00aaff", // 5  sky-blue
  "#4455ff", // 6  blue
  "#aa44ff", // 7  purple
  "#ff44aa", // 8  pink
];

async function pushLoopToEngine(
  active: boolean,
  inSec: number | null,
  outSec: number | null,
) {
  if (inSec == null || outSec == null) return;
  try {
    await unwrapEngineResult(
      await engineClient.deckSetLoop(SELECT_DECK_INDEX, active, inSec, outSec),
    );
  } catch { /* ignore */ }
}

// ─── PlayerStrip ─────────────────────────────────────────────────────────────

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m  = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

export function PlayerStrip() {
  const { entries, selectedId, waveformMode, setWaveformMode } = useSelectStore();
  const transportPosition = useTransportStore(s => s.positionSeconds);
  const transportPlaying = useTransportStore(s => s.isPlaying);

  const entry = useMemo(
    () => (selectedId ? entries.find(e => e.id === selectedId) ?? null : null),
    [selectedId, entries],
  );

  const [cache,     setCache]   = useState<WaveformCache | null>(null);
  const [markers,   setMarkers] = useState<CatalogMarker[]>([]);
  const [volume,    setVolume]    = useState(0.8);
  const [trackMeta, setTrackMeta] = useState({
    title: "", artist: "", album: "", bpm: 0, key: "", lufs: 0, dur: 0, hasArt: false, id: "",
  });

  const { syncing, syncError, engineReady, canPlay, deckPlay, deckToggle, deckSeekTo } =
    useSelectEngineSync(entry, !!selectedId);
  const transportPlay = deckPlay;
  const transportToggle = deckToggle;
  const transportSeek = deckSeekTo;

  const visualPosRef = useRef(new VisualPlayPosition());
  const deckRateRef = useRef(1);

  // ── Loop state (mirrors Mixxx LoopingControl) ─────────────────────────────
  const [loopIn,  setLoopIn]  = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);
  const loopRef = useRef<{ in: number | null; out: number | null; active: boolean }>({ in: null, out: null, active: false });

  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const durDisplayRef  = useRef<HTMLSpanElement>(null);
  const overviewRef    = useRef<WaveformHandle>(null);
  const zoomedRef      = useRef<WaveformHandle>(null);
  const waveContainerRef = useRef<HTMLDivElement>(null);
  const trackDurationRef = useRef(0);
  const [waveW, setWaveW] = useState(900);

  const trackDurationSec = useMemo(
    () => resolveTrackDuration({
      cache,
      entryDuration: entry?.duration_seconds,
    }),
    [cache, entry?.duration_seconds],
  );
  trackDurationRef.current = trackDurationSec;

  const getLoopBounds = useCallback(() => {
    const { in: inSec, out: outSec, active } = loopRef.current;
    if (active && inSec != null && outSec != null) return { inSec, outSec };
    return null;
  }, []);

  /** Sync anchor once per engine tick / seek — renderers extrapolate at 60fps internally. */
  const syncWaveforms = useCallback((anchorSec?: number) => {
    const dur = trackDurationRef.current;
    const anchor = anchorSec ?? transportPosition;
    const wall = performance.now();
    const loop = getLoopBounds();
    visualPosRef.current.sync(anchor, transportPlaying, deckRateRef.current, loop);
    overviewRef.current?.sync(anchor, wall, dur, transportPlaying, deckRateRef.current);
    zoomedRef.current?.sync(anchor, wall, dur, transportPlaying, deckRateRef.current);
    if (timeDisplayRef.current) {
      const t = transportPlaying ? visualPosRef.current.interpolate(wall) : anchor;
      timeDisplayRef.current.textContent = fmt(t);
    }
  }, [transportPosition, transportPlaying, getLoopBounds]);

  useEffect(() => {
    if (!engineReady) return;
    syncWaveforms();
  }, [engineReady, transportPosition, transportPlaying, syncWaveforms]);

  useEffect(() => {
    if (!engineReady) return;
    syncWaveforms();
  }, [engineReady, loopIn, loopOut, loopActive, syncWaveforms]);

  // ── Load waveform + markers on entry change ─────────────────────────────────
  useEffect(() => {
    setCache(null);
    setMarkers([]);
    if (!entry) {
      setTrackMeta({ title: "", artist: "", album: "", bpm: 0, key: "", lufs: 0, dur: 0, hasArt: false, id: "" });
      return;
    }
    setTrackMeta({
      title:  entry.title  || entry.file_name.replace(/\.[^.]+$/, ""),
      artist: entry.artist || "Unknown Artist",
      album:  entry.album  || "",
      bpm:    entry.bpm    ?? 0,
      key:    entry.key    ?? "",
      lufs:   entry.integrated_lufs ?? 0,
      dur:    entry.duration_seconds ?? 0,
      hasArt: entry.has_artwork ?? false,
      id:     entry.id,
    });
    if (entry.status === "ready" && entry.file_path) {
      loadWaveformCache(entry.file_path, entry.waveform_cache_path, entry.id).then(c => setCache(c)).catch(() => {});
    }
    apiClient.select.listMarkers(entry.id).then(m => setMarkers(m)).catch(() => {});
  }, [entry?.id]);

  const getPlayheadForSet = useCallback((): number => {
    const pos = transportPlaying
      ? visualPosRef.current.interpolate()
      : transportPosition;
    return Math.round(pos * 1000) / 1000;
  }, [transportPlaying, transportPosition]);

  const quantizeTime = useCallback((raw: number): number => {
    return snapToBeatGrid(raw, entry?.beat_times);
  }, [entry?.beat_times]);

  // ── Waveform cache + playhead timing ────────────────────────────────────────
  useEffect(() => {
    if (!cache?.sample_rate || !cache.duration_seconds) return;
    const samples = Math.round(cache.duration_seconds * cache.sample_rate);
    visualPosRef.current.setTrackSamples(samples, cache.duration_seconds);
    visualPosRef.current.setTiming({ bufferMs: (512 / cache.sample_rate) * 1000 });
  }, [cache]);

  // ── 60fps time readout while playing (shared waveform RAF bus) ──────────────
  useEffect(() => {
    if (!entry || !transportPlaying) return;
    const unsub = subscribeWaveformFrame(() => {
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = fmt(visualPosRef.current.interpolate());
      }
    });
    return unsub;
  }, [entry?.id, transportPlaying]);
  useEffect(() => {
    if (!engineReady || !entry) return;
    for (const m of markers) {
      if (m.type !== "hot_cue" || !m.label) continue;
      const slot = parseInt(m.label, 10) - 1;
      if (slot < 0 || slot > 7) continue;
      void engineClient.deckSetHotcue(SELECT_DECK_INDEX, slot, m.time_seconds).catch(() => {});
    }
  }, [engineReady, entry?.id, markers]);

  useEffect(() => {
    if (durDisplayRef.current) durDisplayRef.current.textContent = fmt(trackDurationSec);
  }, [trackDurationSec]);

  useEffect(() => {
    if (!engineReady) return;
    const mix = { ...defaultDeckMix(), faderDb: volumeLinearToFaderDb(volume) };
    applyDeckMixBySlot(SELECT_DECK_INDEX, mix, 0.5);
  }, [volume, engineReady]);

  // ── Container width tracking ────────────────────────────────────────────────
  useEffect(() => {
    const node = waveContainerRef.current; if (!node) return;
    const obs = new ResizeObserver(([e]) => setWaveW(Math.floor(e.contentRect.width)));
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // ── Playback controls ───────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!entry || !canPlay) return;
    void transportToggle();
  }, [entry, canPlay, transportToggle]);

  const seek = useCallback((ratio: number) => {
    if (!canPlay) return;
    const dur = trackDurationRef.current;
    if (!dur) return;
    const t = ratio * dur;
    void transportSeek(t).then(() => syncWaveforms(t));
  }, [canPlay, transportSeek, syncWaveforms]);

  // ─── Loop control (mirrors Mixxx LoopingControl) ─────────────────────────────

  const setLoopInPoint = useCallback(() => {
    if (!canPlay) return;
    const t = quantizeTime(getPlayheadForSet());
    setLoopIn(t);
    loopRef.current.in = t;
  }, [getPlayheadForSet, quantizeTime]);

  const setLoopOutPoint = useCallback(() => {
    if (!canPlay) return;
    const t = quantizeTime(getPlayheadForSet());
    if (loopRef.current.in != null && t > loopRef.current.in) {
      setLoopOut(t);
      loopRef.current.out = t;
      setLoopActive(true);
      loopRef.current.active = true;
      void pushLoopToEngine(true, loopRef.current.in, t);
    }
  }, [canPlay, getPlayheadForSet, quantizeTime]);

  const toggleLoop = useCallback(() => {
    if (!canPlay) return;
    setLoopActive(prev => {
      const next = !prev;
      loopRef.current.active = next;
      void pushLoopToEngine(next, loopRef.current.in, loopRef.current.out);
      if (next && loopRef.current.in != null) {
        const pos = getPlayheadForSet();
        if (loopRef.current.out != null && (pos < loopRef.current.in || pos >= loopRef.current.out)) {
          void transportSeek(loopRef.current.in).then(() => syncWaveforms(loopRef.current.in!));
        }
      }
      return next;
    });
  }, [canPlay, getPlayheadForSet, transportSeek, syncWaveforms]);

  const clearLoop = useCallback(() => {
    setLoopIn(null); setLoopOut(null); setLoopActive(false);
    loopRef.current = { in: null, out: null, active: false };
    void engineClient.deckSetLoop(SELECT_DECK_INDEX, false, 0, 0).catch(() => {});
  }, []);

  const autoLoop = useCallback((bars: number) => {
    if (!canPlay) return;
    const bpm = entry?.bpm;
    if (!bpm) return;
    const secPerBar = (60 / bpm) * 4;
    const inPoint = quantizeTime(getPlayheadForSet());
    const dur = trackDurationRef.current;
    const span = secPerBar * bars;
    const outPoint = dur > 0 ? Math.min(dur, inPoint + span) : inPoint + span;
    setLoopIn(inPoint); setLoopOut(outPoint); setLoopActive(true);
    loopRef.current = { in: inPoint, out: outPoint, active: true };
    void pushLoopToEngine(true, inPoint, outPoint);
  }, [canPlay, entry?.bpm, getPlayheadForSet, quantizeTime]);

  // Reset loop when track changes
  useEffect(() => {
    setLoopIn(null); setLoopOut(null); setLoopActive(false);
    loopRef.current = { in: null, out: null, active: false };
    void engineClient.deckSetLoop(SELECT_DECK_INDEX, false, 0, 0).catch(() => {});
  }, [entry?.id]);

  // ─── Hot cue system (mirrors Mixxx CueControl) ───────────────────────────────

  /** Slot index 0-7 derived from label "1"-"8" on hot_cue markers. */
  const hotCueSlots = useMemo<(CatalogMarker | null)[]>(() => {
    const slots: (CatalogMarker | null)[] = new Array(8).fill(null);
    for (const m of markers) {
      if (m.type !== "hot_cue" || !m.label) continue;
      const idx = parseInt(m.label) - 1;
      if (idx >= 0 && idx < 8) slots[idx] = m;
    }
    return slots;
  }, [markers]);

  const setCue = useCallback(async (slot: number) => {
    if (!entry || !canPlay) return;
    const t = quantizeTime(getPlayheadForSet());
    const label = String(slot + 1);

    try {
      await unwrapEngineResult(
        await engineClient.deckSetHotcue(SELECT_DECK_INDEX, slot, t),
      );
    } catch { /* ignore */ }

    const optimisticId = `__optimistic_${slot}`;
    const optimistic: CatalogMarker = {
      id: optimisticId,
      entry_id: entry.id,
      type: "hot_cue",
      time_seconds: t,
      label,
      color: HOT_CUE_COLORS[slot],
      created_at: new Date().toISOString(),
    };
    let existingId: string | null = null;
    setMarkers(prev => {
      const existing = prev.find(m => m.type === "hot_cue" && m.label === label);
      existingId = existing?.id && !existing.id.startsWith("__optimistic_") ? existing.id : null;
      const filtered = prev.filter(m => !(m.type === "hot_cue" && m.label === label));
      return [...filtered, optimistic];
    });

    if (existingId) {
      await apiClient.select.deleteMarker(entry.id, existingId).catch(() => {});
    }
    const req: CreateMarkerRequest = {
      type: "hot_cue",
      time_seconds: t,
      label,
      color: HOT_CUE_COLORS[slot],
    };
    const created = await apiClient.select.createMarker(entry.id, req).catch(() => null);
    if (created) {
      setMarkers(prev => prev.map(m => m.id === optimisticId ? created : m));
    }
  }, [entry, canPlay, getPlayheadForSet, quantizeTime]);

  const jumpToCue = useCallback((slot: number) => {
    const cue = hotCueSlots[slot];
    if (!cue || !canPlay) return;
    void engineClient.deckJumpHotcue(SELECT_DECK_INDEX, slot)
      .then(res => unwrapEngineResult(res))
      .then(() => {
        useTransportStore.getState().setPosition(cue.time_seconds);
        if (!transportPlaying) void transportPlay();
        syncWaveforms(cue.time_seconds);
      })
      .catch(() => {});
  }, [hotCueSlots, canPlay, transportPlaying, transportPlay, syncWaveforms]);

  const deleteCue = useCallback(async (slot: number) => {
    const cue = hotCueSlots[slot];
    if (!cue || !entry) return;
    try {
      await unwrapEngineResult(
        await engineClient.deckClearHotcue(SELECT_DECK_INDEX, slot),
      );
    } catch { /* ignore */ }
    await apiClient.select.deleteMarker(entry.id, cue.id).catch(() => {});
    setMarkers(prev => prev.filter(m => m.id !== cue.id));
  }, [entry, hotCueSlots]);

  const handleCueButton = useCallback((slot: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (e.shiftKey || e.button === 2) { deleteCue(slot); return; }
    // Ctrl/Cmd+click on set slot = re-set at playhead (Mixxx hotcue_X_set)
    if ((e.metaKey || e.ctrlKey) && hotCueSlots[slot]) { void setCue(slot); return; }
    hotCueSlots[slot] ? jumpToCue(slot) : void setCue(slot);
  }, [hotCueSlots, jumpToCue, setCue, deleteCue]);

  // Keyboard shortcuts 1-8 (skip when focus is in an input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable) return;
      const slot = parseInt(e.key) - 1;
      if (slot < 0 || slot > 7) return;
      if (e.shiftKey) { deleteCue(slot); return; }
      hotCueSlots[slot] ? jumpToCue(slot) : setCue(slot);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotCueSlots, jumpToCue, setCue, deleteCue]);

  const { title, artist, album, bpm, key, lufs, dur, hasArt, id } = trackMeta;
  const isMinor = key.includes("min");

  return (
    <div style={{ background: "#0a0a0a", borderBottom: "1px solid #1c1c1c", flexShrink: 0 }}>

      {/* ── Top row: art | info | transport | meta | volume ──────────────────── */}
      <div style={{ display: "flex", alignItems: "stretch", height: 52 }}>

        {/* Album art */}
        <div style={{ width: 52, height: 52, flexShrink: 0, background: "#111", overflow: "hidden" }}>
          {hasArt && id ? (
            <img key={id} src={apiClient.select.artworkUrl(id)} alt=""
              style={{ width: 52, height: 52, objectFit: "cover", display: "block" }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", color: "#1e1e1e" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            </div>
          )}
        </div>

        {/* Track info */}
        <div style={{ width: 200, flexShrink: 0, padding: "6px 12px", display: "flex", flexDirection: "column", justifyContent: "center", borderLeft: "1px solid #1a1a1a" }}>
          <div style={{ color: "#e0e0e0", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>
            {title || "No track selected"}
          </div>
          <div style={{ color: "#555", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {artist}
          </div>
          {album && <div style={{ color: "#333", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{album}</div>}
        </div>

        {/* Play button */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", borderLeft: "1px solid #1a1a1a", gap: 6 }}>
          {(syncError || syncing) && (
            <span style={{ fontSize: 8, color: syncError ? "#f87171" : "#888", maxWidth: 140, lineHeight: 1.2 }}>
              {syncError ?? "Loading track…"}
            </span>
          )}
          <button onClick={togglePlay} disabled={!entry || !canPlay} style={{
            width: 34, height: 34, borderRadius: "50%",
            background: transportPlaying ? "rgba(74,222,128,0.12)" : "rgba(59,130,246,0.12)",
            border: `1.5px solid ${transportPlaying ? "#4ade80" : "#3b82f6"}`,
            color: transportPlaying ? "#4ade80" : "#60a5fa", fontSize: 12,
            cursor: entry && canPlay ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: entry && canPlay ? 1 : 0.4,
          }}>
            {transportPlaying ? "⏸" : "▶"}
          </button>
        </div>

        {/* Time display */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderLeft: "1px solid #1a1a1a", flexShrink: 0 }}>
          <span ref={timeDisplayRef} style={{ color: "#ccc", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>0:00</span>
          <span style={{ color: "#2a2a2a", fontSize: 9 }}>/</span>
          <span ref={durDisplayRef}  style={{ color: "#444", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{fmt(dur)}</span>
        </div>

        {/* BPM */}
        {bpm > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 12px", borderLeft: "1px solid #1a1a1a", flexShrink: 0 }}>
            <span style={{ color: "#f0f0f0", fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{bpm.toFixed(1)}</span>
            <span style={{ color: "#444", fontSize: 7, marginTop: 3, letterSpacing: "0.08em" }}>BPM</span>
          </div>
        )}

        {/* Key */}
        {key && (
          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", borderLeft: "1px solid #1a1a1a", flexShrink: 0 }}>
            <span style={{
              padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700,
              background: isMinor ? "rgba(59,130,246,0.12)" : "rgba(74,222,128,0.10)",
              color: isMinor ? "#60a5fa" : "#4ade80",
              border: `1px solid ${isMinor ? "rgba(59,130,246,0.35)" : "rgba(74,222,128,0.3)"}`,
            }}>{key}</span>
          </div>
        )}

        {/* LUFS */}
        {lufs !== 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 12px", borderLeft: "1px solid #1a1a1a", flexShrink: 0 }}>
            <span style={{ color: "#777", fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{lufs.toFixed(1)}</span>
            <span style={{ color: "#444", fontSize: 7, marginTop: 3, letterSpacing: "0.08em" }}>LUFS</span>
          </div>
        )}

        {/* Volume */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", marginLeft: "auto", borderLeft: "1px solid #1a1a1a" }}>
          <span style={{ color: "#2a2a2a", fontSize: 8, letterSpacing: "0.06em" }}>VOL</span>
          <input type="range" min={0} max={1} step={0.01} value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            style={{ width: 64, accentColor: "#3b82f6", cursor: "pointer" }} />
          <span style={{ color: "#333", fontSize: 8, width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(volume * 100)}%</span>
        </div>
      </div>

      {/* ── Hot cue buttons (Mixxx CueControl: 8 slots) ──────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 8px", borderTop: "1px solid #141414", background: "#080808" }}>
        {HOT_CUE_COLORS.map((color, i) => {
          const cue = hotCueSlots[i];
          return (
            <button
              key={i}
              onClick={e => handleCueButton(i, e)}
              onContextMenu={e => { e.preventDefault(); deleteCue(i); }}
              title={cue
                ? `Cue ${i + 1} at ${fmt(cue.time_seconds)} — click: jump+play | right-click or Shift+${i + 1}: delete`
                : `Set cue ${i + 1} here (key ${i + 1})`}
              style={{
                width: 46, height: 34, border: "none", borderRadius: 3, cursor: "pointer",
                background: cue ? `${color}18` : "#111",
                borderTop: `2.5px solid ${cue ? color : "#222"}`,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 1, padding: "2px 4px", flexShrink: 0,
                transition: "background .08s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = cue ? `${color}30` : "#181818")}
              onMouseLeave={e => (e.currentTarget.style.background = cue ? `${color}18` : "#111")}
            >
              <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, color: cue ? color : "#3a3a3a" }}>
                {i + 1}
              </span>
              {cue && (
                <span style={{ fontSize: 7, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: `${color}bb`, whiteSpace: "nowrap" }}>
                  {fmt(cue.time_seconds)}
                </span>
              )}
            </button>
          );
        })}

        <div style={{ width: 1, height: 26, background: "#1e1e1e", margin: "0 4px", flexShrink: 0 }} />

        {/* Loop controls — IN / OUT / toggle / auto-loop / clear */}
        <button
          onClick={setLoopInPoint}
          title="Set loop in point (like Mixxx 'Loop In')"
          style={{
            height: 34, padding: "0 8px", border: "none", borderRadius: 3,
            background: loopIn != null ? "rgba(251,146,60,0.12)" : "#111",
            borderTop: `2.5px solid ${loopIn != null ? "#fb923c" : "#222"}`,
            color: loopIn != null ? "#fb923c" : "#4a4a4a",
            fontSize: 8, fontWeight: 800, cursor: "pointer", letterSpacing: "0.05em", flexShrink: 0,
          }}
        >
          IN{loopIn != null ? <span style={{ display: "block", fontSize: 6 }}>{fmt(loopIn)}</span> : null}
        </button>
        <button
          onClick={setLoopOutPoint}
          title="Set loop out point (activates loop)"
          style={{
            height: 34, padding: "0 8px", border: "none", borderRadius: 3,
            background: loopOut != null ? "rgba(251,146,60,0.12)" : "#111",
            borderTop: `2.5px solid ${loopOut != null ? "#fb923c" : "#222"}`,
            color: loopOut != null ? "#fb923c" : "#4a4a4a",
            fontSize: 8, fontWeight: 800, cursor: "pointer", letterSpacing: "0.05em", flexShrink: 0,
          }}
        >
          OUT{loopOut != null ? <span style={{ display: "block", fontSize: 6 }}>{fmt(loopOut)}</span> : null}
        </button>
        <button
          onClick={toggleLoop}
          disabled={loopIn == null || loopOut == null}
          title={loopActive ? "Disable loop" : "Enable loop"}
          style={{
            height: 34, padding: "0 8px", border: "none", borderRadius: 3,
            background: loopActive ? "rgba(251,146,60,0.25)" : "#111",
            borderTop: `2.5px solid ${loopActive ? "#fb923c" : "#222"}`,
            color: loopActive ? "#fb923c" : "#3a3a3a",
            fontSize: 8, fontWeight: 800, cursor: "pointer", letterSpacing: "0.05em", flexShrink: 0,
            opacity: (loopIn == null || loopOut == null) ? 0.3 : 1,
          }}
        >
          LOOP
        </button>

        {/* Auto-loop buttons: 1/2 bar, 1 bar, 2 bar, 4 bar */}
        {entry?.bpm && [0.5, 1, 2, 4].map(bars => (
          <button
            key={bars}
            onClick={() => autoLoop(bars)}
            title={`Auto ${bars === 0.5 ? "½" : bars}-bar loop from BPM`}
            style={{
              height: 34, padding: "0 6px", border: "none", borderRadius: 3, background: "#111",
              borderTop: "2.5px solid #1e1e1e", color: "#3a3a3a",
              fontSize: 8, fontWeight: 800, cursor: "pointer", letterSpacing: "0.04em", flexShrink: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#fb923c"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#3a3a3a"; }}
          >
            {bars === 0.5 ? "½" : bars}
          </button>
        ))}

        {(loopIn != null || loopOut != null) && (
          <button
            onClick={clearLoop}
            title="Clear loop"
            style={{
              height: 34, padding: "0 6px", border: "none", borderRadius: 3, background: "#111",
              borderTop: "2.5px solid #1e1e1e", color: "#3a3a3a",
              fontSize: 8, fontWeight: 700, cursor: "pointer", flexShrink: 0,
            }}
          >
            ×
          </button>
        )}

        <div style={{ width: 1, height: 26, background: "#1e1e1e", margin: "0 4px", flexShrink: 0 }} />

        {/* Memory cue button (like Rekordbox memory points) */}
        <button
          onClick={async () => {
            if (!entry || !canPlay) return;
            const t = quantizeTime(getPlayheadForSet());
            const created = await apiClient.select.createMarker(entry.id, {
              type: "memory", time_seconds: t, label: "M", color: "#3b82f6",
            });
            setMarkers(prev => [...prev, created]);
          }}
          title="Set memory point here"
          style={{
            height: 34, padding: "0 10px", border: "none", borderRadius: 3,
            background: "#111", borderTop: "2.5px solid #3b82f6",
            color: "#3b82f6", fontSize: 9, fontWeight: 700, cursor: "pointer",
            letterSpacing: "0.06em",
          }}
        >
          MEM
        </button>

        {/* Auto-cue from beat grid */}
        <button
          onClick={async () => {
            if (!entry) return;
            try {
              const suggestions: Array<{ time_seconds: number; label: string; pct: number }> =
                await fetch(`http://localhost:8000/select/entries/${entry.id}/suggest-cues?count=8`).then(r => r.json());
              if (!Array.isArray(suggestions)) return;
              // Clear existing hot cues first
              for (const m of markers.filter(m => m.type === "hot_cue")) {
                await apiClient.select.deleteMarker(entry.id, m.id).catch(() => {});
              }
              const newMarkers: CatalogMarker[] = [];
              for (let i = 0; i < Math.min(suggestions.length, 8); i++) {
                const s = suggestions[i];
                const req: CreateMarkerRequest = {
                  type: "hot_cue", time_seconds: s.time_seconds,
                  label: String(i + 1), color: HOT_CUE_COLORS[i],
                };
                const created = await apiClient.select.createMarker(entry.id, req).catch(() => null);
                if (created) newMarkers.push(created);
              }
              setMarkers(prev => [...prev.filter(m => m.type !== "hot_cue"), ...newMarkers]);
            } catch { /* ignore */ }
          }}
          title="Auto-place cue points at phrase boundaries using beat grid analysis"
          style={{
            height: 34, padding: "0 10px", border: "none", borderRadius: 3,
            background: "#111", borderTop: "2.5px solid #1e1e1e",
            color: "#3a3a3a", fontSize: 8, fontWeight: 700, cursor: "pointer",
            letterSpacing: "0.05em", flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#00c3ff"; (e.currentTarget as HTMLElement).style.borderTopColor = "#00c3ff33"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#3a3a3a"; (e.currentTarget as HTMLElement).style.borderTopColor = "#1e1e1e"; }}
        >
          AUTO-CUE
        </button>

        {/* Waveform mode selector — matches Mixxx's waveform type selector */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ color: "#2a2a2a", fontSize: 8, marginRight: 4, letterSpacing: "0.06em" }}>WAVE</span>
          {(["rgb", "hsv", "simple"] as WaveformMode[]).map(m => (
            <button
              key={m}
              onClick={() => setWaveformMode(m)}
              title={{ rgb: "RGB — frequency-colored (Mixxx RGB)", hsv: "HSV — hue-shift mode (Mixxx HSV)", simple: "Simple — amplitude only (Mixxx Simple)" }[m]}
              style={{
                height: 22, padding: "0 7px", border: "none", borderRadius: 2,
                background: waveformMode === m ? "rgba(255,255,255,0.12)" : "transparent",
                color: waveformMode === m ? "#e0e0e0" : "#3a3a3a",
                fontSize: 8, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── Waveform rows ────────────────────────────────────────────────────── */}
      <div ref={waveContainerRef} style={{ lineHeight: 0, borderTop: "1px solid #111" }}>
        <OverviewWaveform
          ref={overviewRef} cache={cache} width={waveW} height={40}
          markers={markers} trackDurationSec={trackDurationSec}
          loopIn={loopIn} loopOut={loopOut} loopActive={loopActive}
          bg="#090909" mode={waveformMode} onSeek={seek}
        />
        <ZoomedWaveform
          ref={zoomedRef} cache={cache} width={waveW} height={72}
          markers={markers} trackDurationSec={trackDurationSec}
          loopIn={loopIn} loopOut={loopOut} loopActive={loopActive}
          beatTimes={entry?.beat_times}
          bg="#070707" mode={waveformMode} zoomSeconds={15} onSeek={seek}
        />
      </div>
    </div>
  );
}
