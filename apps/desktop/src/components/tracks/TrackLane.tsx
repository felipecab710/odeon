/**
 * TrackLane — Ardour-style track row.
 *
 * Layout:  [3px color stripe | 160px strip | flex-1 waveform clip]
 *
 * Strip contains (top→bottom):
 *   • Track name (bold, truncated)
 *   • ● · M · S  —  record dot, mute, solo
 *   • P · A · G  —  playlist, automation, group (decorative for now)
 *   • Mini volume fader  +  dB readout
 *   • Analyze status / button (below fader)
 */
import { useRef, useEffect, useCallback, memo, useState } from "react";
import { markInteraction } from "../../lib/perfDiagnostics";
import { onLayoutResize } from "../../lib/windowShell";
import { TrackViewSelector } from "./TrackViewSelector";
import { TrackHeaderMeter } from "./TrackHeaderMeter";
import { TrackLaneView } from "./TrackLaneView";
import { ClipColorContextMenu, type ClipColorMenuState } from "./ClipColorContextMenu";
import { resolveTrackClipColor } from "../../lib/clipColorPresets";
import { useTrackViewStore } from "../../stores/trackViewStore";
import type { TrackViewMode } from "../../lib/trackView";
import { useProjectStore } from "../../stores/projectStore";
import { seekTimeFromViewportX, useTimelineStore } from "../../stores/timelineStore";
import {
  TRACK_H, CONTROLS_W, TRACK_STRIPE_COLOR, dragSnapIntervalSeconds, snapToGrid, RESIZE_SNAP_PX,
  MIN_TRACK_H, MAX_TRACK_H,
} from "../../lib/timelineUtils";
import { rafThrottle } from "../../lib/rafThrottle";
import type { OdeonTrack } from "@odeon/shared";
import type { PendingTrack } from "../../stores/projectStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useTransportStore } from "../../stores/transportStore";
import { useEngineStore } from "../../stores/engineStore";
import { useTrackGroupStore } from "../../stores/trackGroupStore";
import { engineClient } from "../../lib/engineClient";
import { webAudioEngine, ardourDbToPos, ardourPosToDb } from "../../lib/webAudioEngine";
import {
  PT_SELECT_OUTLINE,
  TL_TRACK_DIVIDER,
} from "../../lib/waveformEngine/colors";

// ── Color palette ─────────────────────────────────────────────────────────────
const STEM_COLORS: Record<string, string> = {
  drums:    "#C0392B",
  bass:     "#D35400",
  vocals:   "#8E44AD",
  music:    "#27AE60",
  other:    "#2980B9",
  fx:       "#16A085",
  full_mix: "#E67E22",
  unknown:  "#7F8C8D",
};
const ROLE_COLORS: Record<string, string> = {
  reference_full_mix: "#E67E22",
  reference_stem:     "#4A90D9",
  user_stem:          "#2ECC71",
  analysis:           "#9B59B6",
};
function trackColor(t: OdeonTrack) {
  return STEM_COLORS[t.stem_type] ?? ROLE_COLORS[t.role] ?? "#888";
}

// ── Ardour-style fader ────────────────────────────────────────────────────────
//
// • Dark track with subtle gradient
// • Filled portion left of the handle
// • Vertical white LINE as the thumb (not a knob)
// • Smooth drag — no jitter, Ardour 8th-power taper
//
function ArdourFader({
  valueDb,
  onChange,
}: {
  valueDb: number;
  onChange: (db: number) => void;
}) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);

  // Ardour fader taper: position → gain → dB
  const pct = Math.max(0, Math.min(1, ardourDbToPos(Math.max(-60, Math.min(6, valueDb)))));

  const updateFromEvent = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const db = Math.max(-60, Math.min(6, ardourPosToDb(p)));
    onChange(Math.round(db * 10) / 10);
  }, [onChange]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = true;
    updateFromEvent(e.clientX);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromEvent(e.clientX); };
    const onUp   = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [updateFromEvent]);

  return (
    <div
      ref={trackRef}
      onMouseDown={onMouseDown}
      className="flex-1 relative cursor-ew-resize select-none"
      style={{ height: 14, borderRadius: 2 }}
      title={`${valueDb.toFixed(1)} dB`}
    >
      {/* Fader track — dark background with subtle inner shadow */}
      <div
        className="absolute inset-0 rounded-sm"
        style={{
          background: "linear-gradient(180deg, #111 0%, #1e1e1e 40%, #181818 100%)",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.8)",
        }}
      />

      {/* Fill — from left to thumb position */}
      <div
        className="absolute top-0 bottom-0 left-0 rounded-l-sm"
        style={{
          width: `${pct * 100}%`,
          background: "linear-gradient(180deg, #444 0%, #333 50%, #2a2a2a 100%)",
          transition: dragging.current ? "none" : "width 0.05s linear",
        }}
      />

      {/* Thumb — thin vertical white line, like Ardour */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: `${pct * 100}%`,
          transform: "translateX(-50%)",
          width: 3,
          borderRadius: 1,
          background: "linear-gradient(180deg, #fff 0%, #ccc 100%)",
          boxShadow: "0 0 4px rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.8)",
          transition: dragging.current ? "none" : "left 0.05s linear",
        }}
      />
    </div>
  );
}

