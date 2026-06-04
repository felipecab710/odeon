import { useProjectStore } from "../../stores/projectStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { StemTypeBadge } from "../shared/Badges";
import type { OdeonTrack } from "@odeon/shared";

function TrackSelector({
  label,
  tracks,
  selectedId,
  onSelect,
}: {
  label: string;
  tracks: OdeonTrack[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xxs text-studio-text-faint uppercase tracking-wider">{label}</div>
      <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
        {tracks.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors text-xs
              ${selectedId === t.id
                ? "bg-studio-accent/20 border border-studio-accent text-studio-text"
                : "bg-studio-active text-studio-text-dim hover:text-studio-text border border-transparent"
              }`}
          >
            <StemTypeBadge stemType={t.stem_type} />
            <span className="truncate">{t.name}</span>
          </button>
        ))}
        {tracks.length === 0 && (
          <div className="text-xxs text-studio-text-faint px-1">None available</div>
        )}
      </div>
    </div>
  );
}

export function ComparisonPanel() {
  const { project, compareProject } = useProjectStore();
  const {
    compareUserTrackId,
    compareRefTrackId,
    setCompareUserTrack,
    setCompareRefTrack,
    setActivePanel,
  } = useSelectionStore();

  const refTracks =
    project?.tracks.filter(
      (t) => t.role === "reference_full_mix" || t.role === "reference_stem"
    ) ?? [];
  const userTracks = project?.tracks.filter((t) => t.role === "user_stem") ?? [];

  const moves = project?.mix_moves ?? [];

  const handleCompare = async () => {
    await compareProject(compareUserTrackId ?? undefined, compareRefTrackId ?? undefined);
    setActivePanel("mixmoves");
  };

  const userTrack = project?.tracks.find((t) => t.id === compareUserTrackId);
  const refTrack = project?.tracks.find((t) => t.id === compareRefTrackId);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto p-3 space-y-3">
      <div className="text-xxs text-studio-text-faint uppercase tracking-wider">
        Compare Tracks
      </div>

      <TrackSelector
        label="My Stem (user)"
        tracks={userTracks}
        selectedId={compareUserTrackId}
        onSelect={setCompareUserTrack}
      />

      <TrackSelector
        label="Reference Track"
        tracks={refTracks}
        selectedId={compareRefTrackId}
        onSelect={setCompareRefTrack}
      />

      <button
        onClick={handleCompare}
        disabled={!compareUserTrackId && !compareRefTrackId}
        className="w-full py-1.5 rounded text-xs font-medium bg-studio-accent text-white hover:bg-studio-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {compareUserTrackId && compareRefTrackId
          ? `Compare "${userTrack?.name}" vs "${refTrack?.name}"`
          : "Compare All Auto-Paired Tracks"}
      </button>

      {moves.length > 0 && (
        <div className="text-xxs text-studio-meter text-center">
          ✓ {moves.filter((m) => m.category !== "reverb").length} actionable move
          {moves.filter((m) => m.category !== "reverb").length !== 1 ? "s" : ""} generated
        </div>
      )}

      {/* Delta summary for selected pair */}
      {userTrack?.analysis && refTrack?.analysis && (
        <div className="bg-studio-panel rounded border border-studio-border p-2 space-y-1">
          <div className="text-xxs text-studio-text-faint uppercase tracking-wider mb-1">
            Quick Delta
          </div>
          <DeltaRow
            label="LUFS"
            delta={userTrack.analysis.integrated_lufs - refTrack.analysis.integrated_lufs}
            unit=" LUFS"
          />
          <DeltaRow
            label="Crest Factor"
            delta={userTrack.analysis.crest_factor_db - refTrack.analysis.crest_factor_db}
            unit=" dB"
          />
          {userTrack.analysis.stereo_profile && refTrack.analysis.stereo_profile && (
            <>
              <DeltaRow
                label="Width"
                delta={
                  userTrack.analysis.stereo_profile.width_proxy -
                  refTrack.analysis.stereo_profile.width_proxy
                }
                unit=""
                precision={3}
              />
              <DeltaRow
                label="Pan"
                delta={
                  userTrack.analysis.stereo_profile.pan_proxy -
                  refTrack.analysis.stereo_profile.pan_proxy
                }
                unit=""
                precision={3}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeltaRow({
  label,
  delta,
  unit,
  precision = 1,
}: {
  label: string;
  delta: number;
  unit: string;
  precision?: number;
}) {
  const sign = delta >= 0 ? "+" : "";
  const color =
    Math.abs(delta) > 3
      ? "text-studio-mute"
      : Math.abs(delta) > 1
      ? "text-studio-solo"
      : "text-studio-meter";
  return (
    <div className="flex justify-between items-center">
      <span className="text-xxs text-studio-text-faint">{label}</span>
      <span className={`text-xxs font-mono ${color}`}>
        {sign}
        {delta.toFixed(precision)}
        {unit}
      </span>
    </div>
  );
}
