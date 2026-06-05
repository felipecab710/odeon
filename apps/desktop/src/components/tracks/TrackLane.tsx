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
import { useRef, useEffect, useCallback } from "react";
import type { OdeonTrack } from "@odeon/shared";
import type { PendingTrack } from "../../stores/projectStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useEngineStore } from "../../stores/engineStore";
import { useProjectStore } from "../../stores/projectStore";
import { engineClient } from "../../lib/engineClient";
import { webAudioEngine, ardourDbToPos, ardourPosToDb } from "../../lib/webAudioEngine";

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

// ── Waveform clip ─────────────────────────────────────────────────────────────
//
// Unselected → muted, low-opacity fill (pinkish/desaturated) — like Ardour's
//              dimmed regions. Waveform drawn darker over the light fill.
//
// Selected   → rich saturated fill (full orange/amber). Waveform peaks rendered
//              as a slightly darker solid shape, RMS as a brighter inner fill —
//              exactly matching Ardour's selected region look.
//
function WaveformClip({
  track,
  color,
  isSelected,
  isAnalyzing,
}: {
  track: OdeonTrack;
  color: string;
  isSelected: boolean;
  isAnalyzing: boolean;
}) {
  const peaks = track.analysis?.waveform_peaks;
  const rms   = track.analysis?.waveform_rms;

  // Region background & border — muted vs. saturated
  const regionBg     = isSelected ? `${color}c0` : `${color}38`;
  const regionBorder = isSelected ? `${color}ff` : `${color}88`;

  // Waveform fill colors
  // Selected:   dark "shadow" peaks over bright background + brighter RMS inner
  // Unselected: dark peaks (contrast over light fill), no inner RMS highlight
  const peakFill = isSelected ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.28)";
  const rmsFill  = isSelected ? `${color}ff`        : `${color}60`;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: regionBg,
        borderTop:  `2px solid ${regionBorder}`,
        borderLeft: `1px solid ${regionBorder}66`,
      }}
    >
      {/* Shimmer while analyzing */}
      {isAnalyzing && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(90deg,transparent 0%,${color}30 50%,transparent 100%)`,
            animation: "shimmer 1.6s ease-in-out infinite",
          }}
        />
      )}

      {/* Waveform SVG */}
      {peaks && peaks.length > 0 ? (
        <svg
          viewBox="0 0 1200 72"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          {(() => {
            const W = 1200, H = 72, mid = H / 2, n = peaks.length;
            const pTop: string[] = [], pBot: string[] = [];
            const rTop: string[] = [], rBot: string[] = [];

            for (let i = 0; i < n; i++) {
              const x  = (i / Math.max(n - 1, 1)) * W;
              const ph = (peaks[i] ?? 0) * mid * 0.90;
              const rh = rms ? (rms[i] ?? 0) * mid * 0.90 : ph * 0.55;
              pTop.push(`${x.toFixed(1)},${(mid - ph).toFixed(1)}`);
              pBot.unshift(`${x.toFixed(1)},${(mid + ph).toFixed(1)}`);
              rTop.push(`${x.toFixed(1)},${(mid - rh).toFixed(1)}`);
              rBot.unshift(`${x.toFixed(1)},${(mid + rh).toFixed(1)}`);
            }
            const pp = `M ${pTop.join(" L ")} L ${pBot.join(" L ")} Z`;
            const rp = `M ${rTop.join(" L ")} L ${rBot.join(" L ")} Z`;
            return (
              <>
                {/* Outer peak shape — dark overlay for contrast */}
                <path d={pp} fill={peakFill} />
                {/* Inner RMS — bright in selected, subtle otherwise */}
                <path d={rp} fill={rmsFill} />
                {/* Center line */}
                <line
                  x1="0" y1={mid} x2={W} y2={mid}
                  stroke={isSelected ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.2)"}
                  strokeWidth="0.8"
                />
              </>
            );
          })()}
        </svg>
      ) : (
        <div className="absolute inset-0 flex items-center px-3">
          <div className="w-full h-px" style={{ background: `${color}70` }} />
        </div>
      )}

      {/* Clip name — shown when selected or always, left-aligned like Ardour */}
      <span
        className="absolute top-0.5 left-1.5 text-xxs font-medium pointer-events-none select-none truncate"
        style={{
          color: isSelected ? "#fff" : "#ffffffaa",
          maxWidth: "90%",
          textShadow: "0 1px 3px rgba(0,0,0,0.7)",
        }}
      >
        {track.name}
      </span>

      {/* Duration — bottom-right */}
      {(track.analysis?.duration_seconds ?? 0) > 0 && (
        <span
          className="absolute bottom-0.5 right-1.5 text-xxs font-mono pointer-events-none select-none"
          style={{
            color: isSelected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)",
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          }}
        >
          {track.analysis!.duration_seconds!.toFixed(1)}s
        </span>
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
      {/* Color stripe */}
      <div className="w-0.5 flex-shrink-0 animate-pulse" style={{ background: color }} />

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
interface TrackLaneProps { track: OdeonTrack }

export function TrackLane({ track }: TrackLaneProps) {
  const { selectedTrackId, selectTrack } = useSelectionStore();
  const { trackStates, setTrackState }   = useEngineStore();
  const { analyzeTrack }                 = useProjectStore();

  const state      = trackStates[track.id];
  const isSelected = selectedTrackId === track.id;
  const muted      = state?.muted  ?? track.muted;
  const soloed     = state?.soloed ?? track.soloed;
  const volDb      = state?.volumeDb ?? track.volume_db ?? 0;

  const isAnalyzing = track.analysis_status === "analyzing";
  const isComplete  = track.analysis_status === "complete";
  const isFailed    = track.analysis_status === "failed";
  const isPending   = track.analysis_status === "pending";
  const isReference = track.role === "reference_full_mix";
  const color       = trackColor(track);

  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !muted;
    setTrackState(track.id, { muted: next });
    webAudioEngine.setMute(track.id, next);
    engineClient.muteTrack(track.id, next);   // keep C++ engine in sync if running
  };
  const handleSolo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !soloed;
    setTrackState(track.id, { soloed: next });
    webAudioEngine.setSolo(track.id, next);
    engineClient.soloTrack(track.id, next);
  };
  const handleAnalyze = (e: React.MouseEvent) => {
    e.stopPropagation();
    analyzeTrack(track.id);
  };

  return (
    <div
      onClick={() => selectTrack(track.id)}
      className={`flex items-stretch border-b border-studio-border cursor-pointer group
        ${isSelected ? "ring-inset ring-1 ring-studio-accent" : ""}`}
      style={{ height: 80, background: isSelected ? "#2e2e2e" : "#2a2a2a" }}
    >
      {/* ── Color stripe ──────────────────────────────────────────────────── */}
      <div className="w-0.5 flex-shrink-0" style={{ background: color }} />

      {/* ── Ardour-style left strip ───────────────────────────────────────── */}
      <div
        className="flex flex-col justify-between py-1.5 px-2 border-r border-studio-border flex-shrink-0 overflow-hidden"
        style={{ width: 160, background: "#1c1c1c", gap: 2 }}
      >
        {/* Row 1 – Track name */}
        <span
          className="text-xs font-semibold truncate leading-tight"
          style={{ color: "#d8d8d8" }}
          title={track.name}
        >
          {track.name}
        </span>

        {/* Row 2 – ● record dot · M · S */}
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
          {(["P","A","G"] as const).map((lbl) => (
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
        </div>

        {/* Row 3 – Ardour fader + dB readout */}
        <div className="flex items-center gap-1.5">
          <ArdourFader
            valueDb={volDb}
            onChange={(db) => {
              setTrackState(track.id, { volumeDb: db });
              webAudioEngine.setVolume(track.id, db);
              engineClient.setTrackVolume(track.id, db);
            }}
          />
          <span className="text-xxs font-mono flex-shrink-0" style={{ color: "#666", minWidth: 32, textAlign: "right" }}>
            {volDb.toFixed(1)}
          </span>
        </div>

        {/* Row 4 – Analyze status */}
        <div className="flex items-center min-h-[14px]">
          {(isPending || isFailed) && (
            <button
              onClick={handleAnalyze}
              className="text-xxs font-semibold px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: `${color}22`,
                border: `1px solid ${color}55`,
                color,
              }}
            >
              {isReference ? "⚡ Analyze + Stems" : "⚡ Analyze"}
            </button>
          )}
          {isAnalyzing && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full animate-ping flex-shrink-0" style={{ background: color }} />
              <span className="text-xxs animate-pulse" style={{ color }}>
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

      {/* ── Waveform clip area ────────────────────────────────────────────── */}
      <div className="flex-1 relative" style={{ background: "#3a3a3a" }}>
        <WaveformClip track={track} color={color} isSelected={isSelected} isAnalyzing={isAnalyzing} />
      </div>
    </div>
  );
}
