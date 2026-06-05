import { useEffect, useRef, memo } from "react";
import type { OdeonTrack } from "@odeon/shared";
import { WaveformCanvas } from "./WaveformCanvas";
import { useTrackAutomationStore } from "../../stores/trackAutomationStore";
import {
  defaultAutomation,
  laneValueRange,
  valueToY,
  type AutomationPoint,
  type LaneValueRange,
} from "../../lib/trackAutomation";
import { trackViewLabel, type TrackViewMode } from "../../lib/trackView";
import { PT_CLIP_BORDER } from "../../lib/waveformEngine/colors";
import { clipGradient } from "../../lib/clipColorPresets";

const LANE_BG = "#1e2a33";
const AUTO_LINE = "#5ec995";
const AUTO_FILL = "rgba(94,201,149,0.12)";
const MARKER_COLOR = "#8ab4f8";
const WARP_COLOR = "#e8a838";

interface TrackLaneViewProps {
  track: OdeonTrack;
  viewMode: TrackViewMode;
  clipWidth: number;
  height: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  cullClipLeft: number;
  viewportWidth: number;
  freezeWaveform: boolean;
  fileLabel: string;
  clipColor: string;
}

function drawAutomation(
  ctx: CanvasRenderingContext2D,
  points: AutomationPoint[],
  range: LaneValueRange,
  w: number,
  h: number,
  pps: number,
  color: string,
) {
  if (points.length < 1) return;
  const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec);

  if (range.stepped) {
    ctx.fillStyle = "rgba(94,201,149,0.25)";
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.value < 0.5) continue;
      const x0 = a.timeSec * pps;
      const x1 = b.timeSec * pps;
      ctx.fillRect(x0, 0, x1 - x0, h);
    }
    return;
  }

  ctx.beginPath();
  ctx.moveTo(0, valueToY(sorted[0].value, range, h));
  for (const pt of sorted) {
    ctx.lineTo(pt.timeSec * pps, valueToY(pt.value, range, h));
  }
  ctx.lineTo(w, valueToY(sorted[sorted.length - 1].value, range, h));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = AUTO_FILL;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(sorted[0].timeSec * pps, valueToY(sorted[0].value, range, h));
  for (let i = 1; i < sorted.length; i++) {
    ctx.lineTo(sorted[i].timeSec * pps, valueToY(sorted[i].value, range, h));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  for (const pt of sorted) {
    const x = pt.timeSec * pps;
    const y = valueToY(pt.value, range, h);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const AutomationLane = memo(function AutomationLane({
  track,
  mode,
  clipWidth,
  height,
  pixelsPerSecond,
}: {
  track: OdeonTrack;
  mode: TrackViewMode;
  clipWidth: number;
  height: number;
  pixelsPerSecond: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ensureDefaults = useTrackAutomationStore((s) => s.ensureDefaults);
  const stored = useTrackAutomationStore((s) => s.playlists[track.id]?.[mode]);
  const duration = track.analysis?.duration_seconds ?? 60;
  const points = stored?.length
    ? stored
    : defaultAutomation(track, mode, duration);
  const range = laneValueRange(mode);

  useEffect(() => { ensureDefaults(track, mode); }, [track, mode, ensureDefaults]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(clipWidth * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${clipWidth}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = LANE_BG;
    ctx.fillRect(0, 0, clipWidth, height);
    const mid = height / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(clipWidth, mid);
    ctx.stroke();
    drawAutomation(ctx, points, range, clipWidth, height, pixelsPerSecond, AUTO_LINE);
  }, [points, range, clipWidth, height, pixelsPerSecond]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ width: clipWidth, height }}
    />
  );
});

function MarkerLane({ clipWidth, height, mode }: { clipWidth: number; height: number; mode: TrackViewMode }) {
  const markers = mode === "analysis"
    ? Array.from({ length: Math.floor(clipWidth / 80) }, (_, i) => i * 80 + 40)
    : mode === "warp"
      ? [60, 180, 320, 480].filter((x) => x < clipWidth)
      : [100, 250, 400].filter((x) => x < clipWidth);

  return (
    <div className="absolute inset-0" style={{ background: LANE_BG }}>
      <div className="absolute left-0 right-0" style={{ top: height / 2, height: 1, background: "rgba(255,255,255,0.1)" }} />
      {markers.map((x) => (
        <div
          key={x}
          className="absolute"
          style={{
            left: x,
            top: mode === "warp" ? height / 2 - 5 : 4,
            transform: "translateX(-50%)",
          }}
        >
          {mode === "warp" ? (
            <div style={{
              width: 8, height: 8,
              background: WARP_COLOR,
              transform: "rotate(45deg)",
              border: "1px solid #000",
            }} />
          ) : (
            <div style={{
              width: 1,
              height: height - 8,
              background: mode === "analysis" ? MARKER_COLOR : "#aaa",
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function BlocksLane({ clipWidth, height, fileLabel, color }: {
  clipWidth: number; height: number; fileLabel: string; color: string;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center px-2"
      style={{ background: color + "33", borderBottom: `2px solid ${color}88` }}
    >
      <span className="text-xxs truncate" style={{ color: "#ddd", fontWeight: 600 }}>{fileLabel}</span>
    </div>
  );
}

function PlaylistsLane({ clipWidth, height, fileLabel, color }: {
  clipWidth: number; height: number; fileLabel: string; color: string;
}) {
  const rows = 3;
  const rowH = height / rows;
  return (
    <div className="absolute inset-0" style={{ background: LANE_BG }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 flex items-center px-1"
          style={{
            top: i * rowH,
            height: rowH - 1,
            width: clipWidth * (i === 0 ? 1 : 0.85 - i * 0.1),
            background: i === 0 ? color + "44" : color + "22",
            border: `1px solid ${color}55`,
            opacity: i === 0 ? 1 : 0.7,
          }}
        >
          {i === 0 && (
            <span className="text-xxs truncate" style={{ color: "#ccc" }}>{fileLabel}</span>
          )}
          {i > 0 && (
            <span className="text-xxs" style={{ color: "#666" }}>Take {i + 1}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function TranscriptLane({ clipWidth, height }: { clipWidth: number; height: number }) {
  const segments = [
    { x: 20, text: "Never be like you" },
    { x: 200, text: "I remember" },
    { x: 380, text: "..." },
  ].filter((s) => s.x < clipWidth - 40);

  return (
    <div className="absolute inset-0 px-1" style={{ background: "#1a2228" }}>
      {segments.map((s) => (
        <span
          key={s.x}
          className="absolute text-xxs"
          style={{ left: s.x, top: height / 2 - 6, color: "#b8c8d8", whiteSpace: "nowrap" }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}

export const TrackLaneView = memo(function TrackLaneView({
  track,
  viewMode,
  clipWidth,
  height,
  pixelsPerSecond,
  scrollLeft,
  cullClipLeft,
  viewportWidth,
  freezeWaveform,
  fileLabel,
  clipColor,
}: TrackLaneViewProps) {
  const innerH = height - 2;
  const visStart = Math.max(0, scrollLeft - cullClipLeft);
  const visEnd = Math.min(clipWidth, scrollLeft + viewportWidth - cullClipLeft);
  const visWidth = Math.max(0, visEnd - visStart);
  const hasAudio = Boolean(track.file_path);

  const renderContent = () => {
    if (!hasAudio && viewMode !== "markers") {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>
      );
    }

    switch (viewMode) {
      case "blocks":
        return <BlocksLane clipWidth={clipWidth} height={innerH} fileLabel={fileLabel} color={clipColor} />;
      case "playlists":
        return <PlaylistsLane clipWidth={clipWidth} height={innerH} fileLabel={fileLabel} color={clipColor} />;
      case "analysis":
      case "warp":
      case "markers":
        return <MarkerLane clipWidth={clipWidth} height={innerH} mode={viewMode} />;
      case "transcript":
        return <TranscriptLane clipWidth={clipWidth} height={innerH} />;
      case "waveform":
        return visWidth > 0 ? (
          <WaveformCanvas
            trackId={track.id}
            audioPath={track.file_path!}
            analysis={track.analysis}
            width={clipWidth}
            height={innerH}
            pixelsPerSecond={pixelsPerSecond}
            freezeRender={freezeWaveform}
            clipStartSec={track.clip_start_seconds ?? 0}
            clipBgColor={clipColor}
            viewportOffsetX={visStart}
            viewportWidth={visWidth}
          />
        ) : null;
      case "volume":
      case "volume-trim":
      case "lfe":
      case "mute":
      case "pan-left":
      case "pan-right":
        return (
          <AutomationLane
            track={track}
            mode={viewMode}
            clipWidth={clipWidth}
            height={innerH}
            pixelsPerSecond={pixelsPerSecond}
          />
        );
      default:
        return null;
    }
  };

  const showClipChrome = viewMode === "waveform" || viewMode === "blocks";

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: clipGradient(clipColor),
        border: `1px solid ${PT_CLIP_BORDER}`,
        boxSizing: "border-box",
      }}
    >
      {renderContent()}

      {showClipChrome && (
        <>
          <div
            className="absolute top-0 left-0 pointer-events-none select-none z-10"
            style={{ maxWidth: "92%", background: "rgba(0,0,0,0.45)", padding: "1px 5px 2px" }}
          >
            <span className="text-xxs font-medium truncate block" style={{ color: "#fff", lineHeight: 1.3 }}>
              {fileLabel}
            </span>
          </div>
          {viewMode === "waveform" && (
            <div
              className="absolute bottom-0.5 left-1 flex items-center gap-0.5 pointer-events-none select-none z-10"
              style={{ color: "#fff", fontSize: 9, fontFamily: "monospace" }}
            >
              <span style={{
                display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.7)", flexShrink: 0,
              }} />
              <span style={{ opacity: 0.9 }}>0 dB</span>
            </div>
          )}
        </>
      )}

      {!showClipChrome && (
        <div
          className="absolute left-1 top-0.5 pointer-events-none select-none z-10"
          style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "lowercase" }}
        >
          {trackViewLabel(viewMode)}
        </div>
      )}
    </div>
  );
});
