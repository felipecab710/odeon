import { useProjectStore } from "../../stores/projectStore";
import { useSelectionStore } from "../../stores/selectionStore";
import type { OdeonTrack } from "@odeon/shared";
import { TrackRoleBadge, StemTypeBadge } from "../shared/Badges";
import { ComparisonPanel } from "../comparison/ComparisonPanel";

function MetricRow({ label, value, unit = "" }: { label: string; value: string | number | null; unit?: string }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between items-center py-0.5 border-b border-studio-border/30">
      <span className="text-studio-text-faint text-xxs">{label}</span>
      <span className="text-studio-text text-xxs font-mono">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="text-studio-text-faint ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-xxs uppercase tracking-wider text-studio-text-faint mb-1.5 font-medium">
        {title}
      </div>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function TrackInspector({ track }: { track: OdeonTrack }) {
  const a = track.analysis;

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs">
      {/* Identity */}
      <Section title="Track">
        <div className="flex items-center gap-1 mb-2">
          <TrackRoleBadge role={track.role} />
          <StemTypeBadge stemType={track.stem_type} />
        </div>
        <div className="text-studio-text-dim text-xxs break-all leading-relaxed">
          {track.file_path ? track.file_path.split("/").pop() : "No file"}
        </div>
      </Section>

      {a ? (
        <>
          <Section title="File Info">
            <MetricRow label="Duration" value={a.duration_seconds} unit="s" />
            <MetricRow label="Sample Rate" value={`${a.sample_rate} Hz`} />
            <MetricRow label="Channels" value={a.channels} />
          </Section>

          <Section title="Loudness">
            <MetricRow label="Integrated LUFS" value={a.integrated_lufs} unit=" LUFS" />
            <MetricRow label="True Peak" value={a.true_peak_db} unit=" dBTP" />
            <MetricRow label="RMS" value={a.rms_db} unit=" dBFS" />
            <MetricRow label="Peak" value={a.peak_db} unit=" dBFS" />
            <MetricRow label="Crest Factor" value={a.crest_factor_db} unit=" dB" />
          </Section>

          {a.tempo && (
            <Section title="Tempo">
              <MetricRow label="Estimated BPM" value={a.tempo} unit=" BPM" />
            </Section>
          )}

          {a.frequency_profile && (
            <Section title="Frequency Profile">
              <MetricRow label="Sub (20–60 Hz)" value={a.frequency_profile.sub_20_60} unit=" dB" />
              <MetricRow label="Bass (60–160 Hz)" value={a.frequency_profile.bass_60_160} unit=" dB" />
              <MetricRow label="Low Mid (160–500 Hz)" value={a.frequency_profile.low_mid_160_500} unit=" dB" />
              <MetricRow label="Mid (500–2k Hz)" value={a.frequency_profile.mid_500_2000} unit=" dB" />
              <MetricRow label="Presence (2–5 kHz)" value={a.frequency_profile.presence_2000_5000} unit=" dB" />
              <MetricRow label="Brightness (5–10 kHz)" value={a.frequency_profile.brightness_5000_10000} unit=" dB" />
              <MetricRow label="Air (10–18 kHz)" value={a.frequency_profile.air_10000_18000} unit=" dB" />
            </Section>
          )}

          {a.stereo_profile && (
            <Section title="Stereo Profile">
              <MetricRow label="Pan Proxy" value={a.stereo_profile.pan_proxy} />
              <MetricRow label="Width Proxy" value={a.stereo_profile.width_proxy} />
              <MetricRow label="Phase Correlation" value={a.stereo_profile.phase_correlation} />
              <MetricRow label="Side/Mid Ratio" value={a.stereo_profile.side_to_mid_ratio} />
              <MetricRow label="Left RMS" value={a.stereo_profile.left_rms} unit=" dB" />
              <MetricRow label="Right RMS" value={a.stereo_profile.right_rms} unit=" dB" />
            </Section>
          )}

          {a.warnings.length > 0 && (
            <Section title="Warnings">
              {a.warnings.map((w, i) => (
                <div key={i} className="text-studio-solo text-xxs py-0.5 border-b border-studio-border/30 leading-relaxed">
                  ⚠ {w}
                </div>
              ))}
            </Section>
          )}
        </>
      ) : (
        <div className="text-studio-text-faint text-xs mt-4 text-center">
          {track.analysis_status === "pending" && "Run Analyze to inspect this track."}
          {track.analysis_status === "analyzing" && "Analyzing..."}
          {track.analysis_status === "failed" && "Analysis failed."}
        </div>
      )}
    </div>
  );
}

