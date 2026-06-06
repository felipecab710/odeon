/**
 * DJM-V10 digital twin — realistic Pioneer flagship mixer layout.
 * 4 channel strips (one per deck) styled after the DJM-V10-LF reference.
 */
import type { DJMChannelState, DJMMixerState } from "../../stores/boothStore";
import type { CfAssign } from "../../lib/deckMixEngine";
import { faderDbToPos, faderPosToDb } from "../../lib/proToolsFaderScale";
import { FIGMA_CDJ_SIZE } from "./figmaCdjAssets";
import { PIONEER } from "./pioneerTheme";
import {
  PioneerChassis,
  PioneerKnob,
  PioneerPadBtn,
} from "./PioneerPrimitives";
import {
  useCallback, useEffect, useRef, type CSSProperties, type ReactNode,
} from "react";

export interface ChannelHandlers {
  onTrim: (ch: number, v: number) => void;
  onEq: (ch: number, band: "high" | "mid" | "low" | "filter", v: number) => void;
  onFader: (ch: number, db: number) => void;
  onCue: (ch: number) => void;
  onSolo: (ch: number) => void;
  onMute: (ch: number) => void;
  onCfAssign: (ch: number, a: CfAssign) => void;
}

const CHANNEL_W = 74; // fixed strip width — V10 channels are tall & narrow
const CHANNEL_KNOB_SIZE = 24; // TRIM + EQ + FILTER + SEND all use size + large
const LEFT_COL_W = 60;
const RIGHT_COL_W = 124;
const DJM_H_PAD = 8; // main row padding left + right
const DJM_COL_GAP = 6; // two 3px column gaps
const CHANNELS_W = CHANNEL_W * 4;
/** Outer chassis width — fits columns exactly, no dead space on the right */
export const DJM_WIDTH = DJM_H_PAD + LEFT_COL_W + DJM_COL_GAP + CHANNELS_W + DJM_COL_GAP + RIGHT_COL_W;
const SEND_FX = ["SHORT", "LONG", "DUB", "REVERB"] as const;
const BEAT_FX_EFFECTS = [
  "SHIMMER", "FLANGER", "REVERB", "PHASER", "MELODIC", "FILTER",
  "SPIRAL", "TRANS", "PING", "ROLL", "ECHO", "PITCH", "DELAY", "VINYL",
] as const;

/* ---- engraved silkscreen label ---- */
function Eng({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: 6, fontWeight: 700, color: "#b8b8b8",
      letterSpacing: "0.1em", textAlign: "center",
      textShadow: "0 1px 0 rgba(0,0,0,0.9)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function Rule() {
  return (
    <div style={{
      height: 1, background: "#000",
      boxShadow: "0 1px 0 rgba(255,255,255,0.05)",
      margin: "2px 0",
    }} />
  );
}

function SilkDivider() {
  return <div style={{ width: "100%", height: 1.5, background: "#d0d0d0", flexShrink: 0 }} />;
}

/* ---- recessed sub-panel (engraved metal pocket) ---- */
function Pocket({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: "linear-gradient(180deg, #050505, #0c0c0c)",
      border: "1px solid #000",
      borderRadius: 4,
      boxShadow: "inset 0 2px 6px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.04)",
      ...style,
    }}>
      {children}
    </div>
  );
}

/** 3-position input slide switch (DIGITAL / LINE / PHONO) */
function InputSelector({ activeColor = "#d4e157" }: { activeColor?: string }) {
  const phonoPos = 2;
  return (
    <div style={{
      width: "100%", height: 11, position: "relative",
      background: "linear-gradient(180deg, #0a0a0a, #141414)",
      borderRadius: 2, border: "1px solid #2a2a2a",
      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.85)",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 1, bottom: 1,
        left: `${phonoPos * 33.33 + 1}%`, width: "31%",
        background: `linear-gradient(180deg, ${activeColor}cc, ${activeColor}88)`,
        borderRadius: 1,
        boxShadow: `0 0 4px ${activeColor}55`,
      }} />
      <div style={{
        position: "relative", display: "flex", height: "100%",
        fontSize: 3.5, fontWeight: 800, letterSpacing: "0.02em",
      }}>
        {[
          { label: "◻", lit: false },
          { label: "LINE", lit: false },
          { label: "PHONO", lit: true },
        ].map(({ label, lit }) => (
          <span key={label} style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: lit ? "#111" : PIONEER.label,
          }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- BEAT FX ASSIGN button ---- */
function AssignBtn({ active }: { active?: boolean }) {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: "50%", margin: "0 auto",
      border: `2px solid ${active ? PIONEER.red : "#4a2020"}`,
      background: active
        ? `radial-gradient(circle at 38% 30%, #ff8a80, ${PIONEER.red} 55%, #b71c1c)`
        : "radial-gradient(circle at 38% 30%, #2a1414, #0a0404 70%)",
      boxShadow: active ? `0 0 10px ${PIONEER.red}aa` : "inset 0 2px 4px rgba(0,0,0,0.85)",
    }} />
  );
}

