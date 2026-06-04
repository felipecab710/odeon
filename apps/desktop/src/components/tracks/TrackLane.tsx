import type { OdeonTrack } from "@odeon/shared";
import { useSelectionStore } from "../../stores/selectionStore";
import { useEngineStore } from "../../stores/engineStore";
import { engineClient } from "../../lib/engineClient";
import { TrackRoleBadge, StemTypeBadge } from "../shared/Badges";

const ROLE_COLORS: Record<string, string> = {
  reference_full_mix: "#4A90D9",
  reference_stem:     "#4A90D9",
  user_stem:          "#2ECC71",
  analysis:           "#9B59B6",
};

interface TrackLaneProps {
  track: OdeonTrack;
}

export function TrackLane({ track }: TrackLaneProps) {
  const { selectedTrackId, selectTrack } = useSelectionStore();
  const { trackStates, setTrackState } = useEngineStore();
  const state = trackStates[track.id];

  const isSelected = selectedTrackId === track.id;
  const muted = state?.muted ?? track.muted;
  const soloed = state?.soloed ?? track.soloed;

  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !muted;
    setTrackState(track.id, { muted: next });
    engineClient.muteTrack(track.id, next);
  };

  const handleSolo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !soloed;
    setTrackState(track.id, { soloed: next });
    engineClient.soloTrack(track.id, next);
  };

  const accentColor = ROLE_COLORS[track.role] ?? "#888";

  return (
    <div
      onClick={() => selectTrack(track.id)}
      className={`flex items-stretch h-14 border-b border-studio-border cursor-pointer transition-colors group
        ${isSelected ? "bg-studio-active" : "bg-studio-surface hover:bg-studio-hover"}`}
    >
      {/* Color stripe */}
      <div
        className="w-1 flex-shrink-0"
        style={{ background: track.color || accentColor }}
      />

      {/* Track label area (fixed width) */}
      <div className="flex flex-col justify-center px-2 w-40 min-w-40 border-r border-studio-border">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-studio-text text-xs font-medium truncate">
            {track.name}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <TrackRoleBadge role={track.role} />
          <StemTypeBadge stemType={track.stem_type} />
        </div>
        {/* Analysis status */}
        <div className="text-xxs mt-0.5">
          {track.analysis_status === "complete" && (
            <span className="text-studio-meter">✓ Analyzed</span>
          )}
          {track.analysis_status === "analyzing" && (
            <span className="text-studio-accent animate-pulse">Analyzing…</span>
          )}
          {track.analysis_status === "failed" && (
            <span className="text-studio-mute">Analysis failed</span>
          )}
          {track.analysis_status === "pending" && (
            <span className="text-studio-text-faint">Pending</span>
          )}
        </div>
      </div>

      {/* Mute / Solo */}
      <div className="flex flex-col justify-center gap-1 px-2 border-r border-studio-border">
        <button
          onClick={handleMute}
          title="Mute"
          className={`w-7 h-5 rounded text-xxs font-bold transition-colors
            ${muted ? "bg-studio-mute text-white" : "bg-studio-active text-studio-text-dim hover:text-studio-text"}`}
        >
          M
        </button>
        <button
          onClick={handleSolo}
          title="Solo"
          className={`w-7 h-5 rounded text-xxs font-bold transition-colors
            ${soloed ? "bg-studio-solo text-black" : "bg-studio-active text-studio-text-dim hover:text-studio-text"}`}
        >
          S
        </button>
      </div>

      {/* Waveform / clip region */}
      <div className="flex-1 flex items-center px-3 relative overflow-hidden">
        {track.analysis ? (
          <WaveformPlaceholder track={track} />
        ) : (
          <div className="w-full h-8 rounded bg-studio-panel border border-studio-border flex items-center justify-center">
            <span className="text-xxs text-studio-text-faint">
              {track.file_path ? "Audio loaded" : "No audio"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function WaveformPlaceholder({ track }: { track: OdeonTrack }) {
  const analysis = track.analysis;
  if (!analysis) return null;

  // Generate a simple frequency-profile bar representation
  const fp = analysis.frequency_profile;
  const bars = fp
    ? [
        fp.sub_20_60,
        fp.bass_60_160,
        fp.low_mid_160_500,
        fp.mid_500_2000,
        fp.presence_2000_5000,
        fp.brightness_5000_10000,
        fp.air_10000_18000,
      ]
    : [];

  const accentColor = ROLE_COLORS[track.role] ?? "#4A90D9";

  return (
    <div className="w-full h-8 rounded bg-studio-panel border border-studio-border flex items-end gap-px px-1 overflow-hidden">
      {bars.length > 0
        ? bars.map((v, i) => {
            const normalized = Math.max(0, Math.min(1, (v + 80) / 60));
            const height = Math.max(4, Math.floor(normalized * 28));
            return (
              <div
                key={i}
                style={{ height, background: accentColor, opacity: 0.6, flex: 1 }}
                className="rounded-sm"
              />
            );
          })
        : // fallback flat line
          Array.from({ length: 60 }).map((_, i) => (
            <div
              key={i}
              style={{ height: 2, background: accentColor, opacity: 0.3, flex: 1 }}
            />
          ))}

      {/* Duration label */}
      <span
        className="absolute right-2 bottom-1 text-xxs text-studio-text-faint pointer-events-none"
        style={{ fontFamily: "monospace" }}
      >
        {analysis.duration_seconds.toFixed(1)}s
      </span>
    </div>
  );
}
