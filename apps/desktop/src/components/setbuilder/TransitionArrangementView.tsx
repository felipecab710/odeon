/**
 * Studio-style set arrangement — full timeline, stacked overlapping lanes,
 * automation curves on waveforms, per-deck EQ strips. Like DJ.Studio for set building.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry, CatalogMarker } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import {
  apiClient,
  type FlowEdge,
  type TransitionPlanData,
} from "../../lib/apiClient";
import { resolveTrackDuration } from "../../lib/trackTime";
import {
  type DeckMix,
  defaultDeckMix,
} from "../../lib/deckMixEngine";
import { useSetEngineSync } from "../../lib/useSetEngineSync";
import { pushSetEngineMixes } from "../../lib/boothSimulation";
import { useTransportStore } from "../../stores/transportStore";
import { useBoothStore } from "../../stores/boothStore";
import { useSetBuilderStore } from "../../stores/setBuilderStore";
import { useStudioDeckStore } from "../../stores/studioDeckStore";
import { captureUndoState } from "../../stores/undoStore";
import { StaticWaveform, type WaveformMode } from "../select/WaveformRenderer";
import { useSelectStore } from "../../stores/selectStore";
import { DJMLaneStrip } from "./DJMLaneStrip";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import {
  LANE_STRIP_W, LANE_HEIGHT, RULER_H, MINIMAP_H,
  DEFAULT_PX_PER_SEC, MIN_PX_PER_SEC, MAX_PX_PER_SEC,
  HEADER_H,
  STUDIO_BG, STUDIO_BG_DEEP, STUDIO_SIDEBAR, STUDIO_RULER, STUDIO_GRID,
  computeSetLayout, formatTimeline, snapToBeat, rulerMarkInterval, clampPxPerSec,
  type LaneLayout,
} from "./setTimelineLayout";
import { SetAutomationPanel } from "./SetAutomationPanel";
import { TrackAutomationLane } from "./TrackAutomationLane";
import { AutomationLaneControls } from "./AutomationLaneControls";
import { useAutomationRecorder } from "../../hooks/useAutomationRecorder";
import {
  useStudioAutomationStore,
  trackAutomationHeight,
} from "../../stores/studioAutomationStore";
import {
  useStudioLaneStore,
  computeLaneLayout,
  MIN_LANE_TOTAL_H,
  MAX_LANE_TOTAL_H,
  MIN_WAVE_H,
} from "../../stores/studioLaneStore";
import { beginVerticalResizeDown } from "../../lib/domResize";
import { AutomationWaveSplitter } from "./AutomationWaveSplitter";

const ZOOM_STORAGE_KEY = "odeon-timeline-px-per-sec";
const ZOOM_STEP = 1.28;

function readStoredZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    return Number.isFinite(v) ? clampPxPerSec(v) : DEFAULT_PX_PER_SEC;
  } catch {
    return DEFAULT_PX_PER_SEC;
  }
}

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
  transitionIndex: number;
  onSelectTransition: (index: number) => void;
  boothVisible?: boolean;
  onToggleBooth?: () => void;
}

const CAMELOT: Record<string, string> = {
  "C maj":"8B","C min":"5A","C# maj":"3B","C# min":"12A",
  "D maj":"10B","D min":"7A","D# maj":"5B","D# min":"2A",
  "E maj":"12B","E min":"9A","F maj":"7B","F min":"4A",
  "F# maj":"2B","F# min":"11A","G maj":"9B","G min":"6A",
  "G# maj":"4B","G# min":"1A","A maj":"11B","A min":"8A",
  "A# maj":"6B","A# min":"3A","B maj":"1B","B min":"10A",
};

// DJ.Studio deck accent colors
const LANE_COLORS = ["#c8e650", "#b39ddb", "#4fc3f7", "#ffab40", "#f48fb1", "#fff176"];
function camelot(k?: string | null) { return k ? CAMELOT[k] ?? k : "—"; }
function trackTitle(e: CatalogEntry) {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

/** Same renderer as Select — finest pyramid level, HiDPI, 1.5× gain. */
function ArrangementWaveform({ cache, width, height, mode, markers, durationSec }: {
  cache: WaveformCache | null;
  width: number;
  height: number;
  mode: WaveformMode;
  markers?: CatalogMarker[];
  durationSec?: number;
}) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (!cache) {
    return (
      <div style={{
        width: w, height: h, background: "#141820",
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 3px)",
      }} />
    );
  }
  return (
    <StaticWaveform
      cache={cache}
      width={w}
      height={h}
      bg="#141820"
      mode={mode}
      markers={markers}
      durationSec={durationSec}
    />
  );
}