/* ---- channel LED meter dB scale (DJM-V10 silkscreen) ---- */
const CHANNEL_METER_DB = [12, 9, 6, 3, 0, -3, -6, -9, -12, -15, -18, -21, -24, -27, -30] as const;
const MASTER_METER_DB = [9, 6, 3, 0, -3, -6, -9, -12, -15, -18, -21, -24, -27, -30, -33] as const;

function masterLedColor(fromTop: number, lit: boolean): string {
  if (!lit) return "#1a1410";
  if (fromTop <= 1) return "#f04e3e";
  if (fromTop <= 5) return "#f0f0f0";
  return "#e8a030";
}

function masterLedGlow(fromTop: number, lit: boolean): string {
  if (!lit) return "none";
  if (fromTop <= 1) return "0 0 4px rgba(240,78,62,0.9)";
  if (fromTop <= 5) return "0 0 3px rgba(255,255,255,0.55)";
  return "0 0 3px rgba(232,160,48,0.65)";
}

/** Stereo master VU — L/R LED columns with central dB silkscreen */
function MasterVuMeter({ leftDb, rightDb, height }: { leftDb: number; rightDb: number; height: number }) {
  const segs = MASTER_METER_DB.length;
  const toLevel = (db: number) => {
    const clamped = Math.max(-33, Math.min(9, db));
    return ((clamped + 33) / 42) * segs;
  };
  const lLevel = toLevel(leftDb);
  const rLevel = toLevel(rightDb);

  const ledCol = (level: number) => (
    <div style={{
      width: 8, display: "flex", flexDirection: "column-reverse",
      justifyContent: "space-between", alignItems: "center",
      padding: "3px 1px", height: "100%",
    }}>
      {MASTER_METER_DB.map((_, i) => {
        const fullLit = i < Math.floor(level);
        const partial = i === Math.floor(level) && level - Math.floor(level) > 0.04;
        const lit = fullLit || partial;
        const fromTop = segs - 1 - i;
        const color = masterLedColor(fromTop, lit);
        return (
          <div key={i} style={{
            width: 3.5, height: 3.5, borderRadius: "50%", flexShrink: 0,
            background: color,
            opacity: partial ? 0.35 + (level - Math.floor(level)) * 0.65 : 1,
            boxShadow: masterLedGlow(fromTop, lit),
            border: lit ? "none" : "1px solid #0a0a0a",
          }} />
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        display: "flex", gap: 2, height,
        padding: "2px 3px",
        background: "linear-gradient(90deg, #080808, #121212 50%, #080808)",
        borderRadius: 5,
        border: "1px solid #4a4a4a",
        boxShadow: "inset 0 2px 5px rgba(0,0,0,0.9)",
      }}>
        {ledCol(lLevel)}
        <div style={{
          position: "relative", width: 11, height: "100%",
          fontSize: 4, color: "#c8c8c8", fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}>
          {MASTER_METER_DB.map((mark, i) => (
            <span key={mark} style={{
              position: "absolute", left: 0, right: 0, textAlign: "center",
              top: `${(i / (segs - 1)) * 92 + 4}%`,
              transform: "translateY(-50%)",
            }}>
              {mark}
            </span>
          ))}
        </div>
        {ledCol(rLevel)}
      </div>
      <div style={{
        display: "flex", gap: 14, fontSize: 5, color: PIONEER.label,
        fontWeight: 700, letterSpacing: "0.08em",
      }}>
        <span>L</span>
        <span>R</span>
      </div>
    </div>
  );
}

function ClipIndicator({ active }: { active?: boolean }) {
  return (
    <div style={{ textAlign: "center", marginTop: 3 }}>
      <div style={{
        width: 14, height: 5, margin: "0 auto", borderRadius: 1,
        background: active
          ? "radial-gradient(circle, #ff5252, #c62828)"
          : "#1a0808",
        boxShadow: active
          ? "0 0 6px rgba(244,67,54,0.8), inset 0 1px 2px rgba(255,255,255,0.2)"
          : "inset 0 1px 3px rgba(0,0,0,0.8)",
        border: "1px solid #2a1010",
      }} />
      <div style={{ fontSize: 4.5, color: PIONEER.label, fontWeight: 700, marginTop: 1 }}>
        CLIP
      </div>
    </div>
  );
}

function IsolatorKnob({ label, value = 0 }: { label: string; value?: number }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 6, color: "#d8d8d8", fontWeight: 700,
        letterSpacing: "0.06em", marginBottom: 2,
      }}>
        {label}
      </div>
      <PioneerKnob value={value} size={26} ticks={13} min={-26} max={9} />
    </div>
  );
}

