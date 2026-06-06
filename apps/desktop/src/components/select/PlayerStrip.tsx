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
import { apiClient } from "../../lib/apiClient";
import { loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import { OverviewWaveform, ZoomedWaveform, type WaveformHandle } from "./WaveformRenderer";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import type { CatalogEntry, CatalogMarker, CreateMarkerRequest } from "@odeon/shared";

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

// ─── Audio singleton ──────────────────────────────────────────────────────────

let _audio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio();
    _audio.preload = "auto"; // Mixxx equivalent: CachingReader pre-buffers the full track
    _audio.crossOrigin = "anonymous";
  }
  return _audio;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m  = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

// ─── PlayerStrip ─────────────────────────────────────────────────────────────

export function PlayerStrip() {
  const { entries, selectedId, waveformMode, setWaveformMode } = useSelectStore();
  const [entry,     setEntry]   = useState<CatalogEntry | null>(null);
  const [cache,     setCache]   = useState<WaveformCache | null>(null);
  const [markers,   setMarkers] = useState<CatalogMarker[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume,    setVolume]    = useState(0.8);
  const [trackMeta, setTrackMeta] = useState({
    title: "", artist: "", album: "", bpm: 0, key: "", lufs: 0, dur: 0, hasArt: false, id: "",
  });

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
  const [waveW, setWaveW] = useState(900);

  // ── Entry sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setEntry(entries.find(e => e.id === selectedId) ?? null);
  }, [selectedId, entries]);

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
      loadWaveformCache(entry.file_path).then(c => setCache(c)).catch(() => {});
    }
    apiClient.select.listMarkers(entry.id).then(m => setMarkers(m)).catch(() => {});
  }, [entry?.id, entry?.status]);

  // ── Load audio ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!entry) return;
    const audio = getAudio();
    const url   = apiClient.select.previewUrl(entry.id);
    if (audio.src !== url) {
      audio.pause();
      audio.src    = url;
      audio.volume = volume;
      setIsPlaying(false);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00";
    }
  }, [entry?.id]);

  // ── Wire audio events (wall-clock sync for 60fps interpolation) ─────────────
  useEffect(() => {
    const audio = getAudio();

    const syncWaveforms = (playing: boolean) => {
      const wall = performance.now();
      const t    = audio.currentTime;
      const dur  = audio.duration || 0;
      overviewRef.current?.sync(t, wall, dur, playing, audio.playbackRate);
      zoomedRef.current?.sync(t,  wall, dur, playing, audio.playbackRate);
    };

    const onTime   = () => {
      // Loop enforcement — checked on every timeupdate (Mixxx does this per audio frame)
      const loop = loopRef.current;
      if (loop.active && loop.in != null && loop.out != null) {
        if (audio.currentTime >= loop.out) {
          if (typeof audio.fastSeek === "function") audio.fastSeek(loop.in);
          else audio.currentTime = loop.in;
        }
      }
      syncWaveforms(!audio.paused);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = fmt(audio.currentTime);
    };
    const onMeta   = () => { const d = audio.duration || 0; if (durDisplayRef.current) durDisplayRef.current.textContent = fmt(d); syncWaveforms(!audio.paused); };
    const onPlay   = () => { syncWaveforms(true);  setIsPlaying(true);  };
    const onPause  = () => { syncWaveforms(false); setIsPlaying(false); };
    const onSeeked = () => syncWaveforms(!audio.paused);
    const onEnded  = () => {
      setIsPlaying(false);
      const dur = audio.duration || 0;
      overviewRef.current?.sync(0, performance.now(), dur, false);
      zoomedRef.current?.sync(0,  performance.now(), dur, false);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00";
    };

    audio.addEventListener("timeupdate",     onTime);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play",           onPlay);
    audio.addEventListener("pause",          onPause);
    audio.addEventListener("seeked",         onSeeked);
    audio.addEventListener("ended",          onEnded);
    return () => {
      audio.removeEventListener("timeupdate",     onTime);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play",           onPlay);
      audio.removeEventListener("pause",          onPause);
      audio.removeEventListener("seeked",         onSeeked);
      audio.removeEventListener("ended",          onEnded);
    };
  }, []);

  useEffect(() => { getAudio().volume = volume; }, [volume]);

  // ── Container width tracking ────────────────────────────────────────────────
  useEffect(() => {
    const node = waveContainerRef.current; if (!node) return;
    const obs = new ResizeObserver(([e]) => setWaveW(Math.floor(e.contentRect.width)));
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // ── Playback controls ───────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = getAudio();
    if (!entry) return;
    isPlaying ? audio.pause() : audio.play().catch(() => {});
  }, [isPlaying, entry]);

  const seek = useCallback((ratio: number) => {
    const audio = getAudio();
    if (!audio.duration) return;
    const t = ratio * audio.duration;
    if (typeof audio.fastSeek === "function") audio.fastSeek(t);
    else audio.currentTime = t;
  }, []);

  // ─── Loop control (mirrors Mixxx LoopingControl) ─────────────────────────────

  const setLoopInPoint = useCallback(() => {
    const t = getAudio().currentTime;
    setLoopIn(t);
    loopRef.current.in = t;
  }, []);

  const setLoopOutPoint = useCallback(() => {
    const t = getAudio().currentTime;
    if (loopRef.current.in != null && t > loopRef.current.in) {
      setLoopOut(t);
      loopRef.current.out = t;
      // Activating loop out also enables the loop (Mixxx behavior)
      setLoopActive(true);
      loopRef.current.active = true;
    }
  }, []);

  const toggleLoop = useCallback(() => {
    setLoopActive(prev => {
      const next = !prev;
      loopRef.current.active = next;
      if (next && loopRef.current.in != null) {
        // Jump to loop start on re-enable
        const audio = getAudio();
        if (audio.currentTime < loopRef.current.in || (loopRef.current.out != null && audio.currentTime >= loopRef.current.out)) {
          if (typeof audio.fastSeek === "function") audio.fastSeek(loopRef.current.in);
          else audio.currentTime = loopRef.current.in;
        }
      }
      return next;
    });
  }, []);

  const clearLoop = useCallback(() => {
    setLoopIn(null); setLoopOut(null); setLoopActive(false);
    loopRef.current = { in: null, out: null, active: false };
  }, []);

  // Auto-loop: sets a loop of N bars based on BPM
  const autoLoop = useCallback((bars: number) => {
    const bpm = entry?.bpm;
    if (!bpm) return;
    const secPerBar = (60 / bpm) * 4; // 4/4 time
    const audio = getAudio();
    const inPoint = audio.currentTime;
    const outPoint = inPoint + secPerBar * bars;
    setLoopIn(inPoint); setLoopOut(outPoint); setLoopActive(true);
    loopRef.current = { in: inPoint, out: outPoint, active: true };
  }, [entry?.bpm]);

  // Reset loop when track changes
  useEffect(() => {
    setLoopIn(null); setLoopOut(null); setLoopActive(false);
    loopRef.current = { in: null, out: null, active: false };
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
    if (!entry) return;
    const audio = getAudio();
    const t = audio.currentTime;

    // Optimistic UI: show the cue immediately (Mixxx-style — visual is instant, persist follows)
    const optimisticId = `__optimistic_${slot}`;
    const optimistic: CatalogMarker = {
      id: optimisticId,
      entry_id: entry.id,
      type: "hot_cue",
      time_seconds: t,
      label: String(slot + 1),
      color: HOT_CUE_COLORS[slot],
      created_at: new Date().toISOString(),
    };
    setMarkers(prev => {
      const filtered = prev.filter(m => !(m.type === "hot_cue" && m.label === String(slot + 1)));
      return [...filtered, optimistic];
    });

    // Persist in background
    const existing = hotCueSlots[slot];
    if (existing && !existing.id.startsWith("__optimistic_")) {
      await apiClient.select.deleteMarker(entry.id, existing.id).catch(() => {});
    }
    const req: CreateMarkerRequest = {
      type: "hot_cue",
      time_seconds: t,
      label: String(slot + 1),
      color: HOT_CUE_COLORS[slot],
    };
    const created = await apiClient.select.createMarker(entry.id, req).catch(() => null);
    if (created) {
      // Replace optimistic marker with real one
      setMarkers(prev => prev.map(m => m.id === optimisticId ? created : m));
    }
  }, [entry, hotCueSlots]);

  const jumpToCue = useCallback((slot: number) => {
    const cue = hotCueSlots[slot];
    if (!cue) return;
    const audio = getAudio();
    // fastSeek() — seeks to nearest I-frame, lowest possible latency (like Mixxx's EngineBuffer seek)
    // Falls back to currentTime for browsers that don't support it
    if (typeof audio.fastSeek === "function") {
      audio.fastSeek(cue.time_seconds);
    } else {
      audio.currentTime = cue.time_seconds;
    }
    if (audio.paused) audio.play().catch(() => {});
  }, [hotCueSlots]);

  const deleteCue = useCallback(async (slot: number) => {
    const cue = hotCueSlots[slot];
    if (!cue || !entry) return;
    await apiClient.select.deleteMarker(entry.id, cue.id).catch(() => {});
    setMarkers(prev => prev.filter(m => m.id !== cue.id));
  }, [entry, hotCueSlots]);

  const handleCueButton = useCallback((slot: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (e.shiftKey || e.button === 2) { deleteCue(slot); return; }
    hotCueSlots[slot] ? jumpToCue(slot) : setCue(slot);
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
          <button onClick={togglePlay} disabled={!entry} style={{
            width: 34, height: 34, borderRadius: "50%",
            background: isPlaying ? "rgba(74,222,128,0.12)" : "rgba(59,130,246,0.12)",
            border: `1.5px solid ${isPlaying ? "#4ade80" : "#3b82f6"}`,
            color: isPlaying ? "#4ade80" : "#60a5fa", fontSize: 12,
            cursor: entry ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isPlaying ? "⏸" : "▶"}
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
            if (!entry) return;
            const t = getAudio().currentTime;
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
          markers={markers} bg="#090909" mode={waveformMode} onSeek={seek}
        />
        <ZoomedWaveform
          ref={zoomedRef} cache={cache} width={waveW} height={72}
          markers={markers} beatTimes={entry?.beat_times}
          bg="#070707" mode={waveformMode} zoomSeconds={15} onSeek={seek}
        />
      </div>
    </div>
  );
}
