/**
 * Studio-style set arrangement — full timeline, stacked overlapping lanes,
 * automation curves on waveforms, per-deck EQ strips. Like DJ.Studio for set building.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import {
  apiClient,
  type FlowEdge,
  type TransitionPlanData,
} from "../../lib/apiClient";
import {
  type DeckMix,
  defaultDeckMix,
} from "../../lib/deckMixEngine";
import { useTransportStore } from "../../stores/transportStore";
import { useBoothStore } from "../../stores/boothStore";
import { pushSetEngineMixes } from "../../lib/boothSimulation";
import { useSetBuilderStore } from "../../stores/setBuilderStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useStudioDeckStore } from "../../stores/studioDeckStore";
import { captureUndoState } from "../../stores/undoStore";
import { ZOOM_BUTTON_FACTOR } from "../../lib/timelineViewportZoom";
import { useSetTimelineStore } from "../../stores/setTimelineStore";
import { useTimelineWheel } from "../../hooks/useTimelineWheel";
import { useSetTimelineShortcuts } from "../../hooks/useSetTimelineShortcuts";
import { useSetLocatorShortcuts } from "../../hooks/useSetLocatorShortcuts";
import { useRulerMagnify } from "../../hooks/useRulerMagnify";
import {
  seekSetTimeline,
  timeSecFromClientX,
  pixelsToTimeSec,
} from "../../lib/setTimelineEngine";
import { beginUndoGesture, endUndoGesture } from "../../stores/undoStore";
import { getZoomAnchorViewportX, subscribeTimelineCursor, getCursorTimeSec } from "../../lib/setTimelineViewport";
import { SetTimelineContext } from "../../lib/setTimelineContext";
import { useNativeTimelineEmbed } from "../../hooks/useNativeTimelineEmbed";
import { listenNativeTimelineViewport } from "../../lib/nativeTimelineEmbed";
import { nativeStripHitTest, nativeStripCursor } from "../../lib/nativeStripHitTest";
import {
  nativeClipHitTest,
  nativeClipCursor,
  nativeIsDeckStripColumn,
  nativeLaneIndexFromClientY,
  nativeTimeSecFromClientX,
} from "../../lib/nativeTimelineHitTest";
import { SetTimelineEditCursor } from "./SetTimelineEditCursor";
import { useSetLocatorStore } from "../../stores/setLocatorStore";
import { WaveformCanvas } from "../tracks/WaveformCanvas";
import { DJMLaneStrip } from "./DJMLaneStrip";
import {
  LANE_STRIP_W, BEAT_RULER_H, TIME_RULER_H, minimapHeight,
  DEFAULT_PX_PER_SEC, MIN_PX_PER_SEC, MAX_PX_PER_SEC,
  HEADER_H,
  STUDIO_BG, STUDIO_BG_DEEP, STUDIO_SIDEBAR, STUDIO_RULER, STUDIO_GRID,
  computeSetLayout, formatTimeline, snapToBeat,
  type LaneLayout,
} from "./setTimelineLayout";
import { SetBeatRuler } from "./SetBeatRuler";
import { SetTimeRuler } from "./SetTimeRuler";
import { SetTimelineNavigator } from "./SetTimelineNavigator";
import { SetLocatorsLane } from "./SetLocatorsLane";
import { SetBeatTimelineGrid } from "./SetBeatTimelineGrid";
import { SetAutomationPanel } from "./SetAutomationPanel";
import { TrackAutomationLane } from "./TrackAutomationLane";
import { AutomationLaneControls } from "./AutomationLaneControls";
import { useAutomationRecorder } from "../../hooks/useAutomationRecorder";
import {
  useStudioAutomationStore,
  trackAutomationHeight,
  bindAutomationToSet,
  AUTOMATION_PARAMS,
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
import {
  arrangementClipBackground,
  contrastingTextOn,
  resolveClipColor,
  shadeHex,
  waveformColorsFromClip,
} from "../../lib/clipColorPresets";
import { resolveCardClipColor } from "../../lib/abletonClipPalette";
import { ClipColorMenu } from "./ClipColorMenu";
import { wavecachePath } from "../../lib/waveformEngine/cacheLoader";
import { VisualPlayPosition } from "../../lib/visualPlayPosition";

const NATIVE_GPU_DEFAULT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);

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

function camelot(k?: string | null) { return k ? CAMELOT[k] ?? k : "—"; }
function trackTitle(e: CatalogEntry) {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}


// ─── Single track block on timeline ───────────────────────────────────────────

function TrackBlock({ lane, laneIndex, laneY, laneHeight, automationHeight, waveHeight,
  automationExpanded, onSplitResize, color, mix, onMixChange, isSelected, isCardSelected, isDragging,
  dragTranslatePx, pxPerSec, playheadSec, onHeaderPointerDown, onHeaderContextMenu, onSeekAtClientX,
  timelineScrollLeft, timelineViewportWidth,
}: {
  lane: LaneLayout;
  laneIndex: number;
  laneY: number;
  laneHeight: number;
  automationHeight: number;
  automationExpanded: boolean;
  waveHeight: number;
  onSplitResize: (laneIndex: number, e: React.MouseEvent) => void;
  color: string;
  mix: DeckMix;
  onMixChange: (mix: DeckMix) => void;
  isSelected: boolean;
  isCardSelected: boolean;
  isDragging: boolean;
  dragTranslatePx?: number;
  pxPerSec: number;
  playheadSec: number;
  onHeaderPointerDown: (e: React.MouseEvent) => void;
  onHeaderContextMenu: (e: React.MouseEvent) => void;
  onSeekAtClientX: (clientX: number) => void;
  timelineScrollLeft: number;
  timelineViewportWidth: number;
}) {
  const leftPx = lane.leftPx;
  const w = Math.max(lane.widthPx, 24);
  const showAutomation = automationExpanded && automationHeight > 0;
  const labelColor = contrastingTextOn(color);
  const clipBorder = shadeHex(color, -0.28);
  const visStart = Math.max(0, timelineScrollLeft - lane.leftPx);
  const visEnd = Math.min(w, timelineScrollLeft + timelineViewportWidth - lane.leftPx);
  const visWidth = Math.max(0, visEnd - visStart);
  const clipBg = resolveClipColor(color);
  const waveColors = waveformColorsFromClip(color);

  const seekAt = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSeekAtClientX(e.clientX);
  };

  return (
    <div
      data-clip-container
      style={{
        position: "absolute",
        left: leftPx,
        top: laneY,
        width: w,
        height: laneHeight,
        display: "flex",
        flexDirection: "column",
        opacity: mix.mute ? 0.45 : 1,
        zIndex: isDragging ? 25 : isCardSelected ? 15 : 10,
        pointerEvents: "none",
        transform: dragTranslatePx ? `translateX(${dragTranslatePx}px)` : undefined,
        willChange: isDragging ? "transform" : undefined,
        background: arrangementClipBackground(color),
        border: isCardSelected
          ? `2px solid ${shadeHex(color, 0.35)}`
          : isSelected
            ? `1px solid ${shadeHex(color, 0.2)}`
            : `1px solid ${clipBorder}`,
        borderRadius: 4,
        boxShadow: isCardSelected
          ? `0 0 0 1px rgba(255,255,255,0.12), 0 4px 14px rgba(0,0,0,0.45)`
          : "0 1px 3px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      {/* Clip header — select / drag only */}
      <div
        data-clip-header
        onMouseDown={onHeaderPointerDown}
        onContextMenu={onHeaderContextMenu}
        style={{
          height: HEADER_H,
          display: "flex", alignItems: "center", gap: 5,
          padding: "0 8px",
          borderBottom: `1px solid ${shadeHex(color, -0.18)}`,
          background: `linear-gradient(180deg, ${shadeHex(color, -0.08)} 0%, transparent 100%)`,
          flexShrink: 0,
          cursor: isDragging ? "grabbing" : "grab",
          pointerEvents: "auto",
        }}
      >
        <span style={{
          fontSize: 8, fontWeight: 800, color: labelColor,
          background: "rgba(0,0,0,0.18)", padding: "1px 4px", borderRadius: 2,
          letterSpacing: "0.04em",
        }}>
          {camelot(lane.entry.key)}
        </span>
        <span style={{
          fontSize: 9, color: labelColor, fontWeight: 600,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
          textShadow: labelColor === "#f8f8f8" ? "0 1px 2px rgba(0,0,0,0.45)" : "none",
        }}>
          {trackTitle(lane.entry)}
        </span>
      </div>

      <div
        onMouseDown={seekAt}
        style={{
          height: waveHeight,
          flexShrink: 0,
          overflow: "hidden",
          position: "relative",
          cursor: "default",
          pointerEvents: "auto",
        }}
      >
        {visWidth > 0 && lane.entry.file_path ? (
          <WaveformCanvas
            trackId={lane.card.entryId}
            audioPath={lane.entry.file_path}
            cachePath={lane.entry.waveform_cache_path}
            entryId={lane.entry.id}
            width={Math.floor(w)}
            height={Math.floor(waveHeight)}
            pixelsPerSecond={pxPerSec}
            clipBgColor={clipBg}
            viewportOffsetX={visStart}
            viewportWidth={visWidth}
            freezeRender={isDragging}
            waveLayout="stereo"
            waveFill={waveColors.fill}
            waveOutline={waveColors.outline}
            showCenterLine
          />
        ) : (
          <div style={{ width: "100%", height: "100%", background: clipBg, opacity: 0.85 }} />
        )}
      </div>

      {showAutomation && (
        <>
          <AutomationWaveSplitter
            onResizeStart={e => onSplitResize(laneIndex, e)}
          />
          <div
            onMouseDown={seekAt}
            style={{ flex: 1, minHeight: 0, cursor: "default", pointerEvents: "auto" }}
          >
            <TrackAutomationLane
              laneIndex={laneIndex}
              color={color}
              width={w}
              panelHeight={automationHeight}
              startSec={lane.startSec}
              durationSec={lane.durationSec}
              playheadSec={playheadSec}
              showAutomation={mix.showAutomation}
              mix={mix}
              onMixChange={onMixChange}
            />
          </div>
        </>
      )}
    </div>
  );
}