// ── Clip container — delegates lane rendering to TrackLaneView ───────────────
function WaveformClip({
  track,
  isSelected,
  isAnalyzing,
  clipWidth,
  fileLabel,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  waveformHeight,
  cullClipLeft,
  freezeWaveform,
  viewMode,
  clipColor,
}: {
  track: OdeonTrack;
  isSelected: boolean;
  isAnalyzing: boolean;
  clipWidth: number;
  fileLabel: string;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  waveformHeight: number;
  cullClipLeft: number;
  freezeWaveform: boolean;
  viewMode: TrackViewMode;
  clipColor: string;
}) {
  return (
    <div className="absolute inset-0">
      <TrackLaneView
        track={track}
        viewMode={viewMode}
        clipWidth={clipWidth}
        height={waveformHeight}
        pixelsPerSecond={pixelsPerSecond}
        scrollLeft={scrollLeft}
        cullClipLeft={cullClipLeft}
        viewportWidth={viewportWidth}
        freezeWaveform={freezeWaveform}
        fileLabel={fileLabel}
        clipColor={clipColor}
      />
      {isAnalyzing && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: "linear-gradient(90deg,transparent 0%,rgba(77,166,255,0.2) 50%,transparent 100%)",
            animation: "shimmer 1.6s ease-in-out infinite",
          }}
        />
      )}
      {isSelected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 20, boxShadow: `inset 0 0 0 2px ${PT_SELECT_OUTLINE}` }}
        />
      )}
    </div>
  );
}

