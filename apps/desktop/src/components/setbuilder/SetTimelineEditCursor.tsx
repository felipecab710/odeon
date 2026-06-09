/**
 * Edit cursor — vertical line at hover position (Audacity-style).
 */
import { memo } from "react";

const EDIT_CURSOR_COLOR = "#4A90D9";

export const SetTimelineEditCursor = memo(function SetTimelineEditCursor({
  timeSec,
  pixelsPerSecond,
  height,
}: {
  timeSec: number;
  pixelsPerSecond: number;
  height: number;
}) {
  const left = timeSec * pixelsPerSecond;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        height,
        width: 1,
        background: EDIT_CURSOR_COLOR,
        opacity: 0.55,
        zIndex: 28,
        pointerEvents: "none",
      }}
    />
  );
});