const LANE_RESIZE_HIT = 12;

/** Full-width lane row click targets — select deck/track from empty timeline or sidebar filler. */
function LaneSelectOverlays({
  lanes,
  laneYs,
  laneHeights,
  laneCount,
  extendedLaneH,
  colors,
  selectedCardId,
  onSelectLane,
  onSeekAtClientX,
}: {
  lanes: LaneLayout[];
  laneYs: number[];
  laneHeights: number[];
  laneCount: number;
  extendedLaneH: number;
  colors: string[];
  selectedCardId: string | null;
  onSelectLane: (laneIndex: number) => void;
  onSeekAtClientX: (clientX: number) => void;
}) {
  return (
    <>
      {laneYs.map((y, i) => {
        const lane = lanes[i];
        if (!lane) return null;
        const rowH = i < laneCount - 1 ? laneHeights[i] : extendedLaneH - y;
        const color = colors[i % colors.length];
        const isSelected = lane.card.id === selectedCardId;
        return (
          <div
            key={`lane-select-${i}`}
            data-lane-select
            onClick={e => {
              e.stopPropagation();
              onSeekAtClientX(e.clientX);
              onSelectLane(i);
            }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: y,
              height: rowH,
              zIndex: 2,
              cursor: "pointer",
              boxShadow: isSelected ? `inset 0 0 0 1px ${color}66` : undefined,
            }}
          />
        );
      })}
    </>
  );
}

/** Full-width bottom-edge resize zones — last lane extends into empty viewport below tracks. */
function LaneResizeOverlays({
  laneYs,
  laneHeights,
  laneCount,
  extendedLaneH,
  onResizeStart,
}: {
  laneYs: number[];
  laneHeights: number[];
  laneCount: number;
  extendedLaneH: number;
  onResizeStart: (laneIndex: number, e: React.MouseEvent, currentHeight: number) => void;
}) {
  return (
    <>
      {laneYs.map((y, i) => {
        const bottom = y + laneHeights[i];
        const isLast = i === laneCount - 1;
        const hitTop = bottom - LANE_RESIZE_HIT / 2;
        const hitHeight = isLast
          ? Math.max(LANE_RESIZE_HIT, extendedLaneH - hitTop)
          : LANE_RESIZE_HIT;
        return (
          <div
            key={`lane-resize-${i}`}
            data-lane-resize
            role="separator"
            aria-label={`Resize deck ${i + 1}`}
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              onResizeStart(i, e, laneHeights[i]);
            }}
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: hitTop,
              height: hitHeight,
              cursor: "ns-resize",
              zIndex: 26,
              touchAction: "none",
            }}
          />
        );
      })}
    </>
  );
}

// ─── Main Studio arrangement view ────────────────────────────────────────────