export function InspectorPanel() {
  const { project } = useProjectStore();
  const { selectedTrackId, activePanel, setActivePanel } = useSelectionStore();

  const selectedTrack = project?.tracks.find((t) => t.id === selectedTrackId);

  return (
    <div className="flex flex-col border-l border-studio-border bg-studio-surface w-72 flex-shrink-0 overflow-hidden">
      {/* Panel tabs */}
      <div className="flex border-b border-studio-border flex-shrink-0">
        {(["inspector", "comparison", "mixmoves"] as const).map((panel) => (
          <button
            key={panel}
            onClick={() => setActivePanel(panel)}
            className={`flex-1 py-1.5 text-xxs uppercase tracking-wider font-medium transition-colors
              ${activePanel === panel
                ? "bg-studio-active text-studio-text border-b border-studio-accent"
                : "text-studio-text-faint hover:text-studio-text"
              }`}
          >
            {panel === "inspector" ? "Inspector" : panel === "comparison" ? "Compare" : "Mix Moves"}
          </button>
        ))}
      </div>

      {activePanel === "inspector" && (
        <>
          {selectedTrack ? (
            <TrackInspector track={selectedTrack} />
          ) : (
            <div className="flex items-center justify-center flex-1 text-studio-text-faint text-xs p-4 text-center">
              Select a track to inspect its analysis.
            </div>
          )}
        </>
      )}

      {activePanel === "comparison" && <ComparisonPanel />}

      {activePanel === "mixmoves" && <MixMovesPanel />}
    </div>
  );
}

function MixMovesPanel() {
  const { project } = useProjectStore();
  const moves = project?.mix_moves ?? [];

  if (moves.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-studio-text-faint text-xs p-4 text-center gap-2">
        <div className="text-2xl">⚗</div>
        <div>No mix moves yet.</div>
        <div className="text-xxs">Upload stems, analyze, then click Compare.</div>
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    level: "text-[#4A90D9]",
    eq: "text-[#F39C12]",
    compression: "text-[#E84C3D]",
    stereo: "text-[#9B59B6]",
    pan: "text-[#2ECC71]",
    reverb: "text-[#1F618D]",
    arrangement: "text-[#95A5A6]",
  };

  const trackName = (id: string) =>
    project?.tracks.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {moves.map((move) => (
        <div
          key={move.id}
          className="bg-studio-panel rounded border border-studio-border p-2 space-y-1.5"
        >
          {/* Header */}
          <div className="flex items-center gap-2">
            <span
              className={`text-xxs font-bold uppercase ${categoryColors[move.category] ?? "text-studio-text-dim"}`}
            >
              {move.category}
            </span>
            <span className="text-xxs text-studio-text-faint">
              {Math.round(move.confidence * 100)}% confidence
            </span>
          </div>

          {/* Target */}
          <div className="text-xxs text-studio-text-faint">
            {trackName(move.target_track_id)}
          </div>

          {/* Observation */}
          <div className="text-xs text-studio-text leading-relaxed">
            {move.observation}
          </div>

          {/* Action */}
          <div className="text-xxs text-studio-accent leading-relaxed bg-studio-active rounded p-1.5">
            → {move.suggested_action}
          </div>

          {/* Evidence */}
          {(move.evidence.delta_db != null || move.evidence.delta != null) && (
            <div className="text-xxs text-studio-text-faint font-mono">
              {move.evidence.user_db != null && `User: ${move.evidence.user_db.toFixed(1)} dB`}
              {move.evidence.reference_db != null && ` | Ref: ${move.evidence.reference_db.toFixed(1)} dB`}
              {move.evidence.delta_db != null && ` | Δ: ${move.evidence.delta_db.toFixed(1)} dB`}
            </div>
          )}

          {/* DAW params */}
          {move.daw_ready_parameters.gain_db != null && (
            <div className="text-xxs font-mono text-studio-text-faint">
              {move.daw_ready_parameters.processor}
              {move.daw_ready_parameters.frequency_hz != null && ` @ ${move.daw_ready_parameters.frequency_hz} Hz`}
              {` ${move.daw_ready_parameters.gain_db > 0 ? "+" : ""}${move.daw_ready_parameters.gain_db.toFixed(1)} dB`}
              {move.daw_ready_parameters.q != null && ` Q ${move.daw_ready_parameters.q}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