// ── Pending skeleton lane ─────────────────────────────────────────────────────
export function PendingTrackLane({ pending }: { pending: PendingTrack }) {
  const color = pending.role === "reference" ? "#E67E22" : "#2ECC71";

  return (
    <div
      className="flex items-stretch border-b border-studio-border"
      style={{ height: 80, background: "#252525" }}
    >
      <div className="w-0.5 flex-shrink-0 animate-pulse" style={{ background: TRACK_STRIPE_COLOR }} />

      {/* Ardour-style strip skeleton */}
      <div
        className="flex flex-col justify-center px-2.5 gap-1.5 border-r border-studio-border flex-shrink-0"
        style={{ width: 160, background: "#1e1e1e" }}
      >
        <div className="h-3 w-24 rounded bg-studio-active animate-pulse" />
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-full bg-studio-active animate-pulse" />
          <div className="w-6 h-3.5 rounded bg-studio-active animate-pulse" />
          <div className="w-6 h-3.5 rounded bg-studio-active animate-pulse" />
        </div>
        <span className="text-xxs animate-pulse" style={{ color }}>{pending.operation || "Uploading…"}</span>
      </div>

      {/* Clip skeleton */}
      <div className="flex-1 relative">
        <div
          className="absolute inset-1 overflow-hidden"
          style={{ background: `${color}18`, borderTop: `2px solid ${color}70` }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(90deg,transparent 0%,${color}22 50%,transparent 100%)`,
              animation: "shimmer 1.6s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Real track lane ───────────────────────────────────────────────────────────
export interface TrackLaneProps {
  track: OdeonTrack;
  contentWidth: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  maxDuration: number;
  onSeek: (seconds: number) => void;
}

export const TrackLane = memo(function TrackLane({
  track, contentWidth, pixelsPerSecond, scrollLeft, maxDuration, onSeek,
}: TrackLaneProps) {
  const laneHeight    = useTimelineStore((s) => s.getTrackHeight(track.id));
  const setTrackHeight = useTimelineStore((s) => s.setTrackHeight);
  const selectedTrackId = useSelectionStore((s) => s.selectedTrackId);
  const selectTrack     = useSelectionStore((s) => s.selectTrack);
  const setTrackState   = useEngineStore((s) => s.setTrackState);
  const muted           = useEngineStore((s) => s.trackStates[track.id]?.muted  ?? track.muted);
  const soloed          = useEngineStore((s) => s.trackStates[track.id]?.soloed ?? track.soloed);
  const volDb           = useEngineStore((s) => s.trackStates[track.id]?.volumeDb ?? track.volume_db ?? 0);
  const analyzeTrack  = useProjectStore((s) => s.analyzeTrack);
  const projectBpm    = useProjectStore((s) => s.project?.bpm);
  const setClipStart   = useProjectStore((s) => s.setClipStart);
  const applyClipColor = useTrackGroupStore((s) => s.applyClipColor);
  const setScrollLeft  = useTimelineStore((s) => s.setScrollLeft);
  const setCursor      = useTransportStore((s) => s.setCursor);
  const viewMode       = useTrackViewStore((s) => s.modes[track.id] ?? "waveform");
  const setViewMode    = useTrackViewStore((s) => s.setMode);
  const trackGroup     = useTrackGroupStore((s) => s.groups.find((g) => g.trackIds.includes(track.id)) ?? null);
  const applyGroupedMute  = useTrackGroupStore((s) => s.applyGroupedMute);
  const applyGroupedSolo  = useTrackGroupStore((s) => s.applyGroupedSolo);
  const applyGroupedGain  = useTrackGroupStore((s) => s.applyGroupedGain);
  const openEditDialog    = useTrackGroupStore((s) => s.openEditDialog);

  const clipAreaRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragGrabOffsetSec = useRef(0);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(TRACK_H);
  const frozenCullClipLeft = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [resizePreviewH, setResizePreviewH] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [colorMenu, setColorMenu] = useState<ClipColorMenuState | null>(null);

  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    return onLayoutResize(el, () => setViewportWidth(el.clientWidth));
  }, []);

  const isSelected = selectedTrackId === track.id;
  const clipDuration = track.analysis?.duration_seconds ?? 0;
  const committedClipStart = track.clip_start_seconds ?? 0;
  const committedClipLeft = committedClipStart * pixelsPerSecond;
  const clipWidth = Math.max(48, clipDuration * pixelsPerSecond);
  const displayHeight = resizePreviewH ?? laneHeight;
  const cullClipLeft = isDragging ? frozenCullClipLeft.current : committedClipLeft;

  const isAnalyzing = track.analysis_status === "analyzing";
  const isComplete  = track.analysis_status === "complete";
  const isFailed    = track.analysis_status === "failed";
  const isPending   = track.analysis_status === "pending";
  const isReference = track.role === "reference_full_mix";
  const accentColor = trackColor(track);
  const clipColor   = resolveTrackClipColor(track.color, trackGroup);

  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !muted;
    setTrackState(track.id, { muted: next });
    webAudioEngine.setMute(track.id, next);
    engineClient.muteTrack(track.id, next);
    applyGroupedMute(track.id, next);
  };
  const handleSolo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !soloed;
    setTrackState(track.id, { soloed: next });
    webAudioEngine.setSolo(track.id, next);
    engineClient.soloTrack(track.id, next);
    applyGroupedSolo(track.id, next);
  };
  const handleGroup = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (trackGroup) openEditDialog(trackGroup.id);
  };
  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation();
    analyzeTrack(track.id);
  };

  const contentXFromEvent = (e: { clientX: number }) => {
    const area = clipAreaRef.current;
    if (!area) return 0;
    const rect = area.getBoundingClientRect();
    const sl = useTimelineStore.getState().scrollLeft;
    return sl + (e.clientX - rect.left);
  };

  const computeSnappedClipStart = useCallback((contentX: number) => {
    const mouseTime = contentX / pixelsPerSecond;
    const maxStart = Math.max(0, maxDuration - clipDuration);
    const raw = Math.max(0, Math.min(maxStart, mouseTime - dragGrabOffsetSec.current));
    const interval = dragSnapIntervalSeconds(pixelsPerSecond, projectBpm);
    return snapToGrid(raw, interval);
  }, [pixelsPerSecond, maxDuration, clipDuration, projectBpm]);

  const CLICK_DRAG_THRESHOLD_PX = 4;

  const seekFromClientX = (clientX: number) => {
    const x = clientX - (clipAreaRef.current?.getBoundingClientRect().left ?? 0);
    const t = seekTimeFromViewportX(x, pixelsPerSecond, scrollLeft, maxDuration);
    markInteraction("timeline.seek");
    onSeek(t);
  };

  const handleClipContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setColorMenu({ x: e.clientX, y: e.clientY, trackId: track.id });
  };

  const handleClipMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.stopPropagation();
    selectTrack(track.id);

    const downX = e.clientX;
    const downY = e.clientY;
    const contentX = contentXFromEvent(e);
    dragGrabOffsetSec.current = contentX / pixelsPerSecond - committedClipStart;
    frozenCullClipLeft.current = committedClipLeft;
    let dragStarted = false;

    const beginDrag = () => {
      if (dragStarted) return;
      dragStarted = true;
      markInteraction("clip.drag");
      isDraggingRef.current = true;
      setIsDragging(true);
      const clip = clipRef.current;
      if (clip) {
        clip.style.willChange = "transform";
        clip.style.transform = "translateX(0px)";
      }
    };

    const onMove = rafThrottle((ev: MouseEvent) => {
      if (!dragStarted) {
        if (
          Math.abs(ev.clientX - downX) < CLICK_DRAG_THRESHOLD_PX &&
          Math.abs(ev.clientY - downY) < CLICK_DRAG_THRESHOLD_PX
        ) return;
        beginDrag();
      }
      if (!isDraggingRef.current) return;
      const area = clipAreaRef.current;
      if (area) {
        const rect = area.getBoundingClientRect();
        const sl = useTimelineStore.getState().scrollLeft;
        if (ev.clientX > rect.right - 48) {
          setScrollLeft(sl + 16);
        } else if (ev.clientX < rect.left + 48) {
          setScrollLeft(Math.max(0, sl - 16));
        }
      }
      const cx = (() => {
        const a = clipAreaRef.current;
        if (!a) return 0;
        const r = a.getBoundingClientRect();
        return useTimelineStore.getState().scrollLeft + (ev.clientX - r.left);
      })();
      const snapped = computeSnappedClipStart(cx);
      const deltaPx = (snapped - committedClipStart) * pixelsPerSecond;
      if (clipRef.current) {
        clipRef.current.style.transform = `translateX(${deltaPx}px)`;
      }
    });

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      if (!dragStarted) {
        seekFromClientX(ev.clientX);
        return;
      }

      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);

      const a = clipAreaRef.current;
      const cx = a
        ? useTimelineStore.getState().scrollLeft + (ev.clientX - a.getBoundingClientRect().left)
        : 0;
      const snapped = computeSnappedClipStart(cx);

      if (clipRef.current) {
        clipRef.current.style.willChange = "";
        clipRef.current.style.transform = "";
      }

      setClipStart(track.id, snapped);
      webAudioEngine.setClipStart(track.id, snapped);
      engineClient.addClip(track.id, track.file_path, snapped).catch(() => {});
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-clip]")) return;
    markInteraction("track.select");
    selectTrack(track.id);
    seekFromClientX(e.clientX);
  };

  const handleClipMouseMove = (e: React.MouseEvent) => {
    const x = e.clientX - (clipAreaRef.current?.getBoundingClientRect().left ?? 0);
    const t = seekTimeFromViewportX(x, pixelsPerSecond, scrollLeft, maxDuration);
    setCursor(t, track.id);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    markInteraction("track.resize");

    isResizingRef.current = true;
    resizeStartY.current = e.clientY;
    resizeStartH.current = laneHeight;
    setResizePreviewH(laneHeight);

    const snapResizeHeight = (clientY: number) => {
      const delta = clientY - resizeStartY.current;
      const raw = resizeStartH.current + delta;
      return Math.max(
        MIN_TRACK_H,
        Math.min(MAX_TRACK_H, Math.round(raw / RESIZE_SNAP_PX) * RESIZE_SNAP_PX),
      );
    };

    const onMove = rafThrottle((ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      setResizePreviewH(snapResizeHeight(ev.clientY));
    });

    const onUp = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;

      const snapped = snapResizeHeight(ev.clientY);
      setResizePreviewH(null);
      setTrackHeight(track.id, snapped);

      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const stopLaneBubble = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={laneRef}
      data-track-lane
      className="relative flex items-stretch"
      style={{
        height: displayHeight,
        borderBottom: `1px solid ${TL_TRACK_DIVIDER}`,
      }}
    >
      {/* ── Colour rail (neutral until per-track colour coding) ───────────── */}
      <div className="w-0.5 flex-shrink-0" style={{ background: TRACK_STRIPE_COLOR }} />

      {/* ── Track controls (no timeline hover/resize) ─────────────────────── */}
      <div
        className="flex flex-col justify-between flex-shrink-0 py-1.5 px-2 border-r border-studio-border overflow-hidden"
        style={{ width: CONTROLS_W, background: "#1c1c1c", gap: 2, cursor: "default" }}
        onMouseDown={stopLaneBubble}
        onMouseMove={stopLaneBubble}
        onClick={(e) => {
          stopLaneBubble(e);
          markInteraction("track.select");
          selectTrack(track.id);
        }}
      >
        {/* Row 1 – Track name */}
        <span
          className="font-semibold truncate leading-tight"
          style={{ color: "#e8e8e8", fontSize: 13, lineHeight: 1.2 }}
          title={track.name}
        >
          {track.name}
        </span>

        {/* Row 2 – Track view selector (Pro Tools playlist lane) */}
        <TrackViewSelector
          mode={viewMode}
          onChange={(m) => setViewMode(track.id, m)}
        />

        {/* Row 3 – ● record dot · M · S */}
        <div className="flex items-center gap-1">
          {/* Record-arm dot (decorative) */}
          <div
            className="w-3 h-3 rounded-full border flex-shrink-0"
            style={{ background: "#3a3a3a", borderColor: "#555" }}
          />
          <button
            onClick={handleMute}
            title="Mute"
            className="flex items-center justify-center text-xxs font-bold leading-none select-none transition-colors flex-shrink-0"
            style={{
              width: 22, height: 16, borderRadius: 3,
              background: muted ? "#c0a000" : "#3a3a3a",
              color: muted ? "#000" : "#888",
              border: `1px solid ${muted ? "#a08800" : "#555"}`,
            }}
          >M</button>
          <button
            onClick={handleSolo}
            title="Solo"
            className="flex items-center justify-center text-xxs font-bold leading-none select-none transition-colors flex-shrink-0"
            style={{
              width: 22, height: 16, borderRadius: 3,
              background: soloed ? "#2ecc71" : "#3a3a3a",
              color: soloed ? "#000" : "#888",
              border: `1px solid ${soloed ? "#27ae60" : "#555"}`,
            }}
          >S</button>
          {/* P A G — Ardour-style decorative buttons */}
          {(["P", "A"] as const).map((lbl) => (
            <button
              key={lbl}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center text-xxs font-medium leading-none select-none flex-shrink-0"
              style={{
                width: 18, height: 16, borderRadius: 3,
                background: "#2e2e2e", color: "#666",
                border: "1px solid #444",
              }}
            >{lbl}</button>
          ))}
          <button
            onClick={handleGroup}
            title={trackGroup ? `Group ${trackGroup.name}` : "No group"}
            className="flex items-center justify-center text-xxs font-bold leading-none select-none flex-shrink-0"
            style={{
              width: 18, height: 16, borderRadius: 3,
              background: trackGroup ? `${trackGroup.color}cc` : "#2e2e2e",
              color: trackGroup ? "#1a1a1a" : "#666",
              border: `1px solid ${trackGroup ? trackGroup.color : "#444"}`,
            }}
          >{trackGroup?.name?.[0] ?? "G"}</button>
        </div>

        {/* Row 4 – Ardour fader + dB readout */}
        <div className="flex items-center gap-1.5">
          <ArdourFader
            valueDb={volDb}
            onChange={(db) => {
              const prev = volDb;
              setTrackState(track.id, { volumeDb: db });
              webAudioEngine.setVolume(track.id, db);
              engineClient.setTrackVolume(track.id, db);
              applyGroupedGain(track.id, db, prev);
            }}
          />
          <span className="text-xxs font-mono flex-shrink-0" style={{ color: "#666", minWidth: 32, textAlign: "right" }}>
            {volDb.toFixed(1)}
          </span>
        </div>

        {/* Row 5 – Analyze status */}
        <div className="flex items-center min-h-[14px]">
          {(isPending || isFailed) && (
            <button
              onClick={handleAnalyze}
              className="text-xxs font-semibold px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: `${accentColor}22`,
                border: `1px solid ${accentColor}55`,
                color: accentColor,
              }}
            >
              {isReference ? "⚡ Analyze + Stems" : "⚡ Analyze"}
            </button>
          )}
          {isAnalyzing && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full animate-ping flex-shrink-0" style={{ background: accentColor }} />
              <span className="text-xxs animate-pulse" style={{ color: accentColor }}>
                {isReference ? "Splitting…" : "Analyzing…"}
              </span>
            </div>
          )}
          {isComplete && (
            <div className="flex items-center gap-1">
              <span style={{ color: "#2ecc71", fontSize: 9 }}>✓</span>
              <span className="text-xxs" style={{ color: "#2ecc71" }}>Analyzed</span>
              <button
                onClick={handleAnalyze}
                className="text-xxs ml-1 underline"
                style={{ color: "#666" }}
              >re-run</button>
            </div>
          )}
          {isFailed && <span className="text-xxs" style={{ color: "#e74c3c" }}>✗ failed</span>}
        </div>
      </div>

      {/* ── Stereo meter — own column, isolated from clip hover ────────────── */}
      <TrackHeaderMeter trackId={track.id} />

      {/* ── Timeline clip area (time 0 = left edge) ───────────────────────── */}
      <div
        ref={clipAreaRef}
        className="flex-1 relative overflow-hidden cursor-crosshair group"
        style={{ background: "transparent" }}
        onClick={handleTimelineClick}
        onMouseMove={handleClipMouseMove}
      >
        <div
          className="absolute top-0 bottom-0"
          style={{ width: contentWidth, transform: `translateX(-${scrollLeft}px)` }}
        >
          <div
            ref={clipRef}
            data-clip
            className="absolute top-0 bottom-0"
            style={{
              left: committedClipLeft,
              width: clipWidth,
              cursor: isDragging ? "grabbing" : "grab",
              boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,0.45)" : undefined,
              zIndex: isDragging ? 2 : 1,
            }}
            onMouseDown={handleClipMouseDown}
            onContextMenu={handleClipContextMenu}
          >
            <WaveformClip
              track={track}
              isSelected={isSelected}
              isAnalyzing={isAnalyzing}
              clipWidth={clipWidth}
              fileLabel={track.file_path?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? track.name}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeft={scrollLeft}
              cullClipLeft={cullClipLeft}
              viewportWidth={viewportWidth}
              waveformHeight={displayHeight}
              freezeWaveform={isDragging}
              viewMode={viewMode}
              clipColor={clipColor}
            />
          </div>
        </div>

        <ClipColorContextMenu
          menu={colorMenu}
          currentColor={clipColor}
          onSelect={(id, color) => applyClipColor(id, color)}
          onClose={() => setColorMenu(null)}
        />

        {/* Resize handle — clip area only, not over meter/controls */}
        <div
          className="absolute left-0 right-0 bottom-0 z-10"
          style={{ height: 5, cursor: "ns-resize" }}
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize track height"
        >
          <div
            className="absolute left-1/2 bottom-0 -translate-x-1/2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ width: 32, height: 3, background: "#555" }}
          />
        </div>
      </div>
    </div>
  );
});
