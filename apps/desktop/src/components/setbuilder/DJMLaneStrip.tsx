/**
 * DJM-lite channel strip — trim, EQ, cue/solo/mute, CF assign, fader, meter.
 * Wired to odeon-engine via deckMixEngine helpers.
 */
import type { DeckMix, CfAssign } from "../../lib/deckMixEngine";
import { setTrackId } from "../../lib/deckMixEngine";
import { useStudioAutomationStore } from "../../stores/studioAutomationStore";
import { STUDIO_SIDEBAR, LANE_HEIGHT } from "./setTimelineLayout";
import { DJMKnob } from "./DJMKnob";
import { DJMVerticalFader } from "./DJMVerticalFader";
import { useEngineStore } from "../../stores/engineStore";
import { SchematicMeter } from "../booth/SchematicMeter";

interface Props {
  index: number;
  entryId: string;
  mix: DeckMix;
  color: string;
  height?: number;
  selected?: boolean;
  onSelect?: () => void;
  onChange: (mix: DeckMix) => void;
}

export function DJMLaneStrip({
  index, entryId, mix, color, height = LANE_HEIGHT, selected, onSelect, onChange,
}: Props) {
  const trackId = setTrackId(entryId);
  const meters = useEngineStore(s => s.trackStates[trackId]);
  const expanded = useStudioAutomationStore(s => s.tracks[index]?.expanded ?? false);
  const armed = useStudioAutomationStore(s => s.tracks[index]?.armed ?? false);
  const editMode = useStudioAutomationStore(s => s.editMode);
  const toggleExpanded = useStudioAutomationStore(s => s.toggleTrackExpanded);
  const setTrackArmed = useStudioAutomationStore(s => s.setTrackArmed);

  const btn = (active: boolean, accent?: string) => ({
    width: 16, height: 14, fontSize: 7, fontWeight: 700, border: "none",
    background: active ? (accent ?? color) : "#2a2a2a",
    color: active ? "#111" : "#666",
    borderRadius: 2, cursor: "pointer", padding: 0,
  } as const);

  const cfBtn = (assign: CfAssign) => ({
    flex: 1, height: 12, fontSize: 6, fontWeight: 700, border: "none",
    background: mix.cfAssign === assign ? color : "#222",
    color: mix.cfAssign === assign ? "#111" : "#555",
    borderRadius: 2, cursor: "pointer", padding: 0,
  } as const);

  const patch = (p: Partial<DeckMix>) => onChange({ ...mix, ...p });

  const stripPad = 8;
  const faderAreaH = Math.max(52, height - stripPad);
  const meterSegments = Math.min(48, Math.max(14, Math.round(faderAreaH / 3.5)));

  return (
    <div
      onClick={() => onSelect?.()}
      style={{
        height,
        padding: "4px 6px",
        display: "flex", gap: 4,
        alignItems: "stretch",
        background: STUDIO_SIDEBAR,
        cursor: onSelect ? "pointer" : undefined,
        boxShadow: selected ? `inset 0 0 0 2px ${color}` : undefined,
      }}
    >
      {/* Left controls */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
          <button
            type="button"
            title={expanded ? "Collapse automation" : "Expand automation"}
            onClick={() => toggleExpanded(index)}
            style={{
              width: 14, height: 14, fontSize: 8, fontWeight: 700,
              border: `1px solid ${expanded ? color : "#444"}`,
              background: expanded ? `${color}33` : "#222",
              color: expanded ? color : "#888",
              borderRadius: 2, cursor: "pointer", padding: 0, flexShrink: 0,
            }}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.05em" }}>
            Deck {index + 1}
          </span>
        </div>

        <div style={{ display: "flex", gap: 1, marginBottom: 3 }}>
          <DJMKnob value={mix.trimDb} min={-12} max={12} label="Trim" color={color}
            onChange={v => patch({ trimDb: v })} size={18} />
          <DJMKnob value={mix.high} min={-12} max={12} label="Hi" color={color} center={0}
            onChange={v => patch({ high: v })} size={18} />
          <DJMKnob value={mix.mid} min={-12} max={12} label="Mid" color={color} center={0}
            onChange={v => patch({ mid: v })} size={18} />
          <DJMKnob value={mix.low} min={-12} max={12} label="Low" color={color} center={0}
            onChange={v => patch({ low: v })} size={18} />
          <DJMKnob value={mix.filter} min={-12} max={12} label="Flt" color={color} center={0}
            onChange={v => patch({ filter: v })} size={18} />
        </div>

        <div style={{ display: "flex", gap: 2, marginBottom: 3 }}>
          {editMode === "record" && (
            <button
              style={btn(armed, "#ff2222")}
              title={armed ? "Disarm automation record" : "Arm for automation record"}
              onClick={() => setTrackArmed(index, !armed)}
            >R</button>
          )}
          <button style={btn(mix.solo)} title="Solo"
            onClick={() => patch({ solo: !mix.solo })}>S</button>
          <button style={btn(mix.cue, "#ff9800")} title="Cue (headphone preview via solo)"
            onClick={() => patch({ cue: !mix.cue })}>C</button>
          <button style={btn(mix.mute)} title="Mute"
            onClick={() => patch({ mute: !mix.mute })}>M</button>
          <button style={btn(mix.showAutomation)} title="Show automation"
            onClick={() => patch({ showAutomation: !mix.showAutomation })}>A</button>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          <button style={cfBtn("A")} onClick={() => patch({ cfAssign: "A" })}>A</button>
          <button style={cfBtn("THRU")} onClick={() => patch({ cfAssign: "THRU" })}>THRU</button>
          <button style={cfBtn("B")} onClick={() => patch({ cfAssign: "B" })}>B</button>
        </div>
      </div>

      {/* Fader + meter — stretch to full lane height when expanded */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 2, flexShrink: 0 }}>
        <SchematicMeter
          leftDb={meters?.leftMeterDb ?? -90}
          rightDb={meters?.rightMeterDb ?? -90}
          height={faderAreaH}
          segments={meterSegments}
        />
        <DJMVerticalFader
          valueDb={mix.faderDb}
          onChange={v => patch({ faderDb: v })}
          height={faderAreaH}
        />
      </div>
    </div>
  );
}
