import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";
import { TrackLane } from "./TrackLane";

const RULER_WIDTH_PX = 120; // approximately 120s visible

export function TrackList() {
  const { project } = useProjectStore();
  const { positionSeconds } = useTransportStore();

  if (!project) return null;

  const playheadPercent = Math.min(
    100,
    (positionSeconds / RULER_WIDTH_PX) * 100
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Timeline ruler */}
      <div className="flex h-6 border-b border-studio-border bg-studio-bg flex-shrink-0">
        {/* Track label gutter */}
        <div className="w-40 min-w-40 border-r border-studio-border" />
        {/* Mute/solo gutter */}
        <div className="w-12 border-r border-studio-border" />
        {/* Ruler area */}
        <div className="flex-1 relative overflow-hidden">
          {/* Tick marks every 10s */}
          {Array.from({ length: 13 }).map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex flex-col justify-start"
              style={{ left: `${(i * 10 / RULER_WIDTH_PX) * 100}%` }}
            >
              <div className="w-px h-3 bg-studio-border" />
              <span className="text-xxs text-studio-text-faint ml-0.5 mt-0.5">
                {i === 0 ? "0" : `${i * 10}s`}
              </span>
            </div>
          ))}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-studio-accent pointer-events-none transition-all"
            style={{ left: `${playheadPercent}%` }}
          />
        </div>
      </div>

      {/* Track lanes */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {project.tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-studio-text-faint text-xs gap-2">
            <div className="text-2xl">♪</div>
            <div>Upload a reference track to get started.</div>
          </div>
        ) : (
          project.tracks.map((track) => (
            <TrackLane key={track.id} track={track} />
          ))
        )}
      </div>
    </div>
  );
}
