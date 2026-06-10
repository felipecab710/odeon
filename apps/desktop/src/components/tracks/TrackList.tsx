import { useRef, useState, useEffect, useCallback, useMemo, memo } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";
import { useTimelineStore, seekTimeFromViewportX } from "../../stores/timelineStore";
import { TrackLane, PendingTrackLane } from "./TrackLane";
import { TrackGroupColumn } from "./TrackGroupColumn";
import { TrackGroupEditDialog } from "./TrackGroupEditDialog";
import { TimelineGrid } from "./TimelineGrid";
import {
  TL_CANVAS_BG, TL_TRACK_DIVIDER, TL_VOID_BG, TL_TRACK_LIST_BG,
} from "../../lib/waveformEngine/colors";
import {
  GROUP_COL_W, HEADER_W, TRACK_H, RULER_H, sessionDurationSeconds, contentWidthPx, tickInterval, timeToPx,
} from "../../lib/timelineUtils";
import { useSelectionStore } from "../../stores/selectionStore";
import { onLayoutResize } from "../../lib/windowShell";
import { markZoomActivity } from "../../lib/zoomInteraction";
import { wheelStepsFromEvent, zoomMultiplierFromSteps } from "../../lib/timelineViewportZoom";
import type { OdeonTrack } from "@odeon/shared";
import type { PendingTrack } from "../../stores/projectStore";

const AUDIO_EXTS = /\.(wav|mp3|flac|aiff?|ogg|m4a)$/i;
const VIRTUAL_OVERSCAN = 3;

function buildRowLayout(
  tracks: OdeonTrack[],
  pending: PendingTrack[],
  getHeight: (id: string) => number,
) {
  const rows: { id: string; top: number; height: number; kind: "track" | "pending" }[] = [];
  let y = 0;
  for (const t of tracks) {
    const h = getHeight(t.id);
    rows.push({ id: t.id, top: y, height: h, kind: "track" });
    y += h;
  }
  for (const p of pending) {
    rows.push({ id: p.id, top: y, height: TRACK_H, kind: "pending" });
    y += TRACK_H;
  }
  return { rows, totalHeight: y };
}

function AddTrackAffordance({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      onDoubleClick={onAdd}
      className="flex flex-col items-center gap-2 px-2 py-3 w-full transition-opacity hover:opacity-100 opacity-60"
      style={{ color: "#888", background: "none", border: "none", cursor: "pointer" }}
      title="Add track — click to import audio"
    >
      <span
        className="flex items-center justify-center rounded-sm"
        style={{
          width: 28, height: 28,
          border: "1px solid #444",
          background: "#252525",
          fontSize: 20, lineHeight: 1, color: "#aaa",
        }}
      >
        +
      </span>
      <span className="text-center leading-snug" style={{ fontSize: 9, color: "#666", maxWidth: 140 }}>
        Click or double-click to add a track
      </span>
    </button>
  );
}

function fmtTimecode(s: number) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs  = Math.floor((s % 1) * 100);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function fmtShort(s: number) {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const PLAYHEAD_COLOR = "#f2f2f2";

const RulerPlayheadLabel = memo(function RulerPlayheadLabel({ pps }: { pps: number }) {
  const positionSeconds = useTransportStore((s) => s.positionSeconds);
  const left = timeToPx(positionSeconds, pps);
  return (
    <div
      className="absolute top-0 flex items-center pointer-events-none"
      style={{ left, transform: "translateX(-50%)" }}
    >
      <span className="text-xxs font-mono px-0.5 rounded" style={{ color: PLAYHEAD_COLOR, fontSize: 9, background: "rgba(0,0,0,0.5)" }}>
        {fmtTimecode(positionSeconds)}
      </span>
    </div>
  );
});

const RulerPlayheadChrome = memo(function RulerPlayheadChrome({ pps }: { pps: number }) {
  const positionSeconds = useTransportStore((s) => s.positionSeconds);
  const left = timeToPx(positionSeconds, pps);
  return (
    <>
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left, width: 1, background: `${PLAYHEAD_COLOR}cc` }} />
      <div
        className="absolute bottom-0 pointer-events-none"
        style={{
          left, transform: "translateX(-50%)",
          width: 0, height: 0,
          borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
          borderTop: `6px solid ${PLAYHEAD_COLOR}`,
        }}
      />
    </>
  );
});