// ─── Single track block on timeline ───────────────────────────────────────────

function TrackBlock({ lane, laneIndex, laneY, laneHeight, automationHeight, waveHeight,
  onSplitResize, color, mix, onMixChange, cache, markers, waveformMode, isSelected, isCardSelected, isDragging,
  overrideStartSec, pxPerSec, playheadSec, onDragStart,
}: {
  lane: LaneLayout;
  laneIndex: number;
  laneY: number;
  laneHeight: number;
  automationHeight: number;
  waveHeight: number;
  onSplitResize: (laneIndex: number, e: React.MouseEvent) => void;
  color: string;
  mix: DeckMix;
  onMixChange: (mix: DeckMix) => void;
  cache: WaveformCache | null;
  markers?: CatalogMarker[];
  waveformMode: WaveformMode;
  isSelected: boolean;
  isCardSelected: boolean;
  isDragging: boolean;
  overrideStartSec?: number | null;
  pxPerSec: number;
  playheadSec: number;
  onDragStart: (e: React.MouseEvent) => void;
}) {
  const leftPx = overrideStartSec != null ? overrideStartSec * pxPerSec : lane.leftPx;
  const startSec = overrideStartSec ?? lane.startSec;
  const w = Math.max(lane.widthPx, 80);
  const playheadLocalPx = playheadSec >= lane.startSec && playheadSec < lane.endSec
    ? ((playheadSec - lane.startSec) / Math.max(lane.durationSec, 0.001)) * w
    : null;

  return (
    <div
      onMouseDown={onDragStart}
      style={{
        position: "absolute",
        left: leftPx,
        top: laneY,
        width: w,
        height: laneHeight,
        display: "flex",
        flexDirection: "column",
        opacity: mix.mute ? 0.4 : 1,
        zIndex: isDragging ? 25 : isCardSelected ? 15 : 10,
        cursor: isDragging ? "grabbing" : "grab",
        boxShadow: isCardSelected
          ? `0 0 0 2px ${color}, 0 4px 16px rgba(0,0,0,0.5)`
          : isSelected ? `0 0 0 1px ${color}88` : "none",
        borderRadius: 2,
      }}
    >
      {/* Colored header bar — DJ.Studio style */}
      <div style={{
        height: HEADER_H,
        display: "flex", alignItems: "center", gap: 5,
        padding: "0 6px",
        background: color,
        borderRadius: "2px 2px 0 0",
        boxShadow: isSelected ? `0 0 0 1px ${color}` : "none",
      }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: "#1a1a1a",
          background: "rgba(0,0,0,0.15)", padding: "0 4px", borderRadius: 2,
        }}>
          {camelot(lane.entry.key)}
        </span>
        <span style={{
          fontSize: 9, color: "#1a1a1a", fontWeight: 600,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
        }}>
          {trackTitle(lane.entry)}
        </span>
      </div>

      <div style={{
        height: waveHeight,
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
        borderLeft: `1px solid ${STUDIO_GRID}`,
        borderRight: `1px solid ${STUDIO_GRID}`,
        borderBottom: automationHeight > 0 ? "none" : `1px solid ${STUDIO_GRID}`,
        borderRadius: automationHeight > 0 ? 0 : "0 0 2px 2px",
      }}>
        <ArrangementWaveform
          cache={cache}
          width={Math.floor(w)}
          height={Math.floor(waveHeight)}
          mode={waveformMode}
          markers={markers}
          durationSec={resolveTrackDuration({
            cache,
            entryDuration: lane.entry.duration_seconds,
          })}
        />
        {playheadLocalPx != null && (
          <div style={{
            position: "absolute", left: playheadLocalPx, top: 0, bottom: 0, width: 2,
            background: "#ff2222", zIndex: 3, pointerEvents: "none",
            boxShadow: "0 0 4px rgba(255,34,34,0.6)",
          }} />
        )}
      </div>

      {automationHeight > 0 && (
        <>
          <AutomationWaveSplitter
            onResizeStart={e => onSplitResize(laneIndex, e)}
          />
          <TrackAutomationLane
            laneIndex={laneIndex}
            color={color}
            width={w}
            panelHeight={automationHeight}
            startSec={startSec}
            durationSec={lane.durationSec}
            playheadSec={playheadSec}
            showAutomation={mix.showAutomation}
            mix={mix}
            onMixChange={onMixChange}
          />
        </>
      )}
    </div>
  );
}

