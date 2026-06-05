/**
 * Pro Tools–style timeline grid — charcoal background + vertical lines.
 * Rendered once behind all track lanes; scrolls with the timeline.
 */
import { memo, useMemo, useSyncExternalStore } from "react";
import { isZooming, subscribeZoom } from "../../lib/zoomInteraction";
import {
  TL_CANVAS_BG,
  TL_GRID_MAJOR,
  TL_GRID_MINOR,
} from "../../lib/waveformEngine/colors";
import {
  buildGridLines,
  minorGridInterval,
  tickInterval,
  timeToPx,
} from "../../lib/timelineUtils";

export const TimelineGrid = memo(function TimelineGrid({
  contentWidth,
  height,
  maxDuration,
  pixelsPerSecond,
  scrollLeft,
}: {
  contentWidth: number;
  height: number;
  maxDuration: number;
  pixelsPerSecond: number;
  scrollLeft: number;
}) {
  const zooming = useSyncExternalStore(subscribeZoom, isZooming, () => false);

  const majorStep = tickInterval(maxDuration, pixelsPerSecond);
  const minorStep = zooming ? null : minorGridInterval(majorStep, pixelsPerSecond);

  const { major, minor } = useMemo(
    () => buildGridLines(maxDuration, majorStep, minorStep),
    [maxDuration, majorStep, minorStep],
  );

  return (
    <div
      className="absolute top-0 overflow-hidden pointer-events-none"
      style={{ left: 0, right: 0, height }}
    >
      <div
        style={{
          width: contentWidth,
          height: "100%",
          transform: `translateX(-${scrollLeft}px)`,
          position: "relative",
          background: TL_CANVAS_BG,
        }}
      >
        {minor.map((t) => (
          <div
            key={`g-minor-${t}`}
            className="absolute top-0 bottom-0"
            style={{
              left: timeToPx(t, pixelsPerSecond),
              width: 1,
              background: TL_GRID_MINOR,
            }}
          />
        ))}
        {major.map((t) => (
          <div
            key={`g-major-${t}`}
            className="absolute top-0 bottom-0"
            style={{
              left: timeToPx(t, pixelsPerSecond),
              width: 1,
              background: TL_GRID_MAJOR,
            }}
          />
        ))}
      </div>
    </div>
  );
});
