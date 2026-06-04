import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";
import { useSelectionStore } from "../../stores/selectionStore";

export function TopBar() {
  const { project, isLoading, uploadReference, uploadUserStems, analyzeProject, compareProject, exportBlueprint } =
    useProjectStore();
  const { engineReady } = useTransportStore();
  const { compareUserTrackId, compareRefTrackId } = useSelectionStore();

  const handleUploadRef = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/wav,audio/x-wav,audio/flac,audio/aiff,audio/*";
    input.onchange = () => {
      if (input.files?.[0]) uploadReference(input.files[0]);
    };
    input.click();
  };

  const handleImportStems = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.multiple = true;
    input.onchange = () => {
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
    <div className="flex items-center gap-2 h-11 px-4 bg-studio-surface border-b border-studio-border flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-3">
        <div className="w-6 h-6 rounded bg-studio-accent flex items-center justify-center">
          <span className="text-white font-bold text-xs">O</span>
        </div>
        <span className="font-semibold text-studio-text tracking-wide text-sm">
          ODEON
        </span>
      </div>

      <div className="w-px h-5 bg-studio-border mx-1" />

      {/* Project name */}
      <span className="text-studio-text-dim text-xs min-w-0 truncate max-w-48">
        {project ? project.name : "No project"}
      </span>

      {/* Status */}
      {project && (
        <span className="text-xxs px-1.5 py-0.5 rounded bg-studio-panel text-studio-text-faint uppercase tracking-wider">
          {project.status.replace(/_/g, " ")}
        </span>
      )}

      {/* Engine status */}
      <div className="ml-1 flex items-center gap-1">
        <div
          className={`w-1.5 h-1.5 rounded-full ${engineReady ? "bg-studio-meter" : "bg-studio-text-faint"}`}
        />
        <span className="text-xxs text-studio-text-faint">
          {engineReady ? "Engine" : "No engine"}
        </span>
      </div>

      <div className="flex-1" />

      {/* Loading indicator */}
      {isLoading && (
        <span className="text-xxs text-studio-accent animate-pulse mr-2">
          Processing...
        </span>
      )}

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
  );
}