function IsolatorOnBtn({ active = true }: { active?: boolean }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 4 }}>
      <div style={{
        width: 14, height: 14, borderRadius: "50%", margin: "0 auto",
        border: `1px solid ${active ? PIONEER.red : "#3a1414"}`,
        background: active
          ? `radial-gradient(circle at 38% 30%, #ff8a80, ${PIONEER.red} 60%, #b71c1c)`
          : "radial-gradient(circle at 38% 30%, #2a1414, #140808 70%)",
        boxShadow: active ? `0 0 8px ${PIONEER.red}aa` : "inset 0 1px 3px rgba(0,0,0,0.8)",
      }} />
      <div style={{ fontSize: 5, color: PIONEER.label, fontWeight: 700, marginTop: 2 }}>
        ON
      </div>
    </div>
  );
}

function chLedColor(segFromTop: number, lit: boolean): string {
  if (!lit) return "#1a1410";
  if (segFromTop === 0) return "#f04e3e";
  if (segFromTop <= 4) return "#f0f0f0";
  return "#e8a030";
}

function chLedGlow(segFromTop: number, lit: boolean): string {
  if (!lit) return "none";
  if (segFromTop === 0) return "0 0 4px rgba(240,78,62,0.9)";
  if (segFromTop <= 4) return "0 0 3px rgba(255,255,255,0.55)";
  return "0 0 3px rgba(232,160,48,0.65)";
}

/** V10-style circular LED ladder with engraved dB scale — sits left of EQ knobs */
function ChannelMeter({ db, height }: { db: number; height: number }) {
  const segs = CHANNEL_METER_DB.length;
  const clamped = Math.max(-30, Math.min(12, db));
  const level = ((clamped + 30) / 42) * segs;

  return (
    <div style={{ display: "flex", gap: 2, height, alignItems: "stretch", flexShrink: 0 }}>
      {/* LED well */}
      <div style={{
        width: 10, display: "flex", flexDirection: "column-reverse",
        justifyContent: "space-between", alignItems: "center",
        padding: "4px 3px",
        background: "linear-gradient(90deg, #060606, #141414 50%, #060606)",
        borderRadius: 6,
        boxShadow: "inset 0 3px 6px rgba(0,0,0,0.95)",
      }}>
        {CHANNEL_METER_DB.map((_, i) => {
          const fullLit = i < Math.floor(level);
          const partial = i === Math.floor(level) && level - Math.floor(level) > 0.04;
          const lit = fullLit || partial;
          const fromTop = segs - 1 - i;
          const color = chLedColor(fromTop, lit);
          return (
            <div key={i} style={{
              width: 4.5, height: 4.5, borderRadius: "50%", flexShrink: 0,
              background: color,
              opacity: partial ? 0.35 + (level - Math.floor(level)) * 0.65 : 1,
              boxShadow: chLedGlow(fromTop, lit),
              border: lit ? "none" : "1px solid #141414",
            }} />
          );
        })}
      </div>
      {/* dB silkscreen */}
      <div style={{
        position: "relative", width: 10, height: "100%",
        fontSize: 4.2, color: "#d0d0d0", fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}>
        {CHANNEL_METER_DB.map((mark, i) => (
          <span key={mark} style={{
            position: "absolute", left: 0, right: 0, textAlign: "left",
            top: `${(i / (segs - 1)) * 92 + 4}%`,
            transform: "translateY(-50%)",
          }}>
            {mark}
          </span>
        ))}
        <span style={{
          position: "absolute", bottom: 0, left: 0,
          fontSize: 4, color: PIONEER.label,
        }}>
          dB
        </span>
      </div>
    </div>
  );
}

function FxFreqBtn({ label, active }: { label: string; active?: boolean }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{
        width: 14, height: 14, borderRadius: "50%", margin: "0 auto",
        border: `1px solid ${active ? PIONEER.red : "#3a1414"}`,
        background: active
          ? `radial-gradient(circle at 38% 30%, #ff8a80, ${PIONEER.red} 60%, #b71c1c)`
          : "radial-gradient(circle at 38% 30%, #2a1414, #140808 70%)",
        boxShadow: active ? `0 0 6px ${PIONEER.red}88` : "inset 0 1px 3px rgba(0,0,0,0.8)",
      }} />
      <div style={{ fontSize: 4.5, color: PIONEER.label, fontWeight: 700, marginTop: 1 }}>{label}</div>
    </div>
  );
}

