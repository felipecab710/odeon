/**
 * Drag handle between automation panel and waveform — reallocates vertical space.
 */
import { STUDIO_GRID } from "./setTimelineLayout";

interface Props {
  onResizeStart: (e: React.MouseEvent) => void;
}

export function AutomationWaveSplitter({ onResizeStart }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize automation vs waveform"
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart(e);
      }}
      onClick={e => e.stopPropagation()}
      style={{
        height: 6,
        flexShrink: 0,
        cursor: "ns-resize",
        touchAction: "none",
        background: STUDIO_GRID,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 8,
      }}
    >
      <div style={{
        width: 24,
        height: 2,
        borderRadius: 1,
        background: "#555",
        pointerEvents: "none",
      }} />
    </div>
  );
}
