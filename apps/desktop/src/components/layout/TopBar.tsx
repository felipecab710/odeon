import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { usePlaybackEngineStore } from "../../stores/playbackEngineStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useEffect, useState } from "react";

// Stages shown in sequence while any upload/analysis is running.
// Timings are tuned to match the actual backend pipeline:
//   ~1s  file save, ~3s librosa analysis, ~60-120s Demucs separation.
const UPLOAD_STAGES: { after: number; label: string }[] = [
  { after: 0,    label: "Reading audio file…" },
  { after: 2000, label: "Analyzing loudness & frequency…" },
  { after: 5000, label: "Detecting BPM & stereo profile…" },
  { after: 10000, label: "Separating stems — Drums, Bass, Vocals, Other…" },
  { after: 45000, label: "Still separating (long track — hang tight)…" },
  { after: 90000, label: "Almost there — finalizing stems…" },
];

function useLoadingStage(isLoading: boolean, staticLabel: string | null) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!isLoading) { setStage(0); return; }
    setStage(0);
    const timers = UPLOAD_STAGES.slice(1).map((s, i) =>
      setTimeout(() => setStage(i + 1), s.after)
    );
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  if (!isLoading) return null;
  // Use the timed stage label for upload operations, static label for others
  if (staticLabel && !staticLabel.startsWith("uploading") && !staticLabel.startsWith("importing")) {
    return staticLabel;
  }
  return UPLOAD_STAGES[Math.min(stage, UPLOAD_STAGES.length - 1)].label;
}

export function TopBar() {
  const { project, isLoading, loadingLabel, uploadReference, uploadUserStems, analyzeProject, compareProject, exportBlueprint } =
    useProjectStore();
  const { navigate } = useNavigationStore();
  const { engineReady } = useTransportStore();
  const { compareUserTrackId, compareRefTrackId } = useSelectionStore();
  const openPlaybackEngine = usePlaybackEngineStore((s) => s.open);
  const displayLabel = useLoadingStage(isLoading, loadingLabel ?? null);

  const handleUploadRef = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/wav,audio/x-wav,audio/flac,audio/aiff,audio/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      document.body.removeChild(input);
      if (input.files?.[0]) uploadReference(input.files[0]);
    };
    input.click();
  };

  const handleImportStems = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      document.body.removeChild(input);
      if (input.files && input.files.length > 0) {
        uploadUserStems(Array.from(input.files));
      }
    };
    input.click();
  };

  const canCompare =
    project &&
    project.tracks.some((t) => t.role === "user_stem") &&
    project.tracks.some((t) => t.role === "reference_full_mix" || t.role === "reference_stem");

  return (
    <div className="relative flex flex-col flex-shrink-0">
      {/* Main bar */}
      <div className="flex items-center gap-2 h-11 px-4 bg-studio-surface border-b border-studio-border">
        {/* Logo + Sessions button */}
        <div className="flex items-center gap-2 mr-3">
          <div className="w-6 h-6 rounded bg-studio-accent flex items-center justify-center">
            <span className="text-white font-bold text-xs">O</span>
          </div>
          <button
            onClick={() => navigate("studio")}
            className="font-semibold text-studio-text tracking-wide text-sm hover:text-studio-accent transition-colors"
            title="Open Studio"
          >
            ODEON
          </button>
        </div>

        {/* Status */}
        {project && (
          <span className="text-xxs px-1.5 py-0.5 rounded bg-studio-panel text-studio-text-faint uppercase tracking-wider">
            {isLoading ? (displayLabel ?? "processing…") : project.status.replace(/_/g, " ")}
          </span>
        )}

        {/* Engine status */}
        <div className="ml-1 flex items-center gap-1">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              engineReady ? "bg-studio-meter" : "bg-studio-text-faint"
            }`}
          />
          <span className="text-xxs text-studio-text-faint">
            {engineReady ? "Engine" : "No audio"}
          </span>
        </div>

        <div className="flex-1" />

        <button
          onClick={openPlaybackEngine}
          className="btn-top px-2"
          title="Playback Engine"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>

        <div className="w-px h-5 bg-studio-border mx-1" />

        {/* Actions */}
        <button
          onClick={handleUploadRef}
          disabled={!project || isLoading}
          className="btn-top"
        >
          Upload Reference
        </button>
        <button
          onClick={handleImportStems}
          disabled={!project || isLoading}
          className="btn-top"
        >
          Import My Stems
        </button>
        <button
          onClick={() => analyzeProject()}
          disabled={!project || isLoading}
          className="btn-top"
        >
          Analyze
        </button>
        <button
          onClick={() =>
            compareProject(compareUserTrackId ?? undefined, compareRefTrackId ?? undefined)
          }
          disabled={!canCompare || isLoading}
          className="btn-top"
        >
          Compare
        </button>
        <button
          onClick={() => exportBlueprint()}
          disabled={!project || !project.mix_moves.length || isLoading}
          className="btn-top btn-top-accent"
        >
          Export Mix Blueprint
        </button>
      </div>

      {/* Animated progress bar — visible whenever isLoading is true */}
      {isLoading && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full bg-studio-accent animate-progress-bar" />
        </div>
      )}
    </div>
  );
}