/** Large Beat FX effect-selector dial (blueprint right column) */
function EffectSelectorDial({ name, active }: { name: string; active?: boolean }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 52, height: 52, borderRadius: "50%", margin: "0 auto",
        background: "radial-gradient(circle at 38% 32%, #444 0%, #222 50%, #0a0a0a 100%)",
        border: `2px solid ${active ? PIONEER.blue : "#333"}`,
        boxShadow: "0 3px 8px rgba(0,0,0,0.7), inset 0 2px 4px rgba(0,0,0,0.5)",
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          position: "absolute", inset: 4, borderRadius: "50%",
          background: "repeating-conic-gradient(from -90deg, #2a2a2a 0deg 8deg, #1a1a1a 8deg 16deg)",
          opacity: 0.7,
        }} />
        <span style={{
          fontSize: 5, fontWeight: 800, color: active ? PIONEER.blue : PIONEER.label,
          letterSpacing: "0.04em", zIndex: 1, textAlign: "center", lineHeight: 1.1,
          padding: "0 4px",
        }}>
          {name}
        </span>
      </div>
      <div style={{ fontSize: 4.5, color: PIONEER.label, fontWeight: 700, marginTop: 2 }}>
        FX SELECT
      </div>
    </div>
  );
}

/** Beat FX touch display (blueprint LCD + X-PAD) */
function BeatFxScreen({
  name, bpm, level, on,
}: { name: string; bpm: number; level: number; on: boolean }) {
  return (
    <Pocket style={{ padding: "5px 6px", minHeight: 72 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 8, color: on ? PIONEER.blue : PIONEER.label, fontWeight: 800 }}>
          {name}
        </span>
        <span style={{ fontSize: 5, color: PIONEER.label }}>BEAT</span>
      </div>
      <div style={{
        fontSize: 14, color: PIONEER.white, fontWeight: 700,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.1, marginTop: 2,
      }}>
        {Math.round(bpm)} <span style={{ fontSize: 6, color: PIONEER.label }}>BPM</span>
      </div>
      <div style={{
        marginTop: 5, height: 28, background: "#050508", borderRadius: 2,
        border: "1px solid #1a1a1a", position: "relative",
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.9)",
      }}>
        <svg width="100%" height="100%" viewBox="0 0 100 28" preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0 }}>
          <line x1="6" y1="22" x2={6 + level * 88} y2="5"
            stroke={PIONEER.blue} strokeWidth="1.5" opacity={on ? 0.9 : 0.3} />
        </svg>
        <span style={{
          fontSize: 4, color: PIONEER.label, position: "absolute",
          left: 3, bottom: 2, letterSpacing: "0.06em",
        }}>
          X-PAD
        </span>
      </div>
    </Pocket>
  );
}

