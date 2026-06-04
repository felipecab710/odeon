import { useTransportStore } from "../../stores/transportStore";
import type { ABMode } from "../../stores/transportStore";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export function TransportBar() {
  const { isPlaying, positionSeconds, bpm, isLoopEnabled, abMode, engineReady, play, stop, toggleLoop, setAbMode } =
    useTransportStore();

  const AB_MODES: { value: ABMode; label: string }[] = [
    { value: "reference", label: "Reference" },
    { value: "my-mix", label: "My Mix" },
    { value: "matched-preview", label: "Matched Preview" },
  ];

  return (
    <div className="flex items-center gap-3 h-10 px-4 bg-studio-panel border-b border-studio-border flex-shrink-0">
      {/* Play / Stop */}
      <button
        onClick={() => (isPlaying ? stop() : play())}
        disabled={!engineReady}
        title={isPlaying ? "Stop" : "Play"}
        className={`w-8 h-7 rounded flex items-center justify-center text-sm transition-colors
          ${engineReady ? "bg-studio-active hover:bg-studio-hover text-studio-text" : "bg-studio-surface text-studio-text-faint cursor-not-allowed"}`}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      {/* Stop (always goes to 0) */}
      <button
        onClick={() => stop()}
        disabled={!engineReady}
        title="Stop & rewind"
        className="w-8 h-7 rounded flex items-center justify-center text-sm bg-studio-active hover:bg-studio-hover text-studio-text disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ◼
      </button>

      {/* Time counter */}
      <div className="font-mono text-sm text-studio-accent bg-studio-bg px-2 py-0.5 rounded border border-studio-border min-w-[90px] text-center tabular-nums">
        {formatTime(positionSeconds)}
      </div>

      {/* BPM */}
      <div className="flex items-center gap-1 text-xs text-studio-text-dim">
        <span className="text-studio-text-faint">BPM</span>
        <span className="font-mono text-studio-text">{bpm.toFixed(1)}</span>
      </div>

      <div className="w-px h-5 bg-studio-border" />

      {/* Loop */}
      <button
        onClick={toggleLoop}
        title="Loop"
        className={`px-2 h-6 rounded text-xxs font-medium transition-colors
          ${isLoopEnabled ? "bg-studio-accent text-white" : "bg-studio-active text-studio-text-dim hover:text-studio-text"}`}
      >
        LOOP
      </button>

      <div className="w-px h-5 bg-studio-border" />

      {/* A/B Mode */}
      <div className="flex items-center gap-1">
        <span className="text-xxs text-studio-text-faint uppercase tracking-wider mr-1">A/B</span>
        {AB_MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setAbMode(m.value)}
            disabled={m.value === "matched-preview"}
            title={m.value === "matched-preview" ? "Coming soon" : m.label}
            className={`px-2 h-6 rounded text-xxs font-medium transition-colors
              ${abMode === m.value
                ? "bg-studio-accent text-white"
                : "bg-studio-active text-studio-text-dim hover:text-studio-text"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
