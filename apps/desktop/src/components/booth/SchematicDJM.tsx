/**
 * DJM-A9 digital twin — pixel-matched Pioneer mixer layout.
 */
import type { DJMChannelState, DJMMixerState } from "../../stores/boothStore";
import type { CfAssign } from "../../lib/deckMixEngine";
import { PioneerFaderCap } from "../setbuilder/PioneerFaderCap";
import { faderDbToPos, faderPosToDb } from "../../lib/proToolsFaderScale";
import { PIONEER } from "./pioneerTheme";
import {
  PioneerChassis,
  PioneerKnob,
  PioneerPadBtn,
  PioneerSectionLabel,
} from "./PioneerPrimitives";
import { SchematicMeter } from "./SchematicMeter";
import { useCallback, useEffect, useRef } from "react";

export interface ChannelHandlers {
  onTrim: (ch: number, v: number) => void;
  onEq: (ch: number, band: "high" | "mid" | "low" | "filter", v: number) => void;
  onFader: (ch: number, db: number) => void;
  onCue: (ch: number) => void;
  onSolo: (ch: number) => void;
  onMute: (ch: number) => void;
  onCfAssign: (ch: number, a: CfAssign) => void;
}

const SOUND_COLOR_FX = ["SPACE", "D.ECHO", "SWEEP", "NOISE", "CRUSH", "FILTER"];
const BEAT_FX = ["DELAY", "ECHO", "SPIRAL", "REVERB"];