/** EQ knob with silkscreen label to the right (V10 channel strip) */
function EqKnobRow({
  value, label, sublabel,
  size = CHANNEL_KNOB_SIZE, ticks = 11, large = true, accent, onChange,
}: {
  value: number;
  label: string;
  sublabel?: string;
  size?: number;
  ticks?: number;
  large?: boolean;
  accent?: string;
  onChange?: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <PioneerKnob
        value={value} size={size} ticks={ticks} large={large} accent={accent}
        onChange={onChange}
      />
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        minWidth: 14, lineHeight: 1.1, flexShrink: 0,
      }}>
        {sublabel && (
          <span style={{
            fontSize: 4, color: PIONEER.label, fontWeight: 700,
            letterSpacing: "0.04em",
          }}>
            {sublabel}
          </span>
        )}
        <span style={{
          fontSize: 5, color: "#d8d8d8", fontWeight: 700,
          letterSpacing: "0.01em", whiteSpace: "nowrap",
          lineHeight: 1,
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

/** FILTER + SEND — same PioneerKnob as TRIM */
function FilterSendSections({
  filterValue, sendValue = 0, onFilter, onSend,
}: {
  filterValue: number;
  sendValue?: number;
  onFilter?: (v: number) => void;
  onSend?: (v: number) => void;
}) {
  const sectionStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    padding: "3px 0 4px",
  };

  const labelStyle: CSSProperties = {
    position: "absolute", top: 4, left: 4,
    fontSize: 6, color: "#ffffff", fontWeight: 700,
    letterSpacing: "0.08em", lineHeight: 1,
  };

  const knobProps = {
    size: CHANNEL_KNOB_SIZE,
    large: true as const,
    ticks: 11,
  };

  return (
    <div>
      <div style={sectionStyle}>
        <span style={labelStyle}>FILTER</span>
        <PioneerKnob
          value={filterValue} min={-12} max={12}
          onChange={onFilter}
          {...knobProps}
        />
      </div>
      <div style={sectionStyle}>
        <span style={labelStyle}>SEND</span>
        <PioneerKnob
          value={sendValue} min={0} max={10}
          onChange={onSend}
          {...knobProps}
        />
      </div>
    </div>
  );
}

/** Chrome channel fader cap — brushed silver body, bright center highlight (V10 reference) */
function ChannelFaderCap({ topPct }: { topPct: number }) {
  return (
    <div style={{
      position: "absolute", left: -2, right: -2,
      top: `${topPct}%`, height: 10,
      transform: "translateY(-50%)",
      borderRadius: 2,
      background: [
        "linear-gradient(180deg,",
        "#2e2e2e 0%, #6a6a6a 10%, #a8a8a8 24%,",
        "#d4d4d4 38%, #f0f0f0 46%, #ffffff 49%,",
        "#ffffff 51%, #f0f0f0 54%, #d0d0d0 66%,",
        "#909090 80%, #505050 92%, #282828 100%)",
      ].join(" "),
      boxShadow: [
        "0 1px 2px rgba(0,0,0,0.95)",
        "inset 0 1px 0 rgba(255,255,255,0.55)",
        "inset 0 -1px 1px rgba(0,0,0,0.45)",
      ].join(", "),
      pointerEvents: "none",
      zIndex: 2,
    }} />
  );
}

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
    const pad = rect.height * 0.06;
    const raw = 1 - Math.max(0, Math.min(1, (clientY - rect.top - pad) / (rect.height - pad * 2)));
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

  const scaleSteps = Array.from({ length: 21 }, (_, i) => i * 0.5);
  const capTop = 6 + (1 - pos) * 88;

  return (
    <div style={{ display: "flex", justifyContent: "center", height, width: "100%" }}>
      <div style={{ display: "flex", height: "100%" }}>
        {/* left scale only — numbers + tick marks toward slot */}
        <div style={{ width: 15, position: "relative", height: "100%", flexShrink: 0 }}>
          {scaleSteps.map(step => {
            const top = `${6 + (1 - step / 10) * 88}%`;
            const isInt = step % 1 === 0;
            return (
              <div
                key={step}
                style={{
                  position: "absolute", left: 0, right: 0, top,
                  transform: "translateY(-50%)",
                }}
              >
                {isInt && (
                  <span style={{
                    position: "absolute", left: 0, top: -3,
                    fontSize: 5.5, color: "#ffffff", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums", lineHeight: 1,
                  }}>
                    {step}
                  </span>
                )}
                <div style={{
                  position: "absolute",
                  left: isInt ? 6 : 9,
                  right: 0,
                  top: 0,
                  height: 1,
                  background: "#ffffff",
                  opacity: isInt ? 1 : 0.65,
                }} />
              </div>
            );
          })}
        </div>

        {/* narrow recessed fader slot */}
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
            width: 18, height: "100%", position: "relative", flexShrink: 0,
            background: "linear-gradient(90deg, #020202 0%, #080808 35%, #050505 65%, #020202 100%)",
            boxShadow: [
              "inset 2px 0 5px rgba(0,0,0,0.95)",
              "inset -2px 0 5px rgba(0,0,0,0.95)",
              "inset 0 4px 10px rgba(0,0,0,0.9)",
              "inset 0 -4px 10px rgba(0,0,0,0.9)",
            ].join(", "),
            cursor: onChange ? "ns-resize" : "default",
          }}
        >
          <ChannelFaderCap topPct={capTop} />
        </div>
      </div>
    </div>
  );
}