const CanvasPlayhead = memo(function CanvasPlayhead({ pps }: { pps: number }) {
  const positionSeconds = useTransportStore((s) => s.positionSeconds);
  const left = timeToPx(positionSeconds, pps);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-25"
      style={{ left, width: 1, background: PLAYHEAD_COLOR, opacity: 0.95, boxShadow: "0 0 4px rgba(255,255,255,0.35)" }}
    />
  );
});

const RulerCursorChrome = memo(function RulerCursorChrome({ pps }: { pps: number }) {
  const cursorSeconds = useTransportStore((s) => s.cursorSeconds);
  const left = timeToPx(cursorSeconds, pps);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-10"
      style={{ left, width: 1, background: "#4A90D9", opacity: 0.7 }}
    />
  );
});

const CanvasCursor = memo(function CanvasCursor({ pps }: { pps: number }) {
  const cursorSeconds = useTransportStore((s) => s.cursorSeconds);
  const left = timeToPx(cursorSeconds, pps);
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-15"
      style={{ left, width: 1, background: "#4A90D9", opacity: 0.55 }}
    />
  );
});

export function TrackList() {
  const { project, pendingTracks, uploadReference, uploadUserStems } = useProjectStore();
  const seek = useTransportStore((s) => s.seek);
  const setCursor = useTransportStore((s) => s.setCursor);
  const pixelsPerSecond = useTimelineStore((s) => s.pixelsPerSecond);
  const scrollLeft      = useTimelineStore((s) => s.scrollLeft);
  const setScrollLeft   = useTimelineStore((s) => s.setScrollLeft);
  const zoomAt          = useTimelineStore((s) => s.zoomAt);
  const getTrackHeight  = useTimelineStore((s) => s.getTrackHeight);
  const trackHeights    = useTimelineStore((s) => s.trackHeights);
  const selectedTrackId = useSelectionStore((s) => s.selectedTrackId);
  const selectTrack     = useSelectionStore((s) => s.selectTrack);
  const deleteTrack     = useProjectStore((s) => s.deleteTrack);

  // Auto-select first track when project loads
  useEffect(() => {
    const tracks = project?.tracks ?? [];
    if (tracks.length > 0 && !selectedTrackId) {
      selectTrack(tracks[0].id);
    }
    if (tracks.length > 0 && selectedTrackId && !tracks.some((t) => t.id === selectedTrackId)) {
      selectTrack(tracks[0].id);
    }
  }, [project?.tracks, selectedTrackId, selectTrack]);

  // Delete selected track with Delete / Backspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      ) return;
      if (!selectedTrackId) return;
      e.preventDefault();
      void deleteTrack(selectedTrackId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTrackId, deleteTrack]);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const dragCounter = useRef(0);
  const vScrollRef  = useRef<HTMLDivElement>(null);
  const rulerRef    = useRef<HTMLDivElement>(null);
  const cursorRaf   = useRef<number | null>(null);
  const zoomRaf        = useRef<number | null>(null);
  const wheelStepsAccum = useRef(0);
  const wheelAnchorRef  = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxDuration  = sessionDurationSeconds(project?.tracks ?? []);
  const contentWidth = contentWidthPx(maxDuration, pixelsPerSecond);
  const tickStep = tickInterval(maxDuration, pixelsPerSecond);
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= maxDuration; t += tickStep) arr.push(t);
    return arr;
  }, [maxDuration, tickStep]);

  const handleSeek = useCallback((t: number) => { void seek(t); }, [seek]);

  const seekFromClientX = useCallback((clientX: number, timelineLeft: number) => {
    const timelineX = clientX - timelineLeft;
    if (timelineX <= 0) return;
    const t = seekTimeFromViewportX(timelineX, pixelsPerSecond, scrollLeft, maxDuration);
    handleSeek(t);
  }, [pixelsPerSecond, scrollLeft, maxDuration, handleSeek]);

  const moveCursorFromTimelineX = useCallback((timelineX: number, trackId: string | null = null) => {
    if (timelineX <= 0) return;
    const t = seekTimeFromViewportX(timelineX, pixelsPerSecond, scrollLeft, maxDuration);
    if (cursorRaf.current !== null) cancelAnimationFrame(cursorRaf.current);
    cursorRaf.current = requestAnimationFrame(() => {
      cursorRaf.current = null;
      setCursor(t, trackId);
    });
  }, [pixelsPerSecond, scrollLeft, maxDuration, setCursor]);

  const handleRulerMouseMove = useCallback((e: React.MouseEvent) => {
    const el = rulerRef.current;
    if (!el) return;
    moveCursorFromTimelineX(e.clientX - el.getBoundingClientRect().left, null);
  }, [moveCursorFromTimelineX]);

  const flushZoom = useCallback(() => {
    zoomRaf.current = null;
    const steps = wheelStepsAccum.current;
    wheelStepsAccum.current = 0;
    if (Math.abs(steps) < 1e-6) return;
    markZoomActivity();
    zoomAt(zoomMultiplierFromSteps(steps), wheelAnchorRef.current);
  }, [zoomAt]);

  const handleTimelineWheel = useCallback((e: React.WheelEvent, viewportEl: HTMLElement) => {
    const rect = viewportEl.getBoundingClientRect();
    const anchorViewportX = e.clientX - rect.left;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      wheelAnchorRef.current = anchorViewportX;
      wheelStepsAccum.current += wheelStepsFromEvent(e.nativeEvent);
      if (zoomRaf.current === null) {
        zoomRaf.current = requestAnimationFrame(flushZoom);
      }
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      setScrollLeft(scrollLeft + e.deltaY);
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setScrollLeft(scrollLeft + e.deltaX);
    }
  }, [scrollLeft, setScrollLeft, flushZoom]);

  useEffect(() => () => {
    if (zoomRaf.current !== null) cancelAnimationFrame(zoomRaf.current);
  }, []);

  const handleRulerClick = (e: React.MouseEvent) => {
    const el = rulerRef.current;
    if (!el) return;
    seekFromClientX(e.clientX, el.getBoundingClientRect().left);
  };

  const handleVoidTimelineClick = useCallback((e: React.MouseEvent) => {
    const area = vScrollRef.current;
    if (!area) return;
    seekFromClientX(e.clientX, area.getBoundingClientRect().left + HEADER_W);
  }, [seekFromClientX]);

  const importGuard = useRef(false);
  const tauriDropActive = useRef(false);

  const handleFiles = useCallback((files: File[]) => {
    if (importGuard.current) return;
    const audio = files.filter((f) => f.type.startsWith("audio/") || AUDIO_EXTS.test(f.name));
    if (!audio.length) return;

    importGuard.current = true;
    const release = () => { importGuard.current = false; };

    const hasRef = project?.tracks.some(
      (t) => t.role === "reference_full_mix" || t.role === "reference_stem"
    );
    const run = async () => {
      try {
        if (!hasRef) {
          const [ref, ...rest] = audio;
          await uploadReference(ref);
          if (rest.length) await uploadUserStems(rest);
        } else {
          await uploadUserStems(audio);
        }
      } finally {
        release();
      }
    };
    void run();
  }, [project?.tracks, uploadReference, uploadUserStems]);

  // Tauri OS-level file drop (desktop only) — register once per project
  useEffect(() => {
    let cancelled = false;
    let unsubHover: (() => void) | null = null;
    let unsubDrop: (() => void) | null = null;
    let unsubCancel: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;

        tauriDropActive.current = true;

        unsubHover = await listen<string[]>("file-drop:hover", (ev) => {
          if (ev.payload.some((p) => AUDIO_EXTS.test(p))) setIsDraggingOver(true);
        });
        unsubDrop = await listen<string[]>("file-drop:dropped", async (ev) => {
          if (cancelled) return;
          setIsDraggingOver(false);
          const audioPaths = ev.payload.filter((p) => AUDIO_EXTS.test(p));
          if (!audioPaths.length) return;
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const files = (
            await Promise.all(
              audioPaths.map(async (fp) => {
                try {
                  const b = await readFile(fp);
                  return new File([b], fp.split("/").pop() ?? "audio");
                } catch { return null; }
              })
            )
          ).filter(Boolean) as File[];
          handleFiles(files);
        });
        unsubCancel = await listen("file-drop:cancel", () => setIsDraggingOver(false));

        if (cancelled) {
          unsubHover?.(); unsubDrop?.(); unsubCancel?.();
        }
      } catch {
        tauriDropActive.current = false;
      }
    };
    void setup();

    return () => {
      cancelled = true;
      tauriDropActive.current = false;
      unsubHover?.(); unsubDrop?.(); unsubCancel?.();
    };
  }, [project?.id, handleFiles]);

  useEffect(() => {
    const el = vScrollRef.current;
    if (!el) return;
    return onLayoutResize(el, () => setViewportH(el.clientHeight));
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  };
  const handleDragLeave = () => { if (--dragCounter.current === 0) setIsDraggingOver(false); };
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const handleDrop      = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setIsDraggingOver(false);
    // Tauri forwards OS drops via file-drop:dropped — skip HTML5 path to avoid double import
    if (tauriDropActive.current) return;
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const allTracks = [...(project?.tracks ?? [])];
  const hasTracks = allTracks.length > 0 || pendingTracks.length > 0;

  // Variable-height row layout (trackHeights triggers recompute)
  const { rows, totalHeight } = buildRowLayout(allTracks, pendingTracks, getTrackHeight);
  void trackHeights;

  const visTop = scrollTop - VIRTUAL_OVERSCAN * TRACK_H;
  const visBot = scrollTop + viewportH + VIRTUAL_OVERSCAN * TRACK_H;
  const visibleRows = rows.filter((r) => r.top + r.height > visTop && r.top < visBot);
  const topPad = visibleRows.length > 0 ? visibleRows[0].top : 0;

  const visibleTracks = visibleRows
    .filter((r) => r.kind === "track")
    .map((r) => allTracks.find((t) => t.id === r.id)!)
    .filter(Boolean);
  const visiblePending = visibleRows
    .filter((r) => r.kind === "pending")
    .map((r) => pendingTracks.find((p) => p.id === r.id)!)
    .filter(Boolean);

  const MIN_VOID_H = 120;
  const voidHeight = Math.max(MIN_VOID_H, viewportH - totalHeight);
  const canvasHeight = totalHeight + voidHeight;

  const trackIdAtContentY = useCallback((contentY: number): string | null => {
    if (contentY < 0 || contentY >= totalHeight) return null;
    const row = rows.find((r) => contentY >= r.top && contentY < r.top + r.height);
    return row?.kind === "track" ? row.id : null;
  }, [rows, totalHeight]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const area = vScrollRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const contentY = e.clientY - rect.top + area.scrollTop;
    moveCursorFromTimelineX(
      e.clientX - rect.left - HEADER_W,
      trackIdAtContentY(contentY),
    );
  }, [moveCursorFromTimelineX, trackIdAtContentY]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) handleFiles(files);
    e.target.value = "";
  }, [handleFiles]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden select-none" style={{ background: "#2e2e2e" }}>

      {/* ── Ruler ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex border-b border-studio-border" style={{ height: RULER_H, background: "#1e1e1e" }}>
        <div
          className="flex-shrink-0 flex border-r border-studio-border"
          style={{ width: HEADER_W, background: "#1e1e1e" }}
        >
          <div
            className="flex-shrink-0"
            style={{
              width: GROUP_COL_W,
              background: "#000",
              borderRight: "1px solid #2a2a2a",
              boxShadow: "1px 0 0 #3a3a3a",
            }}
          />
          <div className="flex-1 flex items-end px-2 pb-0.5">
            <span className="text-xxs uppercase tracking-widest" style={{ color: "#555" }}>Tracks</span>
          </div>
        </div>

        <div
          ref={rulerRef}
          className="flex-1 relative overflow-hidden cursor-crosshair"
          onClick={handleRulerClick}
          onMouseMove={handleRulerMouseMove}
          onWheel={(e) => handleTimelineWheel(e, e.currentTarget)}
        >
          <div
            className="absolute top-0 bottom-0 flex flex-col"
            style={{ width: contentWidth, transform: `translateX(-${scrollLeft}px)` }}
          >
            <div className="flex-1 relative border-b" style={{ borderColor: "#2a2a2a" }}>
              <span className="absolute left-1 top-0 bottom-0 flex items-center text-xxs font-mono z-10" style={{ color: "#555" }}>
                Mins:Secs
              </span>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 flex items-center" style={{ left: timeToPx(t, pixelsPerSecond) }}>
                  <div className="w-px h-2.5" style={{ background: "#3a3a3a" }} />
                  <span className="text-xxs font-mono ml-0.5 whitespace-nowrap" style={{ color: "#777", fontSize: 10 }}>
                    {fmtShort(t)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex-1 relative">
              <span className="absolute left-1 top-0 bottom-0 flex items-center text-xxs font-mono z-10" style={{ color: "#555" }}>
                Timecode
              </span>
              {ticks.map((t) => {
                const half = t + tickStep / 2;
                if (half > maxDuration) return null;
                return (
                  <div
                    key={`h-${t}`}
                    className="absolute"
                    style={{ left: timeToPx(half, pixelsPerSecond), top: 4, height: 6, width: 1, background: "#2e2e2e" }}
                  />
                );
              })}
              <RulerPlayheadLabel pps={pixelsPerSecond} />
            </div>
            <RulerCursorChrome pps={pixelsPerSecond} />
            <RulerPlayheadChrome pps={pixelsPerSecond} />
          </div>
        </div>
      </div>

      {/* ── Track canvas ───────────────────────────────────────────────────── */}
      <div
        ref={vScrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        style={{ background: TL_CANVAS_BG }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onWheel={(e) => {
          const target = e.currentTarget;
          if (e.ctrlKey || e.metaKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            handleTimelineWheel(e, target);
          }
        }}
        onMouseMove={handleCanvasMouseMove}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.ogg,.m4a"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        {isDraggingOver && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none"
            style={{ background: "rgba(74,144,217,0.07)", border: "2px dashed #4A90D966" }}
          >
            <div className="text-sm font-medium" style={{ color: "#4A90D9" }}>Drop audio files to import</div>
          </div>
        )}

        <div className="relative" style={{ minHeight: canvasHeight }}>
          {/* Black group strip — full panel height, Pro Tools–style */}
          <div className="absolute top-0 left-0 z-15 pointer-events-auto" style={{ height: canvasHeight }}>
            {hasTracks ? (
              <TrackGroupColumn rows={rows} height={canvasHeight} trackAreaHeight={totalHeight} />
            ) : (
              <div
                style={{
                  width: GROUP_COL_W,
                  height: "100%",
                  background: "#000",
                  borderRight: "1px solid #2a2a2a",
                  boxShadow: "1px 0 0 #3a3a3a",
                }}
              />
            )}
          </div>

          {/* Grid — active track lanes only */}
          {hasTracks && (
            <div
              className="absolute top-0 z-0"
              style={{ left: HEADER_W, right: 0, height: totalHeight }}
            >
              <TimelineGrid
                contentWidth={contentWidth}
                height={totalHeight}
                maxDuration={maxDuration}
                pixelsPerSecond={pixelsPerSecond}
                scrollLeft={scrollLeft}
              />
            </div>
          )}

          {/* Playhead + hover cursor — full timeline column */}
          <div
            className="absolute top-0 overflow-hidden pointer-events-none z-20"
            style={{ left: HEADER_W, right: 0, height: canvasHeight }}
          >
            <div
              style={{
                width: contentWidth,
                height: "100%",
                transform: `translateX(-${scrollLeft}px)`,
                position: "relative",
              }}
            >
              <CanvasCursor pps={pixelsPerSecond} />
              <CanvasPlayhead pps={pixelsPerSecond} />
            </div>
          </div>

          {/* Track lanes */}
          {hasTracks && (
            <div className="relative z-10" style={{ marginLeft: GROUP_COL_W, minHeight: totalHeight, paddingTop: topPad }}>
              {visibleTracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  contentWidth={contentWidth}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollLeft={scrollLeft}
                  maxDuration={maxDuration}
                  onSeek={handleSeek}
                />
              ))}
              {visiblePending.map((p) => (
                <PendingTrackLane key={p.id} pending={p} />
              ))}
            </div>
          )}

          {/* Below tracks — left panel + dark timeline void (fills to bottom) */}
          <div className="flex" style={{ minHeight: hasTracks ? voidHeight : canvasHeight }}>
            <div
              className="flex flex-col items-center justify-end flex-shrink-0 border-r"
              style={{
                width: HEADER_W,
                minHeight: "100%",
                background: TL_TRACK_LIST_BG,
                borderColor: TL_TRACK_DIVIDER,
                paddingLeft: GROUP_COL_W,
              }}
            >
              <AddTrackAffordance onAdd={openFilePicker} />
            </div>
            <div
              className="flex-1 flex items-center justify-center cursor-crosshair"
              style={{ minHeight: "100%", background: TL_VOID_BG }}
              onClick={handleVoidTimelineClick}
            >
              {!hasTracks && (
                <div className="text-sm pointer-events-none" style={{ color: "#555" }}>
                  Drop audio files onto the canvas
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <TrackGroupEditDialog />
    </div>
  );
}