function PioneerChannelFader({
  valueDb, height, onChange,
}: {
  valueDb: number;
  height: number;
  onChange?: (db: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pos = faderDbToPos(Math.max(-60, Math.min(12, valueDb)));

  const updateFromY = useCallback((clientY: number) => {
    if (!onChange) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const uPos = faderDbToPos(0);
    const snap = Math.abs(raw - uPos) < 0.025 ? uPos : raw;
    onChange(Math.round(Math.max(-60, Math.min(12, faderPosToDb(snap))) * 10) / 10);
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromY(e.clientY); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateFromY]);

  const unityPct = faderDbToPos(0) * 100;
  const scaleMarks = [10, 7, 5, 3, 0];

  return (
    <div style={{ display: "flex", gap: 2, alignItems: "stretch" }}>
      <div style={{
        width: 10, position: "relative", height,
        fontSize: 5, color: PIONEER.label, fontWeight: 600,
      }}>
        {scaleMarks.map(m => (
          <span key={m} style={{
            position: "absolute", right: 0,
            top: `${(1 - m / 10) * 88 + 6}%`,
            transform: "translateY(-50%)",
          }}>
            {m}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        onMouseDown={e => {
          if (!onChange) return;
          e.preventDefault();
          dragging.current = true;
          updateFromY(e.clientY);
        }}
        onDoubleClick={() => onChange?.(0)}
        style={{
          width: 18, height, position: "relative",
          background: PIONEER.faderTrack,
          borderRadius: 2,
          border: "1px solid #2a2a2a",
          boxShadow: "inset 0 3px 10px rgba(0,0,0,0.95)",
          cursor: onChange ? "ns-resize" : "default",
        }}
      >
        <div style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          width: 2, top: 4, bottom: 4, background: "#1e1e1e",
        }} />
        <div style={{
          position: "absolute", left: 0, right: 0,
          top: `${unityPct}%`, height: 1, background: "#888",
        }} />
        <PioneerFaderCap topPct={(1 - pos) * 100} capHeight={12} inset={2} />
      </div>
    </div>
  );
}

function PioneerCueButton({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        width: 32, height: 32, borderRadius: "50%", padding: 0, border: "none",
        background: active
          ? "radial-gradient(circle at 38% 32%, #ffb74d, #ff6d00 60%, #e65100)"
          : "radial-gradient(circle at 38% 32%, #3a3a3a, #1a1a1a 70%, #0a0a0a)",
        boxShadow: active ? PIONEER.orangeGlow : "inset 0 2px 6px rgba(0,0,0,0.8)",
        fontSize: 7, fontWeight: 900, color: active ? "#111" : PIONEER.label,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      CUE
    </button>
  );
}

interface Props {
  channels: DJMChannelState[];
  mixer: DJMMixerState;
  onCrossfaderChange?: (pos: number) => void;
  interactive?: boolean;
  channelHandlers?: ChannelHandlers;
}

export function SchematicDJM({ channels, mixer, onCrossfaderChange, interactive, channelHandlers }: Props) {
  const h = channelHandlers;
  const knob = (fn?: (v: number) => void) => interactive ? fn : undefined;

  return (
    <PioneerChassis width={600} style={{ minHeight: 580, borderRadius: 8 }}>
      {/* Header */}
      <div style={{
        padding: "6px 14px 4px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: `1px solid ${PIONEER.faceplateEdge}`,
        background: "linear-gradient(180deg, #1a1a1a, #111)",
      }}>
        <span style={{
          fontSize: 13, color: PIONEER.labelHi, fontWeight: 300,
          letterSpacing: "0.22em",
        }}>
          DJM-A9
        </span>
        <span style={{
          fontSize: 7, color: mixer.beatFxOn ? PIONEER.blue : PIONEER.label,
          fontWeight: 800, letterSpacing: "0.1em",
        }}>
          {mixer.beatFxOn ? `● ${mixer.beatFxName}` : "BEAT FX"}
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, padding: "8px 6px", gap: 4 }}>
        {/* MIC */}
        <div style={{
          width: 44, borderRight: `1px solid ${PIONEER.faceplateEdge}`,
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 6, padding: "4px 2px",
        }}>
          <PioneerSectionLabel>MIC</PioneerSectionLabel>
          <PioneerKnob value={0} label="LEVEL" size={22} />
          <PioneerPadBtn label="TALK" width={36} height={16} />
        </div>

        {/* Sound Color FX */}
        <div style={{
          width: 58, borderRight: `1px solid ${PIONEER.faceplateEdge}`,
          display: "flex", flexDirection: "column", gap: 3, padding: "2px 4px",
        }}>
          <PioneerSectionLabel>COLOR FX</PioneerSectionLabel>
          {SOUND_COLOR_FX.map(fx => (
            <div key={fx} style={{
              fontSize: 5, fontWeight: 800, padding: "3px 2px", textAlign: "center",
              borderRadius: 2,
              background: mixer.soundColorFx === fx
                ? "linear-gradient(180deg, #ff980044, #ff980022)"
                : "linear-gradient(180deg, #222, #141414)",
              color: mixer.soundColorFx === fx ? PIONEER.orange : PIONEER.label,
              border: `1px solid ${mixer.soundColorFx === fx ? "#ff980066" : "#2a2a2a"}`,
              letterSpacing: "0.04em",
            }}>
              {fx}
            </div>
          ))}
          <PioneerKnob value={mixer.soundColorParam * 12} label="PARAM" size={24} large />
        </div>

        {/* 4 channel strips */}
        {channels.map(ch => (
          <div key={ch.channelIndex} style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 5,
            borderRight: ch.channelIndex < 3 ? `1px solid ${PIONEER.faceplateEdge}` : "none",
            padding: "2px 4px",
          }}>
            <span style={{
              fontSize: 7, color: ch.color, fontWeight: 900,
              letterSpacing: "0.1em",
            }}>
              CH {ch.channelIndex + 1}
            </span>

            <PioneerKnob
              value={ch.trimDb} label="TRIM" size={26} large
              onChange={knob(v => h?.onTrim(ch.channelIndex, v))}
            />

            <div style={{ display: "flex", width: "100%", gap: 2, justifyContent: "center" }}>
              <PioneerKnob value={ch.high} label="HI" size={22}
                onChange={knob(v => h?.onEq(ch.channelIndex, "high", v))} />
              <PioneerKnob value={ch.mid} label="MID" size={22}
                onChange={knob(v => h?.onEq(ch.channelIndex, "mid", v))} />
              <PioneerKnob value={ch.low} label="LOW" size={22}
                onChange={knob(v => h?.onEq(ch.channelIndex, "low", v))} />
            </div>

            <PioneerKnob
              value={ch.filter} label="FILTER" size={24} large
              onChange={knob(v => h?.onEq(ch.channelIndex, "filter", v))}
            />

            <PioneerCueButton
              active={ch.cue}
              onClick={interactive ? () => h?.onCue(ch.channelIndex) : undefined}
            />

            <div style={{ display: "flex", gap: 3 }}>
              <PioneerPadBtn
                label="S"
                active={ch.solo}
                color={PIONEER.green}
                width={22}
                height={16}
                onClick={interactive ? () => h?.onSolo(ch.channelIndex) : undefined}
              />
              <PioneerPadBtn
                label="M"
                active={ch.mute}
                color={PIONEER.red}
                width={22}
                height={16}
                onClick={interactive ? () => h?.onMute(ch.channelIndex) : undefined}
              />
            </div>

            <div style={{ display: "flex", gap: 2, width: "100%" }}>
              {(["A", "THRU", "B"] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={interactive ? () => h?.onCfAssign(ch.channelIndex, a) : undefined}
                  style={{
                    flex: 1, fontSize: 6, fontWeight: 800, textAlign: "center",
                    padding: "3px 0", borderRadius: 2, border: "none",
                    background: ch.cfAssign === a
                      ? `linear-gradient(180deg, ${ch.color}cc, ${ch.color}88)`
                      : "linear-gradient(180deg, #2a2a2a, #141414)",
                    color: ch.cfAssign === a ? "#111" : PIONEER.label,
                    cursor: interactive ? "pointer" : "default",
                    boxShadow: ch.cfAssign === a ? `0 0 6px ${ch.color}66` : "none",
                  }}
                >
                  {a === "THRU" ? "T" : a}
                </button>
              ))}
            </div>

            <div style={{
              display: "flex", gap: 4, alignItems: "flex-end",
              marginTop: "auto", paddingBottom: 4,
            }}>
              <SchematicMeter leftDb={ch.meterL} rightDb={ch.meterR} height={100} segments={14} />
              <PioneerChannelFader
                valueDb={ch.faderDb}
                height={100}
                onChange={interactive ? db => h?.onFader(ch.channelIndex, db) : undefined}
              />
            </div>
          </div>
        ))}

        {/* Beat FX + Master */}
        <div style={{
          width: 88, display: "flex", flexDirection: "column",
          gap: 5, padding: "2px 6px",
        }}>
          <PioneerSectionLabel>BEAT FX</PioneerSectionLabel>

          <div style={{
            background: PIONEER.screenBg,
            border: `2px solid ${PIONEER.screenBezel}`,
            borderRadius: 4,
            padding: "6px 8px",
            boxShadow: "inset 0 0 12px rgba(0,0,0,0.9)",
          }}>
            <div style={{ fontSize: 8, color: PIONEER.blue, fontWeight: 800 }}>
              {mixer.beatFxName}
            </div>
            <div style={{
              fontSize: 14, color: PIONEER.white, fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}>
              {Math.round(mixer.tapBpm)}
            </div>
            <div style={{ fontSize: 6, color: PIONEER.label }}>BPM · 1/2 · 1 · 2</div>
          </div>

          {BEAT_FX.map(fx => (
            <div key={fx} style={{
              fontSize: 6, fontWeight: 700, padding: "3px 4px", borderRadius: 2,
              background: mixer.beatFxName === fx && mixer.beatFxOn ? "#29b6f622" : "#141414",
              color: mixer.beatFxName === fx ? PIONEER.blue : PIONEER.label,
              border: `1px solid ${mixer.beatFxName === fx ? "#29b6f644" : "#2a2a2a"}`,
            }}>
              {fx}
            </div>
          ))}

          <div style={{
            height: 28, background: "#0a0a0a", borderRadius: 3,
            border: "1px solid #2a2a2a", position: "relative",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8)",
          }}>
            <div style={{
              position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
              width: `${mixer.beatFxLevel * 100}%`, height: 6,
              background: `linear-gradient(90deg, ${PIONEER.blue}88, ${PIONEER.blue})`,
              borderRadius: 2,
            }} />
            <span style={{
              fontSize: 5, color: PIONEER.label, position: "absolute",
              left: 4, top: 3, letterSpacing: "0.08em",
            }}>
              X-PAD
            </span>
          </div>

          <button type="button" style={{
            width: 40, height: 40, borderRadius: "50%", margin: "0 auto",
            border: `3px solid ${mixer.beatFxOn ? PIONEER.red : "#444"}`,
            background: mixer.beatFxOn
              ? `radial-gradient(circle, ${PIONEER.red}cc, #b71c1c)`
              : "radial-gradient(circle, #333, #111)",
            boxShadow: mixer.beatFxOn ? `0 0 16px ${PIONEER.red}88` : "none",
            fontSize: 7, fontWeight: 900, color: mixer.beatFxOn ? PIONEER.white : PIONEER.label,
          }}>
            ON
          </button>

          <div style={{
            marginTop: "auto", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 6,
          }}>
            <PioneerSectionLabel>MASTER</PioneerSectionLabel>
            <SchematicMeter
              leftDb={mixer.masterMeterL}
              rightDb={mixer.masterMeterR}
              height={72}
              segments={16}
            />
            <PioneerKnob value={mixer.masterDb} min={-60} max={12} label="LEVEL" size={30} large />
          </div>
        </div>
      </div>

      {/* Crossfader */}
      <div style={{
        padding: "8px 20px 12px",
        borderTop: `1px solid ${PIONEER.faceplateEdge}`,
        background: "linear-gradient(180deg, #141414, #0a0a0a)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 8, color: PIONEER.labelHi, fontWeight: 800, width: 12 }}>A</span>
        <div
          style={{
            flex: 1, height: 16, background: PIONEER.faderTrack,
            borderRadius: 8, position: "relative",
            cursor: interactive ? "ew-resize" : "default",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.9)",
            border: "1px solid #2a2a2a",
          }}
          onMouseDown={interactive ? (e) => {
            const el = e.currentTarget;
            const update = (cx: number) => {
              const rect = el.getBoundingClientRect();
              onCrossfaderChange?.(Math.max(0, Math.min(1, (cx - rect.left) / rect.width)));
            };
            update(e.clientX);
            const onMove = (ev: MouseEvent) => update(ev.clientX);
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          } : undefined}
        >
          <div style={{
            position: "absolute",
            left: `${mixer.crossfaderPos * 100}%`,
            top: "50%", transform: "translate(-50%, -50%)",
            width: 36, height: 28, borderRadius: 4,
            background: "linear-gradient(180deg, #e0e0e0 0%, #999 35%, #666 65%, #aaa 100%)",
            boxShadow: "0 3px 8px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.4)",
            border: "1px solid #555",
          }}>
            <div style={{
              position: "absolute", left: 4, right: 4, top: "50%", height: 2,
              background: PIONEER.white, transform: "translateY(-50%)",
            }} />
          </div>
        </div>
        <span style={{ fontSize: 8, color: PIONEER.labelHi, fontWeight: 800, width: 12 }}>B</span>
      </div>
    </PioneerChassis>
  );
}