function PioneerCueButton({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  return (
    <div style={{ position: "relative", width: 32, height: 32 }}>
      {active && (
        <div style={{
          position: "absolute", inset: -3, borderRadius: "50%",
          border: `2px solid ${PIONEER.orange}`,
          boxShadow: PIONEER.orangeGlow,
          pointerEvents: "none",
        }} />
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        style={{
          width: 32, height: 32, borderRadius: "50%", padding: 0,
          border: `1px solid ${active ? PIONEER.orange : "#333"}`,
          background: "radial-gradient(circle at 38% 32%, #2a2a2a, #111 60%, #0a0a0a)",
          boxShadow: "inset 0 3px 8px rgba(0,0,0,0.85)",
          fontSize: 7, fontWeight: 900,
          color: active ? PIONEER.orange : PIONEER.label,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        CUE
      </button>
    </div>
  );
}

interface Props {
  channels: DJMChannelState[];
  mixer: DJMMixerState;
  onCrossfaderChange?: (pos: number) => void;
  interactive?: boolean;
  channelHandlers?: ChannelHandlers;
}

/* metallic brushed faceplate */
const BRUSHED: CSSProperties = {
  background:
    "repeating-linear-gradient(180deg, rgba(255,255,255,0.012) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.04) 3px), " +
    "linear-gradient(180deg, #232323 0%, #1a1a1a 6%, #161616 60%, #101010 100%)",
};

export function SchematicDJM({ channels, mixer, interactive, channelHandlers }: Props) {
  const h = channelHandlers;
  const knob = (fn?: (v: number) => void) => interactive ? fn : undefined;

  return (
    <PioneerChassis
      width={DJM_WIDTH}
      style={{
        height: FIGMA_CDJ_SIZE.height,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        flexShrink: 0,
        ...BRUSHED,
      }}
    >
      {/* Header */}
      <div style={{
        padding: "5px 12px 4px", flexShrink: 0,
        display: "flex", justifyContent: "center", alignItems: "baseline",
        borderBottom: "1px solid #000",
        background: "linear-gradient(180deg, #2a2a2a, #161616)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
        position: "relative",
      }}>
        <span style={{
          fontSize: 13, color: PIONEER.white, fontWeight: 300,
          letterSpacing: "0.06em",
        }}>
          <span style={{ fontStyle: "italic", fontWeight: 700 }}>Pioneer</span>
          <span style={{ fontSize: 8, marginLeft: 4, letterSpacing: "0.2em", color: PIONEER.label }}>DJ</span>
        </span>
      </div>

      <div style={{
        display: "flex", flex: 1, minHeight: 0,
        padding: "5px 4px 4px", gap: 3, overflow: "hidden",
      }}>
        {/* ---- LEFT UTILITY: USB / MIC / FILTER / SEND / PHONES A ---- */}
        <div style={{
          width: LEFT_COL_W, display: "flex", flexDirection: "column", gap: 5,
          paddingRight: 5,
        }}>
          <Eng style={{ color: PIONEER.label, fontSize: 5 }}>USB</Eng>
          <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
            {["A", "B"].map(p => (
              <div key={p} style={{
                width: 14, height: 8, borderRadius: 1,
                background: "#111", border: "1px solid #333",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8)",
                fontSize: 4, color: PIONEER.label, textAlign: "center", lineHeight: "8px",
              }}>
                {p}
              </div>
            ))}
          </div>

          <Rule />
          <Eng style={{ color: "#d0d0d0", fontSize: 6 }}>MIC</Eng>
          <PioneerKnob value={0} label="LEVEL" size={20} ticks={9} />
          <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
            <PioneerKnob value={0} label="HI" size={15} ticks={7} />
            <PioneerKnob value={0} label="LOW" size={15} ticks={7} />
          </div>
          <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
            <PioneerPadBtn label="OFF" width={18} height={12} />
            <PioneerPadBtn label="TALK" width={22} height={12} active />
          </div>

          <Rule />
          <Eng style={{ color: "#d0d0d0", fontSize: 6 }}>FILTER</Eng>
          <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
            <PioneerPadBtn label="LPF" width={22} height={13} />
            <PioneerPadBtn label="HPF" width={22} height={13} />
          </div>
          <PioneerKnob value={0} label="RESONANCE" size={22} large ticks={11} />

          <Rule />
          <Eng style={{ color: PIONEER.blue, fontSize: 6 }}>SEND</Eng>
          <Pocket style={{ padding: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            {SEND_FX.map(fx => (
              <div key={fx} style={{
                fontSize: 4.5, fontWeight: 800, padding: "2px 1px", textAlign: "center",
                borderRadius: 2,
                background: mixer.soundColorFx === fx
                  ? "linear-gradient(180deg, #4a8ab8, #2962a8)"
                  : "linear-gradient(180deg, #242424, #161616)",
                color: mixer.soundColorFx === fx ? PIONEER.white : PIONEER.label,
                border: `1px solid ${mixer.soundColorFx === fx ? "#4a8ab8" : "#2a2a2a"}`,
              }}>
                {fx}
              </div>
            ))}
          </Pocket>
          <PioneerKnob value={mixer.soundColorParam * 10} label="SEND" size={18} ticks={9} accent={PIONEER.blue} />
          <PioneerKnob value={0} min={0} max={10} label="MIX" size={16} ticks={7} />

          <div style={{ marginTop: "auto" }}>
            <Rule />
            <Eng style={{ color: "#d0d0d0", fontSize: 6 }}>PHONES A</Eng>
            <PioneerKnob value={0} min={0} max={10} label="LEVEL" size={18} ticks={9} />
            <PioneerKnob value={0} min={0} max={10} label="MIX" size={16} ticks={7} />
          </div>
        </div>

        {/* ---- 4 CHANNEL STRIPS (fixed narrow width) ---- */}
        <div style={{ display: "flex", gap: 0, flexShrink: 0 }}>
        {channels.map(ch => (
          <div key={ch.channelIndex} style={{
            width: CHANNEL_W, flexShrink: 0,
            display: "flex", flexDirection: "column",
            alignItems: "stretch", gap: 3,
            padding: "0 1px",
            overflow: "hidden",
            background:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, transparent 1px, transparent 2px)",
          }}>
            <InputSelector activeColor={ch.color} />

            {/* TRIM (large) + COMP (small) */}
            <div style={{
              display: "flex", gap: 2, justifyContent: "center", alignItems: "flex-end",
            }}>
              <PioneerKnob
                value={ch.trimDb} label="TRIM" size={CHANNEL_KNOB_SIZE} large ticks={11}
                onChange={knob(v => h?.onTrim(ch.channelIndex, v))}
              />
              <PioneerKnob value={3} min={0} max={9} size={14} ticks={7}
                accent={PIONEER.orange} label="COMP" />
            </div>

            {/* EQ + meter */}
            <div style={{ padding: "1px 0 4px 2px" }}>
              <div style={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <ChannelMeter db={Math.max(ch.meterL, ch.meterR)} height={168} />
                <div style={{
                  display: "flex", flexDirection: "column", gap: 6,
                  alignItems: "flex-start", minWidth: 0,
                }}>
                  <EqKnobRow
                    value={ch.high} label="HI" sublabel="EQ"
                    onChange={knob(v => h?.onEq(ch.channelIndex, "high", v))}
                  />
                  <EqKnobRow
                    value={ch.mid} label="HI MID"
                    onChange={knob(v => h?.onEq(ch.channelIndex, "mid", v))}
                  />
                  <EqKnobRow
                    value={ch.mid} label="LOW MID"
                    onChange={knob(v => h?.onEq(ch.channelIndex, "mid", v))}
                  />
                  <EqKnobRow
                    value={ch.low} label="LOW"
                    onChange={knob(v => h?.onEq(ch.channelIndex, "low", v))}
                  />
                </div>
              </div>
            </div>

            <FilterSendSections
              filterValue={ch.filter}
              onFilter={knob(v => h?.onEq(ch.channelIndex, "filter", v))}
            />

            <div style={{ textAlign: "center" }}>
              <AssignBtn active={mixer.beatFxOn && ch.cue} />
              <div style={{ fontSize: 4, color: PIONEER.label, fontWeight: 700 }}>BEAT FX</div>
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <PioneerCueButton
                active={ch.cue}
                onClick={interactive ? () => h?.onCue(ch.channelIndex) : undefined}
              />
            </div>

            {/* channel number centered above fader well */}
            <div style={{ marginTop: "auto", paddingTop: 2 }}>
              <div style={{ textAlign: "center", marginBottom: 3 }}>
                <span style={{
                  fontSize: 17, color: PIONEER.white, fontWeight: 800,
                  lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                }}>
                  {ch.channelIndex + 1}
                </span>
              </div>
              <PioneerChannelFader
                valueDb={ch.faderDb}
                height={104}
                onChange={interactive ? db => h?.onFader(ch.channelIndex, db) : undefined}
              />
            </div>
          </div>
        ))}
        </div>

        {/* ---- RIGHT: MASTER / BEAT FX / BOOTH / PHONES B ---- */}
        <div style={{
          width: RIGHT_COL_W, display: "flex", flexDirection: "column", gap: 3,
          paddingLeft: 3, overflow: "hidden",
        }}>
          {/* MASTER — LEVEL | ISOLATOR */}
          <div style={{ paddingBottom: 6 }}>
            <Eng style={{ color: "#e8e8e8", fontSize: 8, marginBottom: 5 }}>MASTER</Eng>
            <div style={{ display: "flex" }}>
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, paddingRight: 4,
              }}>
                <Eng style={{ color: "#c8c8c8", fontSize: 6 }}>LEVEL</Eng>
                <PioneerKnob value={mixer.masterDb} min={-60} max={5} size={22} ticks={11} />
                <ClipIndicator active={mixer.masterMeterL > 0 || mixer.masterMeterR > 0} />
                <MasterVuMeter
                  leftDb={mixer.masterMeterL}
                  rightDb={mixer.masterMeterR}
                  height={86}
                />
              </div>
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, paddingLeft: 4,
              }}>
                <Eng style={{ color: "#c8c8c8", fontSize: 6 }}>ISOLATOR</Eng>
                <IsolatorOnBtn active />
                <IsolatorKnob label="HI" />
                <IsolatorKnob label="MID" />
                <IsolatorKnob label="LOW" />
              </div>
            </div>
          </div>

          {/* BEAT FX (blueprint right column) */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Eng style={{ color: PIONEER.blue, fontSize: 7 }}>BEAT FX</Eng>
            <Eng style={{ color: PIONEER.label, fontSize: 5 }}>MY SETTINGS</Eng>
          </div>
          <BeatFxScreen
            name={mixer.beatFxName}
            bpm={mixer.tapBpm}
            level={mixer.beatFxLevel}
            on={mixer.beatFxOn}
          />
          <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }}>
            <PioneerPadBtn label="<" width={16} height={14} />
            <PioneerPadBtn label="TAP" width={22} height={14} color={PIONEER.blue} active />
            <PioneerPadBtn label=">" width={16} height={14} />
          </div>
          <Eng style={{ color: PIONEER.label, fontSize: 5 }}>FX FREQUENCY</Eng>
          <div style={{ display: "flex", gap: 4 }}>
            <FxFreqBtn label="LOW" />
            <FxFreqBtn label="MID" active />
            <FxFreqBtn label="HI" />
          </div>
          <EffectSelectorDial name={mixer.beatFxName} active={mixer.beatFxOn} />
          <div style={{
            fontSize: 4, color: PIONEER.label, textAlign: "center",
            lineHeight: 1.3, letterSpacing: "0.02em",
          }}>
            {BEAT_FX_EFFECTS.slice(0, 7).join(" · ")}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <PioneerKnob value={0} min={0} max={10} label="TIME" size={20} ticks={9} accent={PIONEER.blue} />
            <PioneerKnob value={mixer.beatFxLevel * 10} min={0} max={10} label="LEVEL" size={20} ticks={9} accent={PIONEER.blue} />
          </div>
          <button type="button" style={{
            width: 40, height: 40, borderRadius: "50%", margin: "0 auto",
            border: `3px solid ${mixer.beatFxOn ? PIONEER.red : "#444"}`,
            background: mixer.beatFxOn
              ? `radial-gradient(circle at 38% 30%, #ff8a80, ${PIONEER.red}cc, #b71c1c)`
              : "radial-gradient(circle at 38% 30%, #333, #111)",
            boxShadow: mixer.beatFxOn ? `0 0 14px ${PIONEER.red}88` : "inset 0 2px 6px rgba(0,0,0,0.8)",
            fontSize: 7, fontWeight: 900, color: mixer.beatFxOn ? PIONEER.white : PIONEER.label,
          }}>
            ON
          </button>

          <SilkDivider />

          {/* BOOTH */}
          <Eng style={{ color: "#d0d0d0", fontSize: 6 }}>BOOTH</Eng>
          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
            <PioneerKnob value={0} label="HI" size={16} ticks={7} />
            <PioneerKnob value={0} label="LOW" size={16} ticks={7} />
          </div>
          <PioneerKnob value={0} min={0} max={10} label="MONITOR" size={20} ticks={9} />

          <SilkDivider />

          {/* PHONES B */}
          <Eng style={{ color: "#d0d0d0", fontSize: 6 }}>PHONES B</Eng>
          <PioneerKnob value={0} min={0} max={10} label="LEVEL" size={18} ticks={9} />
          <PioneerKnob value={0} min={0} max={10} label="MIX" size={16} ticks={7} />
        </div>
      </div>

    </PioneerChassis>
  );
}
