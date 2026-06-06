/**
 * Per-track automation graph lanes — controls live in AutomationLaneControls (left panel).
 */
import type { DeckMix } from "../../lib/deckMixEngine";
import {
  useStudioAutomationStore,
  AUTO_PARAM_ROW_H,
  type AutomationParam,
} from "../../stores/studioAutomationStore";
import { AutomationEditor } from "./AutomationEditor";
import { STUDIO_BG_DEEP, STUDIO_GRID } from "./setTimelineLayout";

interface Props {
  laneIndex: number;
  color: string;
  width: number;
  panelHeight: number;
  startSec: number;
  durationSec: number;
  playheadSec: number;
  showAutomation: boolean;
  mix: DeckMix;
  onMixChange: (mix: DeckMix) => void;
}

export function TrackAutomationLane({
  laneIndex,
  color,
  width,
  panelHeight,
  startSec,
  durationSec,
  playheadSec,
  showAutomation,
  mix,
  onMixChange,
}: Props) {
  const globalEnabled = useStudioAutomationStore(s => s.globalEnabled);
  const editMode = useStudioAutomationStore(s => s.editMode);
  const expanded = useStudioAutomationStore(s => s.tracks[laneIndex]?.expanded ?? false);
  const track = useStudioAutomationStore(s => s.tracks[laneIndex]);
  const lanes = track?.lanes ?? ["trackVolume"];
  const activeLane = track?.activeLane ?? "trackVolume";
  const setActiveLane = useStudioAutomationStore(s => s.setActiveLane);

  const enabled = globalEnabled && showAutomation;
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
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        borderLeft: `1px solid ${STUDIO_GRID}`,
        borderRight: `1px solid ${STUDIO_GRID}`,
        borderBottom: `1px solid ${STUDIO_GRID}`,
        background: STUDIO_BG_DEEP,
      }}
    >
      {lanes.map((param: AutomationParam) => {
        const isActive = activeLane === param;

        return (
          <div
            key={param}
            onClick={() => setActiveLane(laneIndex, param)}
            style={{
              height: paramRowH,
              flexShrink: 0,
              borderBottom: `1px solid ${STUDIO_GRID}`,
              background: isActive ? "#1a1a1a" : STUDIO_BG_DEEP,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <AutomationEditor
              laneIndex={laneIndex}
              param={param}
              color={color}
              width={width}
              height={Math.floor(paramRowH)}
              startSec={startSec}
              durationSec={durationSec}
              playheadSec={playheadSec}
              editMode={editMode}
              enabled={enabled}
              mix={mix}
              onMixChange={onMixChange}
            />
          </div>
        );
      })}
    </div>
  );
}