export function TransitionArrangementView({
  sorted, entryMap, flowEdges, transitionIndex, onSelectTransition,
  boothVisible = true, onToggleBooth,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nativeEmbedHostRef = useRef<HTMLDivElement>(null);
  const nativeLanePanelRef = useRef<HTMLDivElement>(null);
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const zoomCameraRef = useRef<HTMLDivElement>(null);
  const timelineZoneRef = useRef<HTMLDivElement>(null);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const pixelsPerSecond = useSetTimelineStore(s => s.pixelsPerSecond);
  const timelineScrollLeft = useSetTimelineStore(s => s.scrollLeft);
  const setScrollLeft = useSetTimelineStore(s => s.setScrollLeft);
  const fitToDuration = useSetTimelineStore(s => s.fitToDuration);
  const pxPerSecRef = useRef(pixelsPerSecond);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [laneViewportH, setLaneViewportH] = useState(0);
  const mixes = useStudioDeckStore(s => s.mixes);
  const [plans, setPlans] = useState<Record<number, TransitionPlanData | null>>({});
  const [drag, setDrag] = useState<{
    cardId: string;
    startClientX: number;
    startSec: number;
    bpm: number;
  } | null>(null);
  const [dragDeltaPx, setDragDeltaPx] = useState(0);
  const [nativeGpuActive, setNativeGpuActive] = useState(NATIVE_GPU_DEFAULT);
  const [nativeEmbedGeneration, setNativeEmbedGeneration] = useState(2);
  const navView = useNavigationStore(s => s.view);
  const setViewMode = useSetBuilderStore(s => s.viewMode);

  const activeSetId = useSetBuilderStore(s => s.activeSetId);
  const timelineSelectedCardId = useSetBuilderStore(s => s.timelineSelectedCardId);
  const selectTimelineCard = useSetBuilderStore(s => s.selectTimelineCard);
  const setTimelineStart = useSetBuilderStore(s => s.setTimelineStart);
  const setCardClipColor = useSetBuilderStore(s => s.setCardClipColor);

  const locators = useSetLocatorStore(s => s.locators);
  const locatorSelectedId = useSetLocatorStore(s => s.selectedId);
  const locatorRenamingId = useSetLocatorStore(s => s.renamingId);
  const keyMapMode = useSetLocatorStore(s => s.keyMapMode);
  const pendingKeyMapLocatorId = useSetLocatorStore(s => s.pendingKeyMapLocatorId);
  const loadLocatorsForSet = useSetLocatorStore(s => s.loadForActiveSet);
  const addLocator = useSetLocatorStore(s => s.addLocator);
  const updateLocator = useSetLocatorStore(s => s.updateLocator);
  const removeLocator = useSetLocatorStore(s => s.removeLocator);
  const selectLocator = useSetLocatorStore(s => s.selectLocator);
  const setKeyMapMode = useSetLocatorStore(s => s.setKeyMapMode);
  const setRenamingId = useSetLocatorStore(s => s.setRenamingId);
  const requestKeyBinding = useSetLocatorStore(s => s.requestKeyBinding);

  const [clipColorMenu, setClipColorMenu] = useState<{
    x: number;
    y: number;
    cardId: string;
  } | null>(null);

  const [locatorMenu, setLocatorMenu] = useState<{
    x: number;
    y: number;
    locatorId: string | null;
    timeSec: number;
  } | null>(null);

  const playheadSec = useTransportStore(s => s.positionSeconds);
  const setCursor = useTransportStore(s => s.setCursor);
  const hoverTimeSec = useSyncExternalStore(subscribeTimelineCursor, getCursorTimeSec, () => null);
  const isPlaying = useTransportStore(s => s.isPlaying);
  const visualPosRef = useRef(new VisualPlayPosition());
  const [nativePlayheadSec, setNativePlayheadSec] = useState(0);
  pxPerSecRef.current = pixelsPerSecond;

  const layout = useMemo(
    () => computeSetLayout(sorted, entryMap, undefined, pixelsPerSecond),
    [sorted, entryMap, pixelsPerSecond],
  );

  const nativeEmbedLive =
    nativeGpuActive
    && navView === "research"
    && setViewMode === "arrangement"
    && layout.lanes.length > 0;

  // Sync store when native Metal panel handles scroll/pinch (events never reach DOM).
  useEffect(() => {
    if (!nativeEmbedLive) return;
    let unlisten: (() => void) | undefined;
    void listenNativeTimelineViewport(({ pixels_per_second, scroll_left }) => {
      useSetTimelineStore.getState().setView(pixels_per_second, scroll_left);
      setScrollLeft(scroll_left);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [nativeEmbedLive, setScrollLeft]);

  useEffect(() => {
    visualPosRef.current.sync(playheadSec, isPlaying);
    if (!isPlaying) setNativePlayheadSec(playheadSec);
  }, [playheadSec, isPlaying]);

  useEffect(() => {
    if (!nativeEmbedLive || !isPlaying) return;
    let raf = 0;
    const tick = () => {
      setNativePlayheadSec(visualPosRef.current.interpolate());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nativeEmbedLive, isPlaying]);

  const gridBpm = layout.lanes[0]?.entry.bpm ?? 128;

  const laneClipColors = useMemo(
    () => layout.lanes.map((lane, i) =>
      resolveCardClipColor(lane.card.clipColor, i),
    ),
    [layout.lanes],
  );

  const nativeLaneInputs = useMemo(
    () => layout.lanes.map((lane, index) => {
      const colorHex = laneClipColors[index] ?? resolveCardClipColor(lane.card.clipColor, index);
      return {
        startSec: lane.startSec,
        durationSec: lane.durationSec,
        index,
        colorHex,
        wavecachePath: lane.entry.waveform_cache_path
          ?? (lane.entry.file_path ? wavecachePath(lane.entry.file_path) : undefined),
        label: trackTitle(lane.entry).slice(0, 48),
        badge: camelot(lane.entry.key),
        labelColorHex: contrastingTextOn(colorHex),
      };
    }),
    [layout.lanes, laneClipColors],
  );

  const timelineContext = useMemo(
    () => new SetTimelineContext({
      pixelsPerSecond,
      scrollLeft: timelineScrollLeft,
      viewportWidth,
      totalSec: layout.totalSec,
      bpm: gridBpm,
    }),
    [pixelsPerSecond, timelineScrollLeft, viewportWidth, layout.totalSec, gridBpm],
  );

  const readTimelineContext = useCallback(() => timelineContext, [timelineContext]);

  const onViewportChange = useCallback((_left: number, width: number) => {
    setViewportWidth(width);
  }, []);

  const readViewportMetrics = useCallback(() => timelineContext.toParams(), [timelineContext]);

  const readZoomAnchorViewportX = useCallback(() => {
    const el = scrollRef.current;
    const fallback = el ? el.clientWidth * 0.5 : 0;
    return getZoomAnchorViewportX(fallback);
  }, []);

  const onCursorTime = useCallback((timeSec: number) => {
    setCursor(timeSec);
  }, [setCursor]);

  // Seed viewport width on mount — avoids width=0 (no waveforms / ruler paint).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.clientWidth > 0) {
      setViewportWidth(el.clientWidth);
    }
  }, [layout.lanes.length]);

  const { syncDomScroll } = useTimelineWheel({
    scrollRef,
    zoneRef: timelineZoneRef,
    setScrollLeft,
    readScrollLeft: () => useSetTimelineStore.getState().scrollLeft,
    enabled: layout.lanes.length > 0,
    lanesKey: layout.lanes.length,
    onViewportChange,
    readTimelineContext,
    onCursorTime,
    nativeActive: nativeEmbedLive,
  });

  const seekTimeline = useCallback(async (timeSec: number) => {
    await seekSetTimeline(timeSec, {
      lanes: layout.lanes,
      transitions: layout.transitions,
      totalSec: layout.totalSec,
    });
  }, [layout.lanes, layout.transitions, layout.totalSec]);

  const seekFromClientX = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    void seekTimeline(timeSecFromClientX(clientX, el, readViewportMetrics()));
  }, [seekTimeline, readViewportMetrics]);

  const fitToSet = useCallback(() => {
    const el = scrollRef.current;
    if (!el || layout.totalSec <= 0) return;
    fitToDuration(layout.totalSec, el.clientWidth);
    el.scrollLeft = 0;
    setScrollLeft(0);
    setViewportWidth(el.clientWidth);
  }, [layout.totalSec, fitToDuration, setScrollLeft]);

  const fitToViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const selected = layout.lanes.find(l => l.card.id === timelineSelectedCardId);
    if (selected) {
      useSetTimelineStore.getState().zoomToTimeRange(
        selected.startSec,
        selected.endSec,
        el.clientWidth,
      );
      const sl = useSetTimelineStore.getState().scrollLeft;
      if (scrollRef.current) scrollRef.current.scrollLeft = sl;
      setScrollLeft(sl);
      setViewportWidth(el.clientWidth);
    } else {
      fitToSet();
    }
  }, [layout.lanes, timelineSelectedCardId, fitToSet, setScrollLeft]);

  const rulerMagnify = useRulerMagnify({
    scrollRef,
    syncDomScroll,
    onViewportChange,
    onRulerSeek: seekFromClientX,
    readTimelineContext,
  });

  useSetLocatorShortcuts({
    enabled: layout.lanes.length > 0,
    onJumpToLocator: (t) => { void seekTimeline(t); },
  });

  useSetTimelineShortcuts({
    enabled: layout.lanes.length > 0,
    lanes: layout.lanes,
    selectedCardId: timelineSelectedCardId,
    scrollRef,
    syncDomScroll,
    readZoomAnchorViewportX,
    nativeActive: nativeEmbedLive,
  });

  const automationTracks = useStudioAutomationStore(s => s.tracks);
  const toggleTrackExpanded = useStudioAutomationStore(s => s.toggleTrackExpanded);
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
  }, [layout.lanes.length, automationTracks, expandedFlags, laneSplits]);

  const laneCount = layout.lanes.length;
  const extendedLaneH = Math.max(timelineH, laneViewportH);

  const embedLaneYs = laneYs;
  const embedLaneHeights = laneHeights;
  const waveBandHeights = useMemo(
    () => layout.lanes.map((_, i) => HEADER_H + getWaveHeight(i)),
    [layout.lanes.length, automationTracks, expandedFlags, laneSplits, getWaveHeight],
  );

  const nativeDeckStrips = useMemo(
    () => layout.lanes.map((lane, index) => {
      const colorHex = laneClipColors[index] ?? resolveCardClipColor(lane.card.clipColor, index);
      const mix = mixes[index] ?? defaultDeckMix();
      const automationExpanded = automationTracks[index]?.expanded ?? false;
      return {
        laneIndex: index,
        colorHex,
        deckLabel: `${index + 1}`,
        title: trackTitle(lane.entry).slice(0, 22),
        selected: lane.card.id === timelineSelectedCardId,
        muted: mix.mute,
        solo: mix.solo,
        cue: mix.cue,
        showAutomation: mix.showAutomation,
        automationExpanded,
      };
    }),
    [layout.lanes, laneClipColors, timelineSelectedCardId, mixes, automationTracks],
  );

  const nativeAutomationLanes = useMemo(
    () => layout.lanes.map((lane, index) => {
      const colorHex = laneClipColors[index] ?? resolveCardClipColor(lane.card.clipColor, index);
      const mix = mixes[index] ?? defaultDeckMix();
      const automationExpanded = automationTracks[index]?.expanded ?? false;
      const autoH = getAutomationPanelHeight(index);
      const autoState = automationTracks[index];
      const activeParam = autoState?.activeLane ?? "trackVolume";
      const paramDef = AUTOMATION_PARAMS.find(p => p.param === activeParam);
      const keyframes = autoState?.curves[activeParam] ?? [];
      return {
        laneIndex: index,
        colorHex,
        visible: automationExpanded && autoH > 0 && mix.showAutomation,
        paramLabel: paramDef?.label ?? activeParam,
        keyframes: keyframes.map(kf => ({ timeSec: kf.timeSec, valueNorm: kf.valueNorm })),
      };
    }),
    [layout.lanes, laneClipColors, automationTracks, mixes, getAutomationPanelHeight],
  );

  const nativeTransitions = useMemo(
    () => layout.transitions.map(t => ({
      startSec: t.startSec,
      endSec: t.endSec,
      fromLaneIndex: t.index,
      toLaneIndex: t.index + 1,
      selected: t.index === transitionIndex,
    })),
    [layout.transitions, transitionIndex],
  );

  const syncSetPreviewMixes = useCallback(() => {
    if (!useTransportStore.getState().engineTracksReady) return;
    pushSetEngineMixes(
      layout.lanes,
      layout.transitions,
      useStudioDeckStore.getState().mixes,
      useTransportStore.getState().positionSeconds,
      useBoothStore.getState().mode,
    );
  }, [layout.lanes, layout.transitions]);

  const embedAreaH = nativeEmbedLive ? timelineH : extendedLaneH;

  const selectLaneCard = useCallback((laneIndex: number) => {
    const lane = layout.lanes[laneIndex];
    if (!lane) return;
    selectTimelineCard(lane.card.id);
    if (laneIndex < layout.transitions.length) onSelectTransition(laneIndex);
    else if (laneIndex > 0) onSelectTransition(laneIndex - 1);
  }, [layout.lanes, layout.transitions.length, selectTimelineCard, onSelectTransition]);

  const selectedLaneIndex = useMemo(() => {
    if (!timelineSelectedCardId) return null;
    const idx = layout.lanes.findIndex(l => l.card.id === timelineSelectedCardId);
    return idx >= 0 ? idx : null;
  }, [timelineSelectedCardId, layout.lanes]);

  const nativeSeekFromClientX = useCallback((clientX: number) => {
    const el = nativeLanePanelRef.current;
    if (!el) return;
    if (nativeIsDeckStripColumn(clientX, el, LANE_STRIP_W)) return;
    const timeSec = nativeTimeSecFromClientX(
      clientX,
      el,
      timelineScrollLeft,
      pixelsPerSecond,
      layout.totalSec,
      LANE_STRIP_W,
    );
    void seekTimeline(timeSec);
  }, [seekTimeline, timelineScrollLeft, pixelsPerSecond, layout.totalSec]);

  const nativeCursorFromClientX = useCallback((clientX: number) => {
    const el = nativeLanePanelRef.current;
    if (!el) return;
    if (nativeIsDeckStripColumn(clientX, el, LANE_STRIP_W)) {
      setCursor(null);
      return;
    }
    const timeSec = nativeTimeSecFromClientX(
      clientX,
      el,
      timelineScrollLeft,
      pixelsPerSecond,
      layout.totalSec,
      LANE_STRIP_W,
    );
    setCursor(timeSec);
  }, [setCursor, timelineScrollLeft, pixelsPerSecond, layout.totalSec]);

  const nativePointerDown = useCallback((clientX: number, clientY: number) => {
    const el = nativeLanePanelRef.current;
    if (!el) return;
    const stripAction = nativeStripHitTest(
      clientX,
      clientY,
      el,
      LANE_STRIP_W,
      embedLaneYs,
      embedLaneHeights,
    );
    if (stripAction) {
      const i = stripAction.laneIndex;
      const mix = mixes[i] ?? defaultDeckMix();
      switch (stripAction.kind) {
        case "toggleExpand":
          toggleTrackExpanded(i);
          return;
        case "toggleSolo":
          captureUndoState();
          useStudioDeckStore.getState().setMixes({
            ...useStudioDeckStore.getState().mixes,
            [i]: { ...mix, solo: !mix.solo },
          });
          syncSetPreviewMixes();
          return;
        case "toggleCue": {
          captureUndoState();
          const next = { ...useStudioDeckStore.getState().mixes };
          if (!mix.cue) {
            for (const key of Object.keys(next)) {
              const idx = Number(key);
              if (idx !== i && next[idx]?.cue) next[idx] = { ...next[idx], cue: false };
            }
          }
          next[i] = { ...mix, cue: !mix.cue };
          useStudioDeckStore.getState().setMixes(next);
          syncSetPreviewMixes();
          return;
        }
        case "toggleMute":
          captureUndoState();
          useStudioDeckStore.getState().setMixes({
            ...useStudioDeckStore.getState().mixes,
            [i]: { ...mix, mute: !mix.mute },
          });
          syncSetPreviewMixes();
          return;
        case "toggleAutomation":
          captureUndoState();
          useStudioDeckStore.getState().setMixes({
            ...useStudioDeckStore.getState().mixes,
            [i]: { ...mix, showAutomation: !mix.showAutomation },
          });
          return;
        case "select":
          selectLaneCard(i);
          return;
      }
    }
    const hit = nativeClipHitTest(
      clientX,
      clientY,
      el,
      layout.lanes,
      embedLaneYs,
      embedLaneHeights,
      timelineScrollLeft,
      pixelsPerSecond,
      LANE_STRIP_W,
    );
    if (hit) {
      if (timelineSelectedCardId !== hit.lane.card.id) {
        selectLaneCard(hit.laneIndex);
      }
      if (hit.edge === "right") return;
      beginUndoGesture();
      setDragDeltaPx(0);
      setDrag({
        cardId: hit.lane.card.id,
        startClientX: clientX,
        startSec: hit.lane.startSec,
        bpm: hit.lane.entry.bpm ?? 128,
      });
      return;
    }
    const laneIndex = nativeLaneIndexFromClientY(clientY, el, embedLaneYs, embedLaneHeights);
    if (laneIndex != null) selectLaneCard(laneIndex);
  }, [
    layout.lanes,
    embedLaneYs,
    embedLaneHeights,
    timelineScrollLeft,
    pixelsPerSecond,
    timelineSelectedCardId,
    selectLaneCard,
    mixes,
    toggleTrackExpanded,
    syncSetPreviewMixes,
  ]);

  const nativeDragPreview = useMemo(() => {
    if (!drag) return null;
    const laneIndex = layout.lanes.findIndex(l => l.card.id === drag.cardId);
    if (laneIndex < 0) return null;
    return { laneIndex, deltaPx: dragDeltaPx };
  }, [drag, dragDeltaPx, layout.lanes]);

  const nativePlayheadForScene =
    nativeEmbedLive && isPlaying ? nativePlayheadSec : playheadSec;

  const nativeContextMenu = useCallback((clientX: number, clientY: number) => {
    const el = nativeLanePanelRef.current;
    if (!el) return;
    const hit = nativeClipHitTest(
      clientX,
      clientY,
      el,
      layout.lanes,
      embedLaneYs,
      embedLaneHeights,
      timelineScrollLeft,
      pixelsPerSecond,
      LANE_STRIP_W,
    );
    if (!hit) return;
    selectTimelineCard(hit.lane.card.id);
    setClipColorMenu({ x: clientX, y: clientY, cardId: hit.lane.card.id });
  }, [
    layout.lanes,
    embedLaneYs,
    embedLaneHeights,
    timelineScrollLeft,
    pixelsPerSecond,
    selectTimelineCard,
  ]);

  const nativePointerMove = useCallback((clientX: number, clientY: number) => {
    const el = nativeLanePanelRef.current;
    if (!el || drag) return;
    const cursor = nativeIsDeckStripColumn(clientX, el, LANE_STRIP_W)
      ? nativeStripCursor(clientX, clientY, el, LANE_STRIP_W, embedLaneYs, embedLaneHeights)
      : nativeClipCursor(
        clientX,
        clientY,
        el,
        layout.lanes,
        embedLaneYs,
        embedLaneHeights,
        timelineScrollLeft,
        pixelsPerSecond,
        LANE_STRIP_W,
      );
    el.style.cursor = cursor ?? "default";
  }, [layout.lanes, embedLaneYs, embedLaneHeights, timelineScrollLeft, pixelsPerSecond, drag]);

  useNativeTimelineEmbed({
    active: nativeEmbedLive,
    targetRef: nativeLanePanelRef,
    totalSec: layout.totalSec,
    bpm: gridBpm,
    pixelsPerSecond,
    scrollLeft: timelineScrollLeft,
    playheadSec: nativePlayheadForScene,
    cursorSec: hoverTimeSec,
    selectedLaneIndex,
    laneYs,
    laneHeights,
    waveBandHeights,
    laneStackHeight: timelineH,
    laneStripWidth: LANE_STRIP_W,
    deckStrips: nativeDeckStrips,
    automationLanes: nativeAutomationLanes,
    transitions: nativeTransitions,
    lanes: nativeLaneInputs,
    dragPreview: nativeDragPreview,
    locators,
    onSeekAtClientX: nativeSeekFromClientX,
    onCursorAtClientX: nativeCursorFromClientX,
    onPointerDown: nativePointerDown,
    onPointerMove: nativePointerMove,
    onContextMenu: nativeContextMenu,
    onDoubleClick: fitToViewport,
    generation: nativeEmbedGeneration,
  });

  const toggleLaneCard = useCallback((lane: LaneLayout) => {
    const current = useSetBuilderStore.getState().timelineSelectedCardId;
    const next = current === lane.card.id ? null : lane.card.id;
    selectTimelineCard(next);
    if (next) {
      if (lane.index < layout.transitions.length) onSelectTransition(lane.index);
      else if (lane.index > 0) onSelectTransition(lane.index - 1);
    }
  }, [layout.transitions.length, selectTimelineCard, onSelectTransition]);

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

  const applyZoomClick = useCallback((factor: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = readZoomAnchorViewportX();
    const scrollOverride = nativeEmbedLive
      ? useSetTimelineStore.getState().scrollLeft
      : el.scrollLeft;
    if (useSetTimelineStore.getState().zoomAt(factor, anchor, scrollOverride)) {
      if (!nativeEmbedLive) {
        el.scrollLeft = useSetTimelineStore.getState().scrollLeft;
      }
      if (el.clientWidth > 0) setViewportWidth(el.clientWidth);
    }
  }, [readZoomAnchorViewportX, nativeEmbedLive]);

  const zoomIn = useCallback(() => applyZoomClick(ZOOM_BUTTON_FACTOR), [applyZoomClick]);
  const zoomOut = useCallback(() => applyZoomClick(1 / ZOOM_BUTTON_FACTOR), [applyZoomClick]);

  useAutomationRecorder(layout.lanes.length > 0);

  // Engine mix pushes run in useBoothSimulation (engineRoute: "set") — no duplicate RAF here.

  // Keep playhead in view while playing
  useEffect(() => {
    if (!isPlaying) return;
    const el = scrollRef.current;
    if (!el) return;
    const headSec = nativeEmbedLive ? nativePlayheadSec : playheadSec;
    const playheadPx = headSec * pixelsPerSecond;
    const margin = 80;
    const viewLeft = nativeEmbedLive
      ? timelineScrollLeft
      : el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    if (playheadPx < viewLeft + margin || playheadPx > viewRight - margin) {
      const next = Math.max(0, playheadPx - el.clientWidth * 0.35);
      setScrollLeft(next);
      if (!nativeEmbedLive) el.scrollLeft = next;
    }
  }, [playheadSec, nativePlayheadSec, isPlaying, pixelsPerSecond, setScrollLeft, nativeEmbedLive, timelineScrollLeft]);

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

  useEffect(() => {
    loadLocatorsForSet();
  }, [activeSetId, loadLocatorsForSet]);

  useEffect(() => {
    if (!activeSetId) return;
    return bindAutomationToSet(activeSetId);
  }, [activeSetId]);

  useEffect(() => {
    if (!locatorMenu && !clipColorMenu) return;
    const close = () => {
      setLocatorMenu(null);
      setClipColorMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [locatorMenu, clipColorMenu]);

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
  }, [extendedLaneH, layout.lanes.length]);

  // Lane viewport height (for resize in empty area below tracks)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateH = () => setLaneViewportH(Math.max(0, el.clientHeight - BEAT_RULER_H - TIME_RULER_H));
    updateH();
    const ro = new ResizeObserver(updateH);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.totalWidthPx]);

  // Scroll to selected transition — only when selection changes, not on every zoom.
  const prevTransitionIndex = useRef(transitionIndex);
  useEffect(() => {
    if (prevTransitionIndex.current === transitionIndex) return;
    prevTransitionIndex.current = transitionIndex;
    const t = layout.transitions[transitionIndex];
    if (!t || !scrollRef.current) return;
    const next = Math.max(0, t.leftPx - 120);
    scrollRef.current.scrollLeft = next;
    setScrollLeft(next);
  }, [transitionIndex, layout.transitions, setScrollLeft]);

  // Horizontal drag — CSS translate preview; commit on mouseup (engine sync deferred)
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - drag.startClientX;
      setDragDeltaPx(deltaPx);

      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const sl = nativeEmbedLive
          ? useSetTimelineStore.getState().scrollLeft
          : el.scrollLeft;
        if (e.clientX > rect.right - 48) {
          const next = sl + 16;
          setScrollLeft(next);
          if (!nativeEmbedLive) el.scrollLeft = next;
        } else if (e.clientX < rect.left + 48) {
          const next = Math.max(0, sl - 16);
          setScrollLeft(next);
          if (!nativeEmbedLive) el.scrollLeft = next;
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      const deltaSec = pixelsToTimeSec(e.clientX - drag.startClientX, pxPerSecRef.current);
      const raw = Math.max(0, drag.startSec + deltaSec);
      const snapped = snapToBeat(raw, drag.bpm, pxPerSecRef.current);
      setTimelineStart(drag.cardId, snapped);
      endUndoGesture();
      setDrag(null);
      setDragDeltaPx(0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, setTimelineStart, setScrollLeft, nativeEmbedLive]);

  const handleTrackPointerDown = useCallback((lane: LaneLayout, e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    let dragging = false;

    const onMove = (me: MouseEvent) => {
      if (!dragging && Math.abs(me.clientX - startX) > 4) {
        dragging = true;
        const current = useSetBuilderStore.getState().timelineSelectedCardId;
        if (current !== lane.card.id) {
          selectLaneCard(lane.index);
        }
        beginUndoGesture();
        setDragDeltaPx(0);
        setDrag({
          cardId: lane.card.id,
          startClientX: startX,
          startSec: lane.startSec,
          bpm: lane.entry.bpm ?? 128,
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
    };

    const toggleSelect = () => toggleLaneCard(lane);

    const onUp = () => {
      if (!dragging) toggleSelect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [selectLaneCard, toggleLaneCard]);

  if (layout.lanes.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
        Add tracks to build your set arrangement
      </div>
    );
  }

  const totalDur = layout.totalSec;

  const displayPps = pixelsPerSecond;
  const zoomPct = Math.round((displayPps / DEFAULT_PX_PER_SEC) * 100);

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
            onClick={e => { e.stopPropagation(); zoomOut(); }}
            disabled={pixelsPerSecond <= MIN_PX_PER_SEC + 1e-6}
            title="Zoom out (⌘/Ctrl + scroll)"
            style={{
              background: "none", border: "none", color: "#aaa",
              fontSize: 12, fontWeight: 700, width: 22, cursor: "pointer",
              opacity: pixelsPerSecond <= MIN_PX_PER_SEC ? 0.35 : 1,
            }}
          >−</button>
          <span style={{ color: "#666", fontSize: 9, minWidth: 36, textAlign: "center" }}>
            {zoomPct}%
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); zoomIn(); }}
            disabled={pixelsPerSecond >= MAX_PX_PER_SEC - 1e-6}
            title="Zoom in (⌘/Ctrl + scroll)"
            style={{
              background: "none", border: "none", color: "#aaa",
              fontSize: 12, fontWeight: 700, width: 22, cursor: "pointer",
              opacity: pixelsPerSecond >= MAX_PX_PER_SEC ? 0.35 : 1,
            }}
          >+</button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); fitToSet(); }}
            title="Fit entire set in view"
            style={{
              background: "rgba(0,195,255,0.1)", border: "1px solid #00c3ff44",
              borderRadius: 3, color: "#00c3ff", fontSize: 9, fontWeight: 700,
              padding: "2px 8px", cursor: "pointer", marginLeft: 2,
            }}
          >Fit</button>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setNativeGpuActive(v => !v);
              setNativeEmbedGeneration(g => g + 1);
            }}
            title={nativeGpuActive
              ? "Native GPU timeline — toggle off/on to reload embed after updates"
              : "Embed native GPU timeline (Phase 1)"}
            style={{
              background: nativeGpuActive ? "rgba(120,80,255,0.35)" : "rgba(120,80,255,0.12)",
              border: `1px solid ${nativeGpuActive ? "#a78bfa" : "#7850ff55"}`,
              borderRadius: 3, color: "#a78bfa", fontSize: 9, fontWeight: 700,
              padding: "2px 8px", cursor: "pointer", marginLeft: 2,
            }}
          >{nativeGpuActive ? "Native ✓" : "Native"}</button>
        </div>

        <button
          type="button"
          onClick={e => { e.stopPropagation(); addLocator(playheadSec); }}
          title="Set locator at playhead (Ableton Set)"
          style={{
            background: "#222", border: "1px solid #444", borderRadius: 3,
            color: "#c8c850", fontSize: 9, fontWeight: 700,
            padding: "2px 10px", cursor: "pointer",
          }}
        >Set</button>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setKeyMapMode(!keyMapMode); }}
          title="Key Map mode (K) — click locator then press a key"
          style={{
            background: keyMapMode ? "rgba(200,200,80,0.15)" : "#222",
            border: `1px solid ${keyMapMode ? "#c8c85088" : "#444"}`,
            borderRadius: 3,
            color: keyMapMode ? "#c8c850" : "#888",
            fontSize: 9, fontWeight: 700,
            padding: "2px 10px", cursor: "pointer",
          }}
        >KEY</button>
        {keyMapMode && (
          <span style={{ color: "#c8c850", fontSize: 9 }}>
            {pendingKeyMapLocatorId ? "Press a key to bind…" : "Key Map — select locator + key · [ ] prev/next"}
          </span>
        )}

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
      </div>

      <SetAutomationPanel trackCount={layout.lanes.length} />

      <div
        ref={timelineZoneRef}
        style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
      >
      {/* Ableton-style overview navigator — shows zoom window + playhead */}
      <div style={{ height: minimapHeight(layout.lanes.length), flexShrink: 0 }}>
        <SetTimelineNavigator
          lanes={layout.lanes}
          totalSec={totalDur}
          scrollLeft={timelineScrollLeft}
          viewportWidth={viewportWidth}
          pixelsPerSecond={pixelsPerSecond}
          playheadSec={playheadSec}
          transitionIndex={transitionIndex}
          laneColors={laneClipColors}
          leftInset={LANE_STRIP_W}
          onScroll={sl => {
            if (scrollRef.current) scrollRef.current.scrollLeft = sl;
            setScrollLeft(sl);
          }}
          onViewChange={(pps, sl) => {
            useSetTimelineStore.getState().setView(pps, sl);
            if (scrollRef.current) {
              scrollRef.current.scrollLeft = sl;
              setViewportWidth(scrollRef.current.clientWidth);
            }
          }}
          onSeek={t => { void seekTimeline(t); }}
          onLaneClick={i => {
            const lane = layout.lanes[i];
            if (!lane) return;
            const current = useSetBuilderStore.getState().timelineSelectedCardId;
            const next = current === lane.card.id ? null : lane.card.id;
            selectTimelineCard(next);
            if (scrollRef.current) {
              scrollRef.current.scrollLeft = lane.leftPx;
              setScrollLeft(lane.leftPx);
            }
            if (next) {
              if (i < layout.transitions.length) onSelectTransition(i);
              else if (i > 0) onSelectTransition(i - 1);
            }
          }}
        />
      </div>

      {/* Timeline body — unified native panel spans deck strips + timeline when GPU active */}
      <div
        ref={timelineBodyRef}
        style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0, position: "relative" }}
      >
        {/* Deck strips — DOM when native off; GPU draws strips when native on */}
        <div style={{
          width: LANE_STRIP_W,
          flexShrink: 0,
          background: nativeEmbedLive ? "transparent" : STUDIO_SIDEBAR,
          borderRight: nativeEmbedLive ? "none" : `1px solid ${STUDIO_GRID}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            height: BEAT_RULER_H,
            flexShrink: 0,
            borderBottom: `1px solid ${STUDIO_GRID}`,
            background: STUDIO_RULER,
          }} />
          <div style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
            ...(nativeEmbedLive
              ? { flex: "0 0 auto", height: timelineH, maxHeight: timelineH }
              : { flex: 1 }),
          }}>
            <div
              ref={sidebarScrollRef}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: nativeEmbedLive ? timelineH : extendedLaneH,
              }}
            >
              {!nativeEmbedLive && layout.lanes.map((lane, i) => {
                const waveH = getWaveHeight(i);
                const autoH = getAutomationPanelHeight(i);
                const color = laneClipColors[i] ?? resolveCardClipColor(lane.card.clipColor, i);
                const mix = getMix(i);
                const isSelected = lane.card.id === timelineSelectedCardId;

                return (
                  <div key={lane.card.id}>
                    <div
                      style={{
                        position: "absolute",
                        top: laneYs[i],
                        left: 0,
                        right: 0,
                        height: laneHeights[i],
                        borderBottom: i < laneCount - 1 ? `1px solid ${STUDIO_GRID}` : undefined,
                        boxShadow: isSelected ? `inset 0 0 0 1px ${color}88` : undefined,
                      }}
                    >
                      <DJMLaneStrip
                        index={i}
                        entryId={lane.card.entryId}
                        mix={mix}
                        height={laneHeights[i]}
                        selected={isSelected}
                        onSelect={() => selectLaneCard(i)}
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
              {!nativeEmbedLive && laneCount > 0 && extendedLaneH > laneYs[laneCount - 1] + laneHeights[laneCount - 1] && (
                <div
                  data-lane-select
                  onClick={e => {
                    e.stopPropagation();
                    selectLaneCard(laneCount - 1);
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: laneYs[laneCount - 1] + laneHeights[laneCount - 1],
                    height: extendedLaneH - (laneYs[laneCount - 1] + laneHeights[laneCount - 1]),
                    zIndex: 2,
                    cursor: "pointer",
                    boxShadow: layout.lanes[laneCount - 1]?.card.id === timelineSelectedCardId
                      ? `inset 0 0 0 1px ${laneClipColors[laneCount - 1] ?? resolveCardClipColor(layout.lanes[laneCount - 1]?.card.clipColor, laneCount - 1)}66`
                      : undefined,
                  }}
                />
              )}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: extendedLaneH }}>
                <LaneResizeOverlays
                  laneYs={laneYs}
                  laneHeights={laneHeights}
                  laneCount={laneCount}
                  extendedLaneH={extendedLaneH}
                  onResizeStart={startLaneResize}
                />
              </div>
            </div>
          </div>
          <div style={{
            height: TIME_RULER_H,
            flexShrink: 0,
            borderTop: `1px solid ${STUDIO_GRID}`,
            background: STUDIO_RULER,
          }} />
        </div>

        {/* Timeline column — DOM rulers live outside the native GPU embed rect */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          <div style={{
            height: BEAT_RULER_H,
            flexShrink: 0,
            position: "relative",
            zIndex: 15,
            overflow: "hidden",
          }}>
            <SetBeatRuler
              context={timelineContext}
              height={BEAT_RULER_H}
              onPointerDown={rulerMagnify.onRulerPointerDown}
              onPointerMove={rulerMagnify.onRulerPointerMove}
              onPointerUp={rulerMagnify.onRulerPointerUp}
              onPointerCancel={rulerMagnify.onRulerPointerCancel}
              onContextMenu={e => {
                e.preventDefault();
                const el = nativeEmbedHostRef.current ?? scrollRef.current;
                if (!el) return;
                setLocatorMenu({
                  x: e.clientX,
                  y: e.clientY,
                  locatorId: null,
                  timeSec: timelineContext.timeSecFromClientX(e.clientX, el),
                });
              }}
            />
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: BEAT_RULER_H,
              pointerEvents: "none",
              overflow: "visible",
            }}>
              <SetLocatorsLane
                locators={locators}
                pixelsPerSecond={pixelsPerSecond}
                totalSec={totalDur}
                rulerHeight={BEAT_RULER_H}
                selectedId={locatorSelectedId}
                renamingId={locatorRenamingId}
                keyMapMode={keyMapMode}
                onSelect={selectLocator}
                onSeek={t => { void seekTimeline(t); }}
                onMove={(id, t) => updateLocator(id, { timeSec: t })}
                onRename={(id, name) => {
                  updateLocator(id, { name });
                  setRenamingId(null);
                }}
                onAssignKey={requestKeyBinding}
                onCancelRenaming={() => setRenamingId(null)}
                onContextMenu={(id, x, y, timeSec) => {
                  setLocatorMenu({ x, y, locatorId: id, timeSec });
                }}
              />
            </div>
          </div>

          {/* Lane workspace — wave bands in Metal; automation stays in DOM below */}
          <div style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            ...(nativeEmbedLive ? { height: timelineH, maxHeight: timelineH, flex: "0 0 auto" } : {}),
          }}>
          <div
            ref={nativeEmbedHostRef}
            style={{
              ...(nativeEmbedLive
                ? {
                  flex: "0 0 auto",
                  height: timelineH,
                  minHeight: timelineH,
                  maxHeight: timelineH,
                }
                : { flex: 1, minHeight: 0 }),
              minWidth: 0,
              position: "relative",
              pointerEvents: nativeEmbedLive ? "none" : "auto",
              zIndex: nativeEmbedLive ? 1 : 2,
              overflow: "hidden",
            }}
          >
        <div
          ref={scrollRef}
          style={{
            position: "absolute",
            inset: 0,
            overflow: nativeEmbedLive ? "hidden" : "auto",
            background: STUDIO_BG,
            opacity: nativeEmbedLive ? 0 : 1,
            visibility: nativeEmbedLive ? "hidden" : "visible",
            pointerEvents: nativeEmbedLive ? "none" : "auto",
          }}
          onClick={e => {
            if ((e.target as HTMLElement).closest("[data-lane-select]")) return;
            if ((e.target as HTMLElement).closest("[data-lane-resize]")) return;
            if ((e.target as HTMLElement).closest("[data-clip-header]")) return;
            seekFromClientX(e.clientX);
          }}
        >
          <div
            ref={zoomCameraRef}
            style={{
              width: layout.totalWidthPx + 200,
              minHeight: embedAreaH,
              position: "relative",
            }}
          >
            {/* Arrangement workspace — lanes, clips, grid */}
            <div style={{ position: "relative", height: embedAreaH, flexShrink: 0 }}>
              {embedLaneYs.map((y, i) => {
                const rowH = i < laneCount - 1 ? embedLaneHeights[i] : embedAreaH - y;
                const color = laneClipColors[i] ?? resolveCardClipColor(layout.lanes[i]?.card.clipColor, i);
                const isSelected = layout.lanes[i]?.card.id === timelineSelectedCardId;
                return (
                  <div
                    key={`lane-bg-${i}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: y,
                      height: rowH,
                      background: i % 2 === 1 ? "rgba(0,0,0,0.18)" : "transparent",
                      pointerEvents: "none",
                      boxShadow: isSelected ? `inset 0 0 0 1px ${color}88` : undefined,
                    }}
                  />
                );
              })}
              {embedLaneYs.map((y, i) => (
                <div
                  key={`lane-div-${i}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: y + embedLaneHeights[i] - 1,
                    height: 1,
                    background: STUDIO_GRID,
                    pointerEvents: "none",
                  }}
                />
              ))}
              <LaneSelectOverlays
                lanes={layout.lanes}
                laneYs={embedLaneYs}
                laneHeights={embedLaneHeights}
                laneCount={laneCount}
                extendedLaneH={embedAreaH}
                colors={laneClipColors}
                selectedCardId={timelineSelectedCardId}
                onSelectLane={selectLaneCard}
                onSeekAtClientX={seekFromClientX}
              />
              {!nativeEmbedLive && (
              <LaneResizeOverlays
                laneYs={laneYs}
                laneHeights={laneHeights}
                laneCount={laneCount}
                extendedLaneH={extendedLaneH}
                onResizeStart={startLaneResize}
              />
              )}

            {/* Transition regions (blue boxes) — DOM mode only */}
            {!nativeEmbedLive && layout.transitions.map(t => {
              const edge = flowEdges.find(
                e => e.from_id === t.fromEntryId && e.to_id === t.toEntryId,
              );
              const isActive = t.index === transitionIndex;
              return (
                <div
                  key={t.index}
                  onClick={e => {
                    e.stopPropagation();
                    seekFromClientX(e.clientX);
                    onSelectTransition(t.index);
                  }}
                  style={{
                    position: "absolute",
                    left: t.leftPx,
                    top: laneYs[t.index] ?? t.laneAY,
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

            {/* Beat grid — behind clips so lines show through waveform gaps */}
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: embedAreaH,
              pointerEvents: "none",
              zIndex: 4,
            }}>
              <SetBeatTimelineGrid
                context={timelineContext}
                height={embedAreaH}
              />
            </div>

            {/* Track blocks — skip DOM waveforms when native GPU owns rendering */}
            {!nativeEmbedLive && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: timelineH, zIndex: 10 }}>
              {layout.lanes.map((lane, i) => {
                const isDragging = drag?.cardId === lane.card.id;
                const automationExpanded = automationTracks[i]?.expanded ?? false;

                return (
                  <TrackBlock
                    key={lane.card.id}
                    lane={lane}
                    laneIndex={i}
                    laneY={laneYs[i]}
                    laneHeight={laneHeights[i]}
                    automationHeight={getAutomationPanelHeight(i)}
                    automationExpanded={automationExpanded}
                    waveHeight={getWaveHeight(i)}
                    onSplitResize={startSplitResize}
                    color={laneClipColors[i] ?? resolveCardClipColor(lane.card.clipColor, i)}
                    mix={getMix(i)}
                    onMixChange={m => handleMixChange(i, m)}
                    isSelected={i === transitionIndex || i === transitionIndex + 1}
                    isCardSelected={lane.card.id === timelineSelectedCardId}
                    isDragging={isDragging}
                    dragTranslatePx={isDragging ? dragDeltaPx : undefined}
                    pxPerSec={pixelsPerSecond}
                    playheadSec={playheadSec}
                    onHeaderPointerDown={e => handleTrackPointerDown(lane, e)}
                    onHeaderContextMenu={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectTimelineCard(lane.card.id);
                      setClipColorMenu({ x: e.clientX, y: e.clientY, cardId: lane.card.id });
                    }}
                    onSeekAtClientX={seekFromClientX}
                    timelineScrollLeft={timelineScrollLeft}
                    timelineViewportWidth={viewportWidth}
                  />
                );
              })}
            </div>
            )}

            </div>

          </div>
        </div>

            {!nativeEmbedLive && hoverTimeSec !== null && (
              <SetTimelineEditCursor
                timeSec={hoverTimeSec}
                pixelsPerSecond={pixelsPerSecond}
                height={embedAreaH}
              />
            )}

            {!nativeEmbedLive && (
            <div style={{
              position: "absolute",
              left: playheadSec * pixelsPerSecond,
              top: 0,
              height: extendedLaneH,
              width: 1,
              background: "rgba(94,200,232,0.85)",
              zIndex: 30,
              pointerEvents: "none",
              boxShadow: "0 0 6px rgba(94,200,232,0.4)",
            }}>
              <div style={{
                position: "absolute", top: 0, left: -5,
                width: 0, height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "7px solid #5ec8e8",
              }} />
            </div>
            )}
          </div>

          <div style={{
            height: TIME_RULER_H,
            flexShrink: 0,
            zIndex: 15,
            position: "relative",
          }}>
            <SetTimeRuler
              context={timelineContext}
              height={TIME_RULER_H}
            />
          </div>
        </div>

        <div
          ref={nativeLanePanelRef}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: BEAT_RULER_H,
            height: timelineH,
            zIndex: nativeEmbedLive ? 30 : -1,
            pointerEvents: nativeEmbedLive ? "auto" : "none",
            visibility: nativeEmbedLive ? "visible" : "hidden",
          }}
        />
      </div>

      </div>

    </div>

      {clipColorMenu && (
        <ClipColorMenu
          x={clipColorMenu.x}
          y={clipColorMenu.y}
          currentColor={
            layout.lanes.find(l => l.card.id === clipColorMenu.cardId)?.card.clipColor
            ?? laneClipColors[layout.lanes.findIndex(l => l.card.id === clipColorMenu.cardId)]
          }
          onPick={color => setCardClipColor(clipColorMenu.cardId, color)}
          onClose={() => setClipColorMenu(null)}
        />
      )}

      {locatorMenu && (
        <div
          style={{
            position: "fixed",
            left: locatorMenu.x,
            top: locatorMenu.y,
            zIndex: 1000,
            background: "#1a1a1a",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "4px 0",
            minWidth: 140,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {locatorMenu.locatorId ? (
            <>
              <LocatorMenuItem
                label="Rename"
                onClick={() => {
                  setRenamingId(locatorMenu.locatorId);
                  setLocatorMenu(null);
                }}
              />
              <LocatorMenuItem
                label="Delete"
                onClick={() => {
                  removeLocator(locatorMenu.locatorId!);
                  setLocatorMenu(null);
                }}
              />
            </>
          ) : (
            <LocatorMenuItem
              label="Add Locator"
              onClick={() => {
                addLocator(locatorMenu.timeSec);
                setLocatorMenu(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LocatorMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        color: "#ddd",
        fontSize: 11,
        padding: "6px 12px",
        cursor: "pointer",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#333"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
    >
      {label}
    </button>
  );
}
