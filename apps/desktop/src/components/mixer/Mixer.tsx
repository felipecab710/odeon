import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { engineClient } from "../../lib/engineClient";
import type { OdeonTrack } from "@odeon/shared";
import { StemTypeBadge } from "../shared/Badges";

function LevelMeter({
  leftDb,
  rightDb,
}: {
  leftDb: number;
  rightDb: number;
}) {
  const toHeight = (db: number) => {
    const clamped = Math.max(-60, Math.min(0, db));
    return Math.max(0, ((clamped + 60) / 60) * 100);
  };

  const color = (db: number) => {
    if (db > -3) return "bg-studio-meter-clip";
    if (db > -12) return "bg-studio-meter-warn";
    return "bg-studio-meter";
  };

  return (
    <div className="flex gap-0.5 h-16 items-end">
      {[leftDb, rightDb].map((db, i) => (
        <div key={i} className="w-1.5 h-full bg-studio-bg rounded-sm overflow-hidden flex flex-col-reverse">
          <div
            className={`w-full rounded-sm transition-all ${color(db)}`}
            style={{ height: `${toHeight(db)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function VolumeSlider({ trackId, volumeDb }: { trackId: string; volumeDb: number }) {
  const { setTrackState } = useEngineStore();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setTrackState(trackId, { volumeDb: v });
    engineClient.setTrackVolume(trackId, v);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="range"
        min="-60"
        max="12"
        step="0.5"
        value={volumeDb}
        onChange={handleChange}
        className="h-20 appearance-none cursor-pointer"
        style={{ writingMode: "vertical-lr", direction: "rtl", width: 16 }}
        title={`${volumeDb.toFixed(1)} dB`}
      />
      <span className="text-xxs text-studio-text-faint font-mono">
        {volumeDb >= 0 ? "+" : ""}{volumeDb.toFixed(1)}
      </span>
    </div>
  );
}

function PanKnob({ trackId, pan }: { trackId: string; pan: number }) {
  const { setTrackState } = useEngineStore();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setTrackState(trackId, { pan: v });
    engineClient.setTrackPan(trackId, v);
  };

  const pos = pan < -0.05 ? "L" : pan > 0.05 ? "R" : "C";

  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="range"
        min="-1"
        max="1"
        step="0.01"
        value={pan}
        onChange={handleChange}
        className="w-12 appearance-none cursor-pointer h-1 bg-studio-border rounded"
        title={`Pan: ${pos}`}
      />
      <span className="text-xxs text-studio-text-faint font-mono">{pos}</span>
    </div>
  );
}

interface MixerChannelProps {
  track: OdeonTrack;
}

function MixerChannel({ track }: MixerChannelProps) {
  const { trackStates, setTrackState } = useEngineStore();
  const state = trackStates[track.id];
  const volumeDb = state?.volumeDb ?? track.volume_db;
  const pan = state?.pan ?? track.pan;
  const muted = state?.muted ?? track.muted;
  const soloed = state?.soloed ?? track.soloed;
  const leftDb = state?.leftMeterDb ?? -120;
  const rightDb = state?.rightMeterDb ?? -120;

  const handleMute = () => {
    const next = !muted;
    setTrackState(track.id, { muted: next });
    engineClient.muteTrack(track.id, next);
  };

  const handleSolo = () => {
    const next = !soloed;
    setTrackState(track.id, { soloed: next });
    engineClient.soloTrack(track.id, next);
  };

  return (
    <div
      className="flex flex-col items-center px-2 py-2 border-r border-studio-border bg-studio-panel hover:bg-studio-hover transition-colors"
      style={{ minWidth: 64, maxWidth: 80 }}
    >
      {/* Track label */}
      <div
        className="w-full text-center text-xxs text-studio-text font-medium truncate mb-1 px-1"
        title={track.name}
      >
        {track.name}
      </div>

      {/* Stem badge */}
      <StemTypeBadge stemType={track.stem_type} />

      {/* Meter + Volume */}
      <div className="flex items-end gap-1 my-2">
        <LevelMeter leftDb={leftDb} rightDb={rightDb} />
        <VolumeSlider trackId={track.id} volumeDb={volumeDb} />
      </div>

      {/* Pan */}
      <PanKnob trackId={track.id} pan={pan} />

      {/* Mute / Solo */}
      <div className="flex gap-1 mt-2">
        <button
          onClick={handleMute}
          className={`w-6 h-5 rounded text-xxs font-bold transition-colors
            ${muted ? "bg-studio-mute text-white" : "bg-studio-active text-studio-text-dim hover:text-studio-text"}`}
        >
          M
        </button>
        <button
          onClick={handleSolo}
          className={`w-6 h-5 rounded text-xxs font-bold transition-colors
            ${soloed ? "bg-studio-solo text-black" : "bg-studio-active text-studio-text-dim hover:text-studio-text"}`}
        >
          S
        </button>
      </div>

      {/* Analysis status dot */}
      <div
        className={`mt-1.5 w-1.5 h-1.5 rounded-full ${
          track.analysis_status === "complete"
            ? "bg-studio-meter"
            : track.analysis_status === "failed"
            ? "bg-studio-mute"
            : "bg-studio-text-faint"
        }`}
        title={`Analysis: ${track.analysis_status}`}
      />
    </div>
  );
}

export function Mixer() {
  const { project } = useProjectStore();
  if (!project || project.tracks.length === 0) return null;

  return (
    <div className="flex flex-col border-t border-studio-border bg-studio-surface flex-shrink-0" style={{ height: 200 }}>
      <div className="flex items-center gap-2 px-3 h-6 border-b border-studio-border">
        <span className="text-xxs text-studio-text-faint uppercase tracking-wider">Mixer</span>
      </div>
      <div className="flex flex-1 overflow-x-auto overflow-y-hidden">
        {project.tracks.map((track) => (
          <MixerChannel key={track.id} track={track} />
        ))}
      </div>
    </div>
  );
}
