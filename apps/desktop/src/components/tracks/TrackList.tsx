import { useRef, useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";
import { TrackLane, PendingTrackLane } from "./TrackLane";

const HEADER_W   = 160;   // must match TrackLane strip width
const TRACK_H    = 80;
const RULER_H    = 40;
const AUDIO_EXTS = /\.(wav|mp3|flac|aiff?|ogg|m4a)$/i;

/** 0:00:05.00 Ardour-style timecode */
function fmtTimecode(s: number) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs  = Math.floor((s % 1) * 100);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Short label: 0:05 */
function fmtShort(s: number) {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TrackList() {
  const { project, pendingTracks, uploadReference, uploadUserStems } = useProjectStore();
  const { positionSeconds } = useTransportStore();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null); // px within clip area
  const dragCounter = useRef(0);
  const scrollRef   = useRef<HTMLDivElement>(null);

  const maxDuration = Math.max(
    120,
    ...(project?.tracks.map((t) => t.analysis?.duration_seconds ?? 0).filter(Boolean) ?? [])
  );

  // ── Handle files ─────────────────────────────────────────────────────────
  const handleFiles = (files: File[]) => {
    const audio = files.filter((f) => f.type.startsWith("audio/") || AUDIO_EXTS.test(f.name));
    if (!audio.length) return;
    const hasRef = project?.tracks.some(
      (t) => t.role === "reference_full_mix" || t.role === "reference_stem"
    );
    if (!hasRef) {
      const [ref, ...rest] = audio;
      uploadReference(ref);
      if (rest.length) uploadUserStems(rest);
    } else {
      uploadUserStems(audio);
    }
  };

  // ── Tauri native file-drop ────────────────────────────────────────────────
  useEffect(() => {
    let unsubHover:  (() => void) | null = null;
    let unsubDrop:   (() => void) | null = null;
    let unsubCancel: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unsubHover  = await listen<string[]>("file-drop:hover", (e) => {
          if (e.payload.some((p) => AUDIO_EXTS.test(p))) setIsDraggingOver(true);
        });
        unsubDrop   = await listen<string[]>("file-drop:dropped", async (e) => {
          setIsDraggingOver(false);
          const audioPaths = e.payload.filter((p) => AUDIO_EXTS.test(p));
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
      } catch { /* browser mode */ }
    };
    setup();
    return () => { unsubHover?.(); unsubDrop?.(); unsubCancel?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.tracks?.length]);

  // HTML5 drag fallback (browser dev-mode)
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  };
  const handleDragLeave = () => { if (--dragCounter.current === 0) setIsDraggingOver(false); };
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const handleDrop      = (e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setIsDraggingOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const allTracks = [...(project?.tracks ?? [])];
  const hasTracks = allTracks.length > 0 || pendingTracks.length > 0;

  // Ruler ticks
  const tickInterval = maxDuration <= 60 ? 5 : maxDuration <= 300 ? 10 : maxDuration <= 600 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= maxDuration; t += tickInterval) ticks.push(t);

  // Playhead offset — only within the clip area (right of header)
  const playheadPct  = Math.min(100, (positionSeconds / maxDuration) * 100);

  return (
    <div className="flex flex-col flex-1 overflow-hidden select-none" style={{ background: "#2e2e2e" }}>

      {/* ── Ardour-style two-row ruler ──────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex border-b border-studio-border"
        style={{ height: RULER_H, background: "#1e1e1e" }}
      >
        {/* Left strip header */}
        <div
          className="flex-shrink-0 flex items-end border-r border-studio-border px-2 pb-0.5"
          style={{ width: HEADER_W + 1, background: "#1e1e1e" }}
        >
          <span className="text-xxs uppercase tracking-widest" style={{ color: "#555" }}>Tracks</span>
        </div>

        {/* Timeline ruler */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {/* Top row — Mins:Secs */}
          <div
            className="flex-1 relative border-b"
            style={{ borderColor: "#2a2a2a" }}
          >
            <span className="absolute left-1 top-0 bottom-0 flex items-center text-xxs font-mono" style={{ color: "#555" }}>
              Mins:Secs
            </span>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 bottom-0 flex items-center"
                style={{ left: `${(t / maxDuration) * 100}%` }}
              >
                <div className="w-px h-2.5" style={{ background: "#3a3a3a" }} />
                <span
                  className="text-xxs font-mono ml-0.5 whitespace-nowrap"
                  style={{ color: "#777", fontSize: 10 }}
                >
                  {fmtShort(t)}
                </span>
              </div>
            ))}
          </div>

          {/* Bottom row — Timecode */}
          <div className="flex-1 relative">
            <span className="absolute left-1 top-0 bottom-0 flex items-center text-xxs font-mono" style={{ color: "#555" }}>
              Timecode
            </span>
            {ticks.map((t) => {
              const half = t + tickInterval / 2;
              if (half > maxDuration) return null;
              return (
                <div
                  key={`h-${t}`}
                  className="absolute"
                  style={{ left: `${(half / maxDuration) * 100}%`, top: 4, height: 6, width: 1, background: "#2e2e2e" }}
                />
              );
            })}
            {/* Playhead timecode label */}
            <div
              className="absolute top-0 flex items-center pointer-events-none"
              style={{ left: `${playheadPct}%`, transform: "translateX(-50%)" }}
            >
              <span className="text-xxs font-mono px-0.5 rounded" style={{ color: "#E84C3D", fontSize: 9, background: "rgba(0,0,0,0.5)" }}>
                {fmtTimecode(positionSeconds)}
              </span>
            </div>
          </div>

          {/* Playhead ruler line + caret */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${playheadPct}%`, width: 1, background: "#E84C3D88" }}
          />
          <div
            className="absolute bottom-0 pointer-events-none"
            style={{
              left: `${playheadPct}%`,
              transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: "6px solid #E84C3D",
            }}
          />
        </div>
      </div>

      {/* ── Track canvas ─────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative"
        style={{ background: "#3a3a3a" }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onMouseMove={(e) => {
          const rect = scrollRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left - (HEADER_W + 1);
          if (x > 0) setHoverX(x);
          else setHoverX(null);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* Drop overlay */}
        {isDraggingOver && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none"
            style={{ background: "rgba(74,144,217,0.07)", border: "2px dashed #4A90D966", boxSizing: "border-box" }}
          >
            <div className="text-2xl mb-1.5 opacity-40">♪</div>
            <div className="text-sm font-medium" style={{ color: "#4A90D9" }}>Drop audio files to import</div>
            <div className="text-xs mt-0.5" style={{ color: "#555" }}>WAV · MP3 · FLAC · AIFF</div>
          </div>
        )}

        {/* Empty state — keep left panel visible */}
        {!hasTracks && (
          <div className="relative flex" style={{ minHeight: "100%" }}>
            {/* Left panel column always present */}
            <div className="flex-shrink-0 border-r" style={{ width: HEADER_W + 1, background: "#252525", borderColor: "#2a2a2a", minHeight: "100%" }} />
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20" style={{ color: "#555" }}>
              <div className="text-5xl opacity-10">♪</div>
              <div className="text-center">
                <div className="text-sm mb-1" style={{ color: "#666" }}>Drop audio files onto the canvas</div>
                <div className="text-xs">or use Upload Reference above</div>
              </div>
              <div className="px-4 py-2 rounded text-xs border-dashed" style={{ border: "1px dashed #3a3a3a", color: "#555" }}>
                WAV · MP3 · FLAC · AIFF
              </div>
            </div>
          </div>
        )}

        {/* Track rows */}
        {hasTracks && (
          <div className="relative flex" style={{ minHeight: "100%" }}>
            {/* Persistent left panel column — extends to bottom */}
            <div
              className="absolute top-0 bottom-0 left-0 flex-shrink-0 border-r"
              style={{ width: HEADER_W + 1, background: "#252525", borderColor: "#2a2a2a", zIndex: 0 }}
            />

            <div className="relative w-full">
            {/* Playhead full-height line */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-10"
              style={{
                // position playhead only within the clip area (right of header)
                left: `calc(${HEADER_W + 1}px + ${playheadPct}% * (100% - ${HEADER_W + 1}px) / 100)`,
                width: 1,
                background: "#E84C3D",
                opacity: 0.8,
              }}
            />

            {/* Hover cursor line — blue, follows mouse in the clip area */}
            {hoverX !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-10"
                style={{
                  left: HEADER_W + 1 + hoverX,
                  width: 1,
                  background: "#4A90D9",
                  opacity: 0.55,
                }}
              />
            )}

            {allTracks.map((track) => <TrackLane key={track.id} track={track} />)}
            {pendingTracks.map((p) => <PendingTrackLane key={p.id} pending={p} />)}

            {/* Ardour-style "add track" affordance */}
            <div
              className="flex items-center h-12 opacity-30 hover:opacity-70 transition-opacity cursor-pointer"
              style={{ borderTop: "1px dashed #3a3a3a", marginTop: 1 }}
            >
              <div
                className="flex items-center justify-center gap-2 relative z-10"
                style={{ width: HEADER_W + 1, height: "100%" }}
              >
                <span className="text-xl" style={{ color: "#555" }}>+</span>
              </div>
              <div className="flex items-center px-3">
                <span className="text-xs" style={{ color: "#555" }}>
                  Right-click or drop audio to add a track
                </span>
              </div>
            </div>

            {/* Filler — left panel continues to bottom of scroll area */}
            <div style={{ minHeight: 300, display: "flex" }}>
              <div style={{ width: HEADER_W + 1, flexShrink: 0 }} />
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
