/**
 * Per-track automation parameter controls — lives in the left deck panel
 * so the timeline playhead never overlaps dropdowns and value readouts.
 */
import {
  useStudioAutomationStore,
  AUTOMATION_PARAMS,
  AUTO_PARAM_ROW_H,
  type AutomationParam,
} from "../../stores/studioAutomationStore";
import type { DeckMix } from "../../lib/deckMixEngine";
import { AutomationValueReadout } from "./AutomationEditor";
import { getBaselineNorm, sampleKeyframes } from "../../lib/automationMath";
import { STUDIO_SIDEBAR, STUDIO_GRID } from "./setTimelineLayout";

interface Props {
  laneIndex: number;
  color: string;
  panelHeight: number;
  playheadSec: number;
  showAutomation: boolean;
  mix: DeckMix;
}

function paramCategory(param: AutomationParam): string {
  const cat = AUTOMATION_PARAMS.find(p => p.param === param)?.category ?? "mixer";
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export function AutomationLaneControls({
  laneIndex,
  color,
  panelHeight,
  playheadSec,
  showAutomation,
  mix,
}: Props) {
  const globalEnabled = useStudioAutomationStore(s => s.globalEnabled);
  const editMode = useStudioAutomationStore(s => s.editMode);
  const expanded = useStudioAutomationStore(s => s.tracks[laneIndex]?.expanded ?? false);
  const track = useStudioAutomationStore(s => s.tracks[laneIndex]);
  const lanes = track?.lanes ?? ["trackVolume"];
  const activeLane = track?.activeLane ?? "trackVolume";
  const armed = track?.armed ?? false;
  const setActiveLane = useStudioAutomationStore(s => s.setActiveLane);
  const setTrackArmed = useStudioAutomationStore(s => s.setTrackArmed);
  const addLane = useStudioAutomationStore(s => s.addLane);
  const removeLane = useStudioAutomationStore(s => s.removeLane);
  const clearCurve = useStudioAutomationStore(s => s.clearCurve);

  const enabled = globalEnabled && showAutomation;
  const availableToAdd = AUTOMATION_PARAMS.filter(p => !lanes.includes(p.param));
  const stopDrag = (e: React.MouseEvent) => e.stopPropagation();

  if (!expanded || panelHeight <= 0) return null;

  const paramRowH = lanes.length > 0
    ? panelHeight / lanes.length
    : AUTO_PARAM_ROW_H;

  return (
    <div
      onMouseDown={stopDrag}
      onClick={stopDrag}
      style={{
        height: panelHeight,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: STUDIO_SIDEBAR,
        borderTop: `1px solid ${STUDIO_GRID}`,
      }}
    >
      {lanes.map(param => {
        const isActive = activeLane === param;
        const kfs = track?.curves[param] ?? [];
        const playNorm = sampleKeyframes(kfs, playheadSec) ?? getBaselineNorm(mix, param);

        return (
          <div
            key={param}
            onClick={() => setActiveLane(laneIndex, param)}
            style={{
              height: paramRowH,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "4px 6px",
              borderBottom: `1px solid ${STUDIO_GRID}`,
              background: isActive ? "#1a1a1a" : STUDIO_SIDEBAR,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 7, fontWeight: 700, color, letterSpacing: "0.04em" }}>
                AUTO
              </span>
              {editMode === "record" && armed && isActive && (
                <span style={{ fontSize: 6, color: "#ff2222", fontWeight: 700 }}>●</span>
              )}
              {!enabled && (
                <span style={{ fontSize: 6, color: "#555" }}>off</span>
              )}
            </div>

            {editMode === "record" && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setTrackArmed(laneIndex, !armed); }}
                title={armed ? "Disarm track" : "Arm track for recording"}
                style={{
                  height: 12,
                  fontSize: 6,
                  fontWeight: 800,
                  border: `1px solid ${armed ? "#ff2222" : "#444"}`,
                  background: armed ? "#ff222233" : "#222",
                  color: armed ? "#ff6666" : "#666",
                  borderRadius: 2,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {armed ? "● ARMED" : "○ ARM"}
              </button>
            )}

            <select
              value={paramCategory(param)}
              onChange={() => {}}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 7, background: "#111", color: "#aaa",
                border: "1px solid #333", borderRadius: 2, padding: "1px 2px", width: "100%",
              }}
            >
              <option>{paramCategory(param)}</option>
            </select>

            <select
              value={param}
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const next = e.target.value as AutomationParam;
                if (next !== param) {
                  removeLane(laneIndex, param);
                  addLane(laneIndex, next);
                  setActiveLane(laneIndex, next);
                }
              }}
              style={{
                fontSize: 7,
                background: "#111",
                color: isActive ? color : "#ccc",
                border: `1px solid ${isActive ? color + "66" : "#333"}`,
                borderRadius: 2,
                padding: "1px 2px",
                width: "100%",
                fontWeight: isActive ? 700 : 400,
              }}
            >
              {AUTOMATION_PARAMS.map(p => (
                <option key={p.param} value={p.param}>{p.label}</option>
              ))}
            </select>

            <AutomationValueReadout param={param} norm={playNorm} />

            <div style={{ display: "flex", gap: 2, marginTop: "auto" }}>
              {kfs.length > 0 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); clearCurve(laneIndex, param); }}
                  title="Clear automation"
                  style={{
                    flex: 1, fontSize: 7, background: "#222", border: "1px solid #333",
                    borderRadius: 2, color: "#666", cursor: "pointer", padding: 0, height: 14,
                  }}
                >
                  CLR
                </button>
              )}
              {lanes.length > 1 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeLane(laneIndex, param); }}
                  title="Remove lane"
                  style={{
                    flex: 1, fontSize: 8, background: "#222", border: "1px solid #333",
                    borderRadius: 2, color: "#666", cursor: "pointer", padding: 0, height: 14,
                  }}
                >
                  −
                </button>
              )}
              {availableToAdd.length > 0 && param === lanes[lanes.length - 1] && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    addLane(laneIndex, availableToAdd[0].param);
                  }}
                  title="Add automation lane"
                  style={{
                    flex: 1, fontSize: 8, background: "#222", border: "1px solid #333",
                    borderRadius: 2, color: color, cursor: "pointer", padding: 0, height: 14,
                  }}
                >
                  +
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
