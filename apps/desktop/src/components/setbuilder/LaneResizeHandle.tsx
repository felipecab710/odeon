/**
 * Bottom-edge drag handle — resize a timeline deck row vertically.
 */
import { useCallback } from "react";
import { STUDIO_GRID } from "./setTimelineLayout";

interface Props {
  onResizeStart: (e: React.MouseEvent, currentHeight: number) => void;
}

export function LaneResizeHandle({ onResizeStart }: Props) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shell = e.currentTarget.parentElement;
    if (!shell) return;
    onResizeStart(e, shell.getBoundingClientRect().height);
  }, [onResizeStart]);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize deck lane"
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 7,
        cursor: "ns-resize",
        touchAction: "none",
        zIndex: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{
        width: 28,
        height: 3,
        borderRadius: 2,
        background: STUDIO_GRID,
        pointerEvents: "none",
        opacity: 0.7,
      }} />
    </div>
  );
}