// ─── Main Studio arrangement view ────────────────────────────────────────────

export function TransitionArrangementView({
  sorted, entryMap, flowEdges, transitionIndex, onSelectTransition,
  boothVisible = true, onToggleBooth,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const pxPerSecRef = useRef(readStoredZoom());
  const [pxPerSec, setPxPerSec] = useState(readStoredZoom);
  const [scrollViewport, setScrollViewport] = useState({ left: 0, width: 0 });
  const [caches, setCaches] = useState<Record<string, WaveformCache | null>>({});
  const [markersByEntry, setMarkersByEntry] = useState<Record<string, CatalogMarker[]>>({});
  const mixes = useStudioDeckStore(s => s.mixes);
  const waveformMode = useSelectStore(s => s.waveformMode);
  const setWaveformMode = useSelectStore(s => s.setWaveformMode);
  const [plans, setPlans] = useState<Record<number, TransitionPlanData | null>>({});
  const [drag, setDrag] = useState<{
    cardId: string;
    startClientX: number;
    startSec: number;
    bpm: number;
  } | null>(null);
  const [dragPreviewSec, setDragPreviewSec] = useState<number | null>(null);

  const timelineSelectedCardId = useSetBuilderStore(s => s.timelineSelectedCardId);
  const selectTimelineCard = useSetBuilderStore(s => s.selectTimelineCard);
  const setTimelineStart = useSetBuilderStore(s => s.setTimelineStart);

  const playheadSec = useBoothStore(s => s.playheadSec);
  const isPlaying = useTransportStore(s => s.isPlaying);
  const togglePlayPause = useTransportStore(s => s.togglePlayPause);
  const seek = useTransportStore(s => s.seek);
  pxPerSecRef.current = pxPerSec;

  const layout = useMemo(
    () => computeSetLayout(sorted, entryMap, undefined, pxPerSec),
    [sorted, entryMap, pxPerSec],
  );

  const automationTracks = useStudioAutomationStore(s => s.tracks);
  const expandAll = useStudioAutomationStore(s => s.expandAll);
  const expandedFlags = useStudioAutomationStore(s =>
    layout.lanes.map((_, i) => (s.tracks[i]?.expanded ? "1" : "0")).join(""),
  );
  const laneSplits = useStudioLaneStore(s => s.splits);
  const setLaneHeight = useStudioLaneStore(s => s.setLaneHeight);
  const nudgeSplit = useStudioLaneStore(s => s.nudgeSplit);
  const getAutomationPanelHeight = useStudioLaneStore(s => s.getAutomationPanelHeight);
  const getWaveHeight = useStudioLaneStore(s => s.getWaveHeight);

  const { laneYs, laneHeights, timelineH } = useMemo(() => {
    const { ys, heights, totalH } = computeLaneLayout(layout.lanes.length);
    return { laneYs: ys, laneHeights: heights, timelineH: totalH };
  }, [layout.lanes.length, automationTracks, expandAll, expandedFlags, laneSplits]);

  const startLaneResize = useCallback((laneIndex: number, e: React.MouseEvent, currentHeight: number) => {
    e.preventDefault();
    e.stopPropagation();
    const minH = Math.max(
      MIN_LANE_TOTAL_H,
      HEADER_H + trackAutomationHeight(laneIndex) + MIN_WAVE_H,
    );
    beginVerticalResizeDown({
      startY: e.clientY,
      startSize: currentHeight,
      min: minH,
      max: MAX_LANE_TOTAL_H,
      onPreview: (h) => setLaneHeight(laneIndex, h),
      onCommit: (h) => setLaneHeight(laneIndex, h),
    });
  }, [setLaneHeight]);

  const startSplitResize = useCallback((laneIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    let lastY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - lastY;
      lastY = ev.clientY;
      if (Math.abs(delta) > 0) nudgeSplit(laneIndex, delta);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [nudgeSplit]);

  const persistZoom = useCallback((next: number) => {
    const clamped = clampPxPerSec(next);
    setPxPerSec(clamped);
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  const zoomIn = useCallback(() => {
    persistZoom(pxPerSecRef.current * ZOOM_STEP);
  }, [persistZoom]);

  const zoomOut = useCallback(() => {
    persistZoom(pxPerSecRef.current / ZOOM_STEP);
  }, [persistZoom]);

  const fitToSet = useCallback(() => {
    const el = scrollRef.current;
    if (!el || layout.totalSec <= 0) return;
    const available = Math.max(200, el.clientWidth - 48);
    persistZoom(available / layout.totalSec);
    el.scrollLeft = 0;
  }, [layout.totalSec, persistZoom]);

  const handleTimelineWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    persistZoom(pxPerSecRef.current * factor);
  }, [persistZoom]);

  const { syncing: engineSyncing } = useSetEngineSync(layout.lanes);
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const canPlay = engineTracksReady && !engineSyncing;

  useAutomationRecorder(layout.lanes.length > 0);

  // Keep set-preview faders in sync with timeline strips (uses transport playhead).
  useEffect(() => {
    if (!canPlay || layout.lanes.length === 0) return;
    let raf = 0;
    const tick = () => {
      const pos = useTransportStore.getState().positionSeconds;
      const mixesNow = useStudioDeckStore.getState().mixes;
      const mode = useBoothStore.getState().mode;
      pushSetEngineMixes(layout.lanes, layout.transitions, mixesNow, pos, mode);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canPlay, layout.lanes, layout.transitions]);

  // Keep playhead in view while playing
  useEffect(() => {
    if (!isPlaying) return;
    const el = scrollRef.current;
    if (!el) return;
    const playheadPx = playheadSec * pxPerSec;
    const margin = 80;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    if (playheadPx < viewLeft + margin || playheadPx > viewRight - margin) {
      el.scrollLeft = Math.max(0, playheadPx - el.clientWidth * 0.35);
    }
  }, [playheadSec, isPlaying, pxPerSec]);

  const getMix = useCallback((i: number) => mixes[i] ?? defaultDeckMix(), [mixes]);

  const handleMixChange = useCallback((i: number, m: DeckMix) => {
    captureUndoState();
    const store = useStudioDeckStore.getState();
    const next = { ...store.mixes };
    // Exclusive cue — only one deck cued at a time
    if (m.cue && !getMix(i).cue) {
      for (const key of Object.keys(next)) {
        const idx = Number(key);
        if (idx !== i && next[idx]?.cue) {
          next[idx] = { ...next[idx], cue: false };
        }
      }
    }
    next[i] = m;
    store.setMixes(next);
  }, [getMix]);

  const entryIds = sorted.map(c => c.entryId).join(",");

  // Load waveforms
  useEffect(() => {
    for (const lane of layout.lanes) {
      const id = lane.card.entryId;
      const fp = lane.entry.file_path;
      if (!fp) continue;
      setCaches(prev => {
        if (id in prev) return prev;
        loadWaveformCache(fp, lane.entry.waveform_cache_path, lane.entry.id).then(c => {
          setCaches(p => ({ ...p, [id]: c }));
        }).catch(() => {
          setCaches(p => ({ ...p, [id]: null }));
        });
        return { ...prev, [id]: null };
      });
    }
  }, [entryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load cue / hot-cue markers from Select catalog
  useEffect(() => {
    for (const lane of layout.lanes) {
      const id = lane.card.entryId;
      setMarkersByEntry(prev => {
        if (id in prev) return prev;
        apiClient.select.listMarkers(id).then(m => {
          setMarkersByEntry(p => ({ ...p, [id]: m }));
        }).catch(() => {
          setMarkersByEntry(p => ({ ...p, [id]: [] }));
        });
        return { ...prev, [id]: [] };
      });
    }
  }, [entryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load transition plans
  useEffect(() => {
    for (const t of layout.transitions) {
      apiClient.select.planTransition(t.fromEntryId, t.toEntryId)
        .then(p => setPlans(prev => ({ ...prev, [t.index]: p })))
        .catch(() => setPlans(prev => ({ ...prev, [t.index]: null })));
    }
  }, [entryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync vertical scroll — deck strips stay aligned with timeline lanes
  useEffect(() => {
    const timeline = scrollRef.current;
    const sidebar = sidebarScrollRef.current;
    if (!timeline || !sidebar) return;

    const sync = () => {
      sidebar.style.transform = `translateY(-${timeline.scrollTop}px)`;
    };
    sync();
    timeline.addEventListener("scroll", sync, { passive: true });
    return () => timeline.removeEventListener("scroll", sync);
  }, [timelineH, layout.lanes.length]);

  // Track scroll viewport for minimap
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollViewport({ left: el.scrollLeft, width: el.clientWidth });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [layout.totalWidthPx]);

  // Scroll to selected transition
  useEffect(() => {
    const t = layout.transitions[transitionIndex];
    if (!t || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, t.leftPx - 120);
  }, [transitionIndex, layout.transitions]);

  // Horizontal drag — reposition track on timeline
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const deltaSec = (e.clientX - drag.startClientX) / pxPerSecRef.current;
      setDragPreviewSec(Math.max(0, drag.startSec + deltaSec));
    };

    const onUp = (e: MouseEvent) => {
      const deltaSec = (e.clientX - drag.startClientX) / pxPerSecRef.current;
      const raw = Math.max(0, drag.startSec + deltaSec);
      const snapped = snapToBeat(raw, drag.bpm);
      setTimelineStart(drag.cardId, snapped);
      setDrag(null);
      setDragPreviewSec(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, setTimelineStart]);

  const handleTrackPointerDown = useCallback((lane: LaneLayout, e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    let dragging = false;

    const onMove = (me: MouseEvent) => {
      if (!dragging && Math.abs(me.clientX - startX) > 4) {
        dragging = true;
        const current = useSetBuilderStore.getState().timelineSelectedCardId;
        if (current !== lane.card.id) {
          selectTimelineCard(lane.card.id);
          if (lane.index > 0) onSelectTransition(lane.index - 1);
        }
        setDrag({
          cardId: lane.card.id,
          startClientX: startX,
          startSec: lane.startSec,
          bpm: lane.entry.bpm ?? 128,
        });
        setDragPreviewSec(lane.startSec);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
    };

    const toggleSelect = () => {
      const current = useSetBuilderStore.getState().timelineSelectedCardId;
      const next = current === lane.card.id ? null : lane.card.id;
      selectTimelineCard(next);
      if (next && lane.index > 0) onSelectTransition(lane.index - 1);
    };

    const onUp = () => {
      if (!dragging) toggleSelect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [selectTimelineCard, onSelectTransition]);

  if (layout.lanes.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
        Add tracks to build your set arrangement
      </div>
    );
  }

  const totalDur = layout.totalSec;

  const markStep = rulerMarkInterval(pxPerSec);
  const rulerMarks: number[] = [];
  for (let s = 0; s <= totalDur; s += markStep) rulerMarks.push(s);

  const zoomPct = Math.round((pxPerSec / DEFAULT_PX_PER_SEC) * 100);
  const viewportLeftPct = layout.totalWidthPx > 0
    ? (scrollViewport.left / layout.totalWidthPx) * 100
    : 0;
  const viewportWidthPct = layout.totalWidthPx > 0
    ? Math.min(100, (scrollViewport.width / layout.totalWidthPx) * 100)
    : 100;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: STUDIO_BG_DEEP }}>
      {/* Top bar — set overview */}
      <div style={{
        height: 28, flexShrink: 0, background: STUDIO_SIDEBAR, borderBottom: `1px solid ${STUDIO_GRID}`,
        display: "flex", alignItems: "center", padding: "0 12px", gap: 16, fontSize: 10,
      }}>
        <span style={{ color: "#999" }}>
          <span style={{ color: "#ffeb3b", fontWeight: 700 }}>{formatTimeline(playheadSec)}</span>
          {" / "}{formatTimeline(totalDur)}
        </span>
        <span style={{ color: "#666" }}>{sorted.length} tracks · drag to reposition</span>
        {layout.lanes[0] && (
          <span style={{ color: "#90caf9" }}>
            {camelot(layout.lanes[0].entry.key)} · {Math.round(layout.lanes[0].entry.bpm ?? 128)} BPM
          </span>
        )}
        {/* Zoom controls */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "#111", borderRadius: 4, border: "1px solid #333", padding: "1px 4px",
        }}>
          <button
            type="button"
            onClick={zoomOut}
            disabled={pxPerSec <= MIN_PX_PER_SEC}
            title="Zoom out"
            style={{
              background: "none", border: "none", color: "#aaa",
              fontSize: 12, fontWeight: 700, width: 22, cursor: "pointer",
              opacity: pxPerSec <= MIN_PX_PER_SEC ? 0.35 : 1,
            }}
          >−</button>
          <span style={{ color: "#666", fontSize: 9, minWidth: 36, textAlign: "center" }}>
            {zoomPct}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={pxPerSec >= MAX_PX_PER_SEC}
            title="Zoom in"
            style={{
              background: "none", border: "none", color: "#aaa",
              fontSize: 12, fontWeight: 700, width: 22, cursor: "pointer",
              opacity: pxPerSec >= MAX_PX_PER_SEC ? 0.35 : 1,
            }}
          >+</button>
          <button
            type="button"
            onClick={fitToSet}
            title="Fit entire set in view"
            style={{
              background: "rgba(0,195,255,0.1)", border: "1px solid #00c3ff44",
              borderRadius: 3, color: "#00c3ff", fontSize: 9, fontWeight: 700,
              padding: "2px 8px", cursor: "pointer", marginLeft: 2,
            }}
          >Fit</button>
        </div>

        {/* Waveform style — same modes as Select */}
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <span style={{ color: "#555", fontSize: 8, marginRight: 2, letterSpacing: "0.06em" }}>WAVE</span>
          {(["rgb", "hsv", "simple"] as WaveformMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setWaveformMode(m)}
              title={{
                rgb: "RGB — frequency-colored (Mixxx RGB)",
                hsv: "HSV — hue-shift mode (Mixxx HSV)",
                simple: "Simple — amplitude only (Mixxx Simple)",
              }[m]}
              style={{
                height: 20, padding: "0 7px", border: "none", borderRadius: 2,
                background: waveformMode === m ? "rgba(255,255,255,0.12)" : "transparent",
                color: waveformMode === m ? "#e0e0e0" : "#555",
                fontSize: 8, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <span style={{ flex: 1 }} />
        {onToggleBooth && (
          <button
            type="button"
            onClick={onToggleBooth}
            title={boothVisible ? "Hide Pioneer booth" : "Show Pioneer booth"}
            style={{
              background: boothVisible ? "rgba(0,195,255,0.1)" : "#222",
              border: `1px solid ${boothVisible ? "#00c3ff55" : "#444"}`,
              borderRadius: 3,
              color: boothVisible ? "#00c3ff" : "#888",
              fontSize: 9, fontWeight: 700,
              padding: "2px 10px", cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {boothVisible ? "◎ Booth" : "◎ Show Booth"}
          </button>
        )}
        <button
          onClick={() => canPlay && togglePlayPause()}
          disabled={!canPlay}
          title={!canPlay ? (engineSyncing ? "Loading tracks…" : "Engine not ready") : undefined}
          style={{
            background: "#333", border: "1px solid #444", borderRadius: 3,
            color: !canPlay ? "#444" : isPlaying ? "#ffeb3b" : "#aaa",
            fontSize: 10, fontWeight: 700,
            padding: "2px 10px", cursor: canPlay ? "pointer" : "not-allowed",
            opacity: canPlay ? 1 : 0.5,
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
      </div>

      <SetAutomationPanel trackCount={layout.lanes.length} />

      {/* Mini-map */}
      <div style={{
        height: MINIMAP_H, flexShrink: 0, background: STUDIO_SIDEBAR, borderBottom: `1px solid ${STUDIO_GRID}`,
        position: "relative", margin: "0 0 0 0",
      }}>
        <div style={{ position: "absolute", left: LANE_STRIP_W, right: 0, top: 4, bottom: 4, display: "flex" }}>
          {layout.lanes.map((lane, i) => (
            <div
              key={lane.card.id}
              onClick={() => {
                const current = useSetBuilderStore.getState().timelineSelectedCardId;
                const next = current === lane.card.id ? null : lane.card.id;
                selectTimelineCard(next);
                if (scrollRef.current) scrollRef.current.scrollLeft = lane.leftPx;
                if (next) {
                  if (i < layout.transitions.length) onSelectTransition(i);
                  else if (i > 0) onSelectTransition(i - 1);
                }
              }}
              style={{
                position: "absolute",
                left: `${(lane.startSec / totalDur) * 100}%`,
                width: `${(lane.durationSec / totalDur) * 100}%`,
                height: "100%",
                background: LANE_COLORS[i % LANE_COLORS.length] + "44",
                border: transitionIndex === i || transitionIndex === i - 1
                  ? `1px solid ${LANE_COLORS[i % LANE_COLORS.length]}`
                  : "1px solid #222",
                borderRadius: 2, cursor: "pointer", minWidth: 4,
              }}
            />
          ))}
          {/* Scroll viewport indicator */}
          <div style={{
            position: "absolute",
            left: `${viewportLeftPct}%`,
            width: `${viewportWidthPct}%`,
            height: "100%",
            border: "1px solid #ffeb3b88",
            background: "#ffeb3b12",
            borderRadius: 2, pointerEvents: "none",
          }} />
          {/* Playhead tick on minimap */}
          {totalDur > 0 && (
            <div style={{
              position: "absolute",
              left: `${(playheadSec / totalDur) * 100}%`,
              width: 2,
              height: "100%",
              background: "#fff",
              opacity: 0.7,
              pointerEvents: "none",
            }} />
          )}
        </div>
      </div>

      {/* Timeline body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Deck strips — compact, positioned to match timeline lane tops */}
        <div style={{
          width: LANE_STRIP_W,
          flexShrink: 0,
          background: STUDIO_SIDEBAR,
          borderRight: `1px solid ${STUDIO_GRID}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            height: RULER_H,
            flexShrink: 0,
            borderBottom: `1px solid ${STUDIO_GRID}`,
            background: STUDIO_RULER,
          }} />
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <div
              ref={sidebarScrollRef}
              style={{ position: "absolute", left: 0, right: 0, top: 0, height: timelineH }}
            >
              {layout.lanes.map((lane, i) => {
                const waveH = getWaveHeight(i);
                const autoH = getAutomationPanelHeight(i);
                const color = LANE_COLORS[i % LANE_COLORS.length];
                const mix = getMix(i);

                return (
                  <div key={lane.card.id}>
                    <div
                      style={{
                        position: "absolute",
                        top: laneYs[i],
                        left: 0,
                        right: 0,
                        height: LANE_HEIGHT,
                      }}
                    >
                      <DJMLaneStrip
                        index={i}
                        entryId={lane.card.entryId}
                        mix={mix}
                        height={LANE_HEIGHT}
                        onChange={m => handleMixChange(i, m)}
                        color={color}
                      />
                    </div>
                    {autoH > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: laneYs[i] + HEADER_H + waveH + 6,
                          left: 0,
                          right: 0,
                          height: autoH,
                        }}
                      >
                        <AutomationLaneControls
                          laneIndex={i}
                          color={color}
                          panelHeight={autoH}
                          playheadSec={playheadSec}
                          showAutomation={mix.showAutomation}
                          mix={mix}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Scrollable timeline */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: "auto", position: "relative", background: STUDIO_BG }}
          onWheel={handleTimelineWheel}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
            seek(x / pxPerSec);
          }}
        >
          <div style={{ width: layout.totalWidthPx + 200, minHeight: timelineH + RULER_H, position: "relative" }}>
            {/* Time ruler */}
            <div style={{
              height: RULER_H, position: "sticky", top: 0, zIndex: 20,
              background: STUDIO_RULER, borderBottom: `1px solid ${STUDIO_GRID}`,
            }}>
              {rulerMarks.map(s => (
                <div key={s} style={{
                  position: "absolute", left: s * pxPerSec, top: 0, height: "100%",
                  borderLeft: `1px solid ${STUDIO_GRID}`, paddingLeft: 4, paddingTop: 5,
                  fontSize: 8, color: "#888",
                }}>
                  {formatTimeline(s)}
                </div>
              ))}
            </div>

            {/* Grid lines + lane row dividers */}
            <div style={{ position: "absolute", top: RULER_H, left: 0, right: 0, height: timelineH }}>
              {rulerMarks.map(s => (
                <div key={s} style={{
                  position: "absolute", left: s * pxPerSec, top: 0, height: "100%",
                  borderLeft: `1px solid ${STUDIO_GRID}44`, pointerEvents: "none",
                }} />
              ))}
              {laneYs.map((y, i) => (
                <div
                  key={`lane-div-${i}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: y + laneHeights[i] - 1,
                    height: 1,
                    background: STUDIO_GRID,
                    pointerEvents: "none",
                  }}
                />
              ))}
              {laneYs.map((y, i) => (
                <div
                  key={`lane-resize-${i}`}
                  role="separator"
                  aria-label={`Resize deck ${i + 1}`}
                  onMouseDown={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    startLaneResize(i, e, laneHeights[i]);
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: y + laneHeights[i] - 4,
                    height: 8,
                    cursor: "ns-resize",
                    zIndex: 25,
                    touchAction: "none",
                  }}
                />
              ))}
            </div>

            {/* Transition regions (blue boxes) */}
            {layout.transitions.map(t => {
              const edge = flowEdges.find(
                e => e.from_id === t.fromEntryId && e.to_id === t.toEntryId,
              );
              const isActive = t.index === transitionIndex;
              return (
                <div
                  key={t.index}
                  onClick={e => { e.stopPropagation(); onSelectTransition(t.index); }}
                  style={{
                    position: "absolute",
                    left: t.leftPx,
                    top: RULER_H + (laneYs[t.index] ?? t.laneAY),
                    width: t.widthPx,
                    height: (laneYs[t.index + 1] ?? (laneYs[t.index] ?? 0) + (laneHeights[t.index] ?? 0))
                      - (laneYs[t.index] ?? 0),
                    border: isActive ? "2px solid #ffeb3b" : "1px solid rgba(100,149,237,0.5)",
                    background: isActive ? "rgba(255,235,59,0.08)" : "rgba(100,149,237,0.06)",
                    borderRadius: 4, cursor: "pointer", zIndex: 3,
                    pointerEvents: "auto",
                  }}
                >
                  <div style={{
                    position: "absolute", top: -18, left: 4,
                    fontSize: 8, fontWeight: 700, color: isActive ? "#ffeb3b" : "#6495ed",
                    background: STUDIO_BG, padding: "1px 6px", borderRadius: 3,
                    whiteSpace: "nowrap",
                  }}>
                    {t.index + 1}→{t.index + 2}
                    {edge?.overall != null ? ` · ${Math.round(edge.overall * 100)}%` : ""}
                    {plans[t.index]?.strategy ? ` · ${plans[t.index]!.strategy!.replace(/_/g, " ")}` : ""}
                  </div>
                </div>
              );
            })}

            {/* Playhead */}
            <div style={{
              position: "absolute",
              left: playheadSec * pxPerSec,
              top: RULER_H,
              height: timelineH,
              width: 2,
              background: "#fff",
              zIndex: 30,
              pointerEvents: "none",
            }}>
              <div style={{
                position: "absolute", top: -RULER_H, left: -5,
                width: 0, height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: "8px solid #fff",
              }} />
            </div>

            {/* Track blocks */}
            <div style={{ position: "absolute", top: RULER_H, left: 0, height: timelineH }}>
              {layout.lanes.map((lane, i) => {
                const isDragging = drag?.cardId === lane.card.id;
                const overrideStart = isDragging ? dragPreviewSec : null;

                return (
                  <TrackBlock
                    key={lane.card.id}
                    lane={lane}
                    laneIndex={i}
                    laneY={laneYs[i]}
                    laneHeight={laneHeights[i]}
                    automationHeight={getAutomationPanelHeight(i)}
                    waveHeight={getWaveHeight(i)}
                    onSplitResize={startSplitResize}
                    color={LANE_COLORS[i % LANE_COLORS.length]}
                    mix={getMix(i)}
                    onMixChange={m => handleMixChange(i, m)}
                    cache={caches[lane.card.entryId] ?? null}
                    markers={markersByEntry[lane.card.entryId]}
                    waveformMode={waveformMode}
                    isSelected={i === transitionIndex || i === transitionIndex + 1}
                    isCardSelected={lane.card.id === timelineSelectedCardId}
                    isDragging={isDragging}
                    overrideStartSec={overrideStart}
                    pxPerSec={pxPerSec}
                    playheadSec={playheadSec}
                    onDragStart={e => handleTrackPointerDown(lane, e)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
