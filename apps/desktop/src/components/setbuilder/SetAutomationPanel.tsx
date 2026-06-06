/**
 * Global automation header — enable, draw/record mode, expand all.
 */
import {
  useStudioAutomationStore,
  AUTO_PANEL_H,
} from "../../stores/studioAutomationStore";
import { STUDIO_GRID, STUDIO_SIDEBAR } from "./setTimelineLayout";

interface Props {
  trackCount: number;
}

export function SetAutomationPanel({ trackCount }: Props) {
  const globalEnabled = useStudioAutomationStore(s => s.globalEnabled);
  const expandAll = useStudioAutomationStore(s => s.expandAll);
  const editMode = useStudioAutomationStore(s => s.editMode);
  const isRecording = useStudioAutomationStore(s => s.isRecording);
  const setGlobalEnabled = useStudioAutomationStore(s => s.setGlobalEnabled);
  const setExpandAll = useStudioAutomationStore(s => s.setExpandAll);
  const setEditMode = useStudioAutomationStore(s => s.setEditMode);
  const setRecording = useStudioAutomationStore(s => s.setRecording);

  const btn = (active: boolean) => ({
    background: active ? "#3a3a3a" : "#222",
    border: `1px solid ${active ? "#888" : "#444"}`,
    borderRadius: 3,
    color: active ? "#e0e0e0" : "#888",
    fontSize: 9,
    fontWeight: 700,
    padding: "2px 8px",
    cursor: "pointer",
    letterSpacing: "0.04em",
  } as const);

  return (
    <div style={{
      height: AUTO_PANEL_H,
      flexShrink: 0,
      background: STUDIO_SIDEBAR,
      borderBottom: `1px solid ${STUDIO_GRID}`,
      display: "flex",
      alignItems: "center",
      padding: "0 12px",
      gap: 8,
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 800,
        color: "#b0b0b0",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}>
        Automation
      </span>

      <button
        type="button"
        style={btn(globalEnabled)}
        onClick={() => setGlobalEnabled(!globalEnabled)}
        title="Enable or bypass all automation"
      >
        {globalEnabled ? "ON" : "OFF"}
      </button>

      <div style={{
        display: "flex",
        background: "#111",
        borderRadius: 3,
        border: "1px solid #333",
        overflow: "hidden",
      }}>
        <button
          type="button"
          style={{
            ...btn(editMode === "draw"),
            borderRadius: 0,
            border: "none",
            borderRight: "1px solid #333",
          }}
          onClick={() => setEditMode("draw")}
          title="Draw — click lane to add breakpoints, drag to adjust"
        >
          Draw
        </button>
        <button
          type="button"
          style={{
            ...btn(editMode === "record"),
            borderRadius: 0,
            border: "none",
          }}
          onClick={() => setEditMode("record")}
          title="Record — arm tracks, hit Record, tweak knobs while playing"
        >
          Record
        </button>
      </div>

      {editMode === "record" && (
        <button
          type="button"
          style={btn(isRecording)}
          onClick={() => setRecording(!isRecording)}
          title="Latch record — capture armed track knob moves during playback"
        >
          {isRecording ? "● REC" : "○ Record"}
        </button>
      )}

      <span style={{ color: "#555", fontSize: 9 }}>
        {trackCount} track{trackCount !== 1 ? "s" : ""}
      </span>

      <span style={{ flex: 1 }} />

      <span style={{ color: "#444", fontSize: 8 }}>
        {editMode === "draw"
          ? "Click lane · drag nodes · dbl-click delete"
          : "Arm deck · REC · play · move faders/EQ"}
      </span>

      <button
        type="button"
        style={btn(expandAll)}
        onClick={() => setExpandAll(!expandAll, trackCount)}
        title="Expand or collapse all track automation lanes"
      >
        {expandAll ? "Collapse All" : "Expand All"}
      </button>
    </div>
  );
}
