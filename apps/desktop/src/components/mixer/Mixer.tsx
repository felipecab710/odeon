/**
 * Mixer — pixel-matched to Figma node 377:373.
 *
 * Exact layout (top → bottom):
 *   1.  Large top panel (track name + panner + routing space)
 *   2.  [– wide] [In / Disk stacked]
 *   3.  [Iso] [Lock]
 *   4.  [Mute] [Solo]
 *   5.  [-0.0] [0.1 ← red when clipping]
 *   6.  Fader (x=11,w=27) + L meter (x=55,w=7) + R meter (x=63,w=7) + scale
 *   7.  [M] [Post]
 *   8.  [M] [Post]   (→ Grp / RTA in our build)
 *   9.  [–– full width]
 *  10.  [–– full width]  (Comments)
 */
import { useRef, useCallback, useState, useEffect } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { engineClient } from "../../lib/engineClient";
import { webAudioEngine, ardourDbToPos, ardourPosToDb } from "../../lib/webAudioEngine";
import type { OdeonTrack } from "@odeon/shared";

// ── Figma geometry (node 377:373) ─────────────────────────────────────────────
const STRIP_W      = 106;   // total channel strip width
const FADER_AREA_H = 255;   // fader + meter area height (exact from Figma)
const BTN_H        =  14;   // standard button height
const BTN_HALF     =  50;   // half-width button (each side)
const BTN_GAP      =   2;   // gap between paired buttons / rows
const METER_W      =   7;   // each VU bar width
// Fader/meter absolute positions inside the FADER_AREA (from Figma)
const FADER_X      = 11;    // fader groove left
const FADER_W      = 27;    // fader groove width
const METER_L_X    = 55;    // L meter bar left
const METER_R_X    = 63;    // R meter bar left
const SCALE_X      = 73;    // scale labels left

// ── Figma colours ─────────────────────────────────────────────────────────────
const FIG_STRIP     = "#2d2b2b";   // strip background
const FIG_TOP       = "#3e3b3b";   // top panel background
const FIG_BTN       = "#4f4d4d";   // button inactive bg
const FIG_BTN_BDR   = "#000000";   // button border
const FIG_DISK_ACT  = "#b06000";   // Disk active orange
const FIG_SOLO_ACT  = "#1e8a46";   // Solo active green
const FIG_MUTE_ACT  = "#b87800";   // Mute active amber
const FIG_GAIN_BG   = "#101010";   // gain readout box bg
const FIG_CLIP_BG   = "#ff0000";   // clip readout bg (red)
const FIG_WARN_BG   = "#880000";   // peak warning bg
const FIG_GROOVE    = "#1d1d1d";   // fader groove bg
const FIG_METER_DARK = "#5c0c13";  // unlit meter segment (dark red – from Figma)
const FIG_DIVIDER   = "#1a1a1a";   // divider line colour

// ── Track colour palette ──────────────────────────────────────────────────────
const STEM_COLORS: Record<string, string> = {
  drums: "#C0392B", bass: "#D35400", vocals: "#8E44AD",
  music: "#27AE60", other: "#2980B9", fx: "#16A085",
  full_mix: "#E67E22", unknown: "#7F8C8D",
};
const ROLE_COLORS: Record<string, string> = {
  reference_full_mix: "#E67E22", reference_stem: "#4A90D9",
  user_stem: "#2ECC71", analysis: "#9B59B6",
};
function trackColor(t: OdeonTrack) {
  return STEM_COLORS[t.stem_type] ?? ROLE_COLORS[t.role] ?? "#888";
}

// ── VU meter geometry (IEC 268-18 dBFS) ──────────────────────────────────────
const SEGS     = 60;
const DB_FLOOR = -50;
const DB_CEIL  =  +3;
const DB_RANGE = DB_CEIL - DB_FLOOR;  // 53 dB

function segColor(db: number): { lit: string; dark: string } {
  if (db >=  +1)  return { lit: "#ff2020", dark: FIG_METER_DARK };
  if (db >= -0.5) return { lit: "#ff5500", dark: FIG_METER_DARK };
  if (db >=  -3)  return { lit: "#ffaa00", dark: FIG_METER_DARK };
  if (db >= -10)  return { lit: "#ccdd00", dark: FIG_METER_DARK };
  if (db >= -20)  return { lit: "#44dd44", dark: FIG_METER_DARK };
  return                  { lit: "#22aa33", dark: FIG_METER_DARK };
}

// Figma scale marks (format: "+3", "+0", "-3", "-5" …)
const SCALE_MARKS = [3, 0, -3, -5, -10, -15, -18, -20, -25, -30, -40, -50] as const;

// ── VUBar ─────────────────────────────────────────────────────────────────────
function VUBar({ db, peakDb }: { db: number; peakDb: number }) {
  return (
    <div className="relative" style={{ width: METER_W, height: "100%", border: "1px solid #000" }}>
      <div className="absolute inset-0 flex flex-col-reverse" style={{ gap: "1px" }}>
        {Array.from({ length: SEGS }, (_, i) => {
          const segDb = DB_FLOOR + (i / SEGS) * DB_RANGE;
          const lit   = db >= segDb;
          const { lit: c, dark } = segColor(segDb);
          return (
            <div key={i} style={{
              flex: 1,
              background: lit ? c : dark,
              boxShadow: lit && segDb >= -3 ? `0 0 2px ${c}66` : undefined,
            }} />
          );
        })}
      </div>
      {/* Peak hold line */}
      {peakDb > DB_FLOOR && (
        <div className="absolute inset-x-0 pointer-events-none" style={{
          bottom: `${Math.max(0, Math.min(100, ((peakDb - DB_FLOOR) / DB_RANGE) * 100))}%`,
          height: 2, background: segColor(peakDb).lit,
        }} />
      )}
    </div>
  );
}

// ── dBFS scale labels (Figma: right of meters, white text, +3/+0 red) ─────────
function DbfsScale() {
  return (
    <div className="relative" style={{ width: 30, height: "100%" }}>
      {SCALE_MARKS.map((mark) => {
        const pct = ((mark - DB_FLOOR) / DB_RANGE) * 100;
        const isHot = mark >= 0;
        return (
          <div key={mark} className="absolute pointer-events-none flex items-center gap-0.5" style={{
            bottom: `${pct}%`, transform: "translateY(50%)", left: 1,
          }}>
            <div style={{ width: 3, height: 1, background: isHot ? "#ff4444" : "#555", flexShrink: 0 }} />
            <span style={{
              fontSize: 7.5, lineHeight: 1, fontFamily: "'Inter', monospace", fontWeight: 600,
              color: isHot ? "#ff4444" : "#eaeaea", whiteSpace: "nowrap",
            }}>
              {mark >= 0 ? `+${mark}` : mark}
            </span>
          </div>
        );
      })}
      <div className="absolute" style={{ bottom: -11, left: 4 }}>
        <span style={{ fontSize: 6, color: "#777", fontFamily: "monospace", fontWeight: 300 }}>dBFS</span>
      </div>
    </div>
  );
}

// ── Vertical fader (inside fader+meter absolute container) ───────────────────
function FaderInner({ valueDb, onChange }: { valueDb: number; onChange: (db: number) => void }) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const [showTip, setShowTip] = useState(false);

  const pos      = ardourDbToPos(Math.max(-60, Math.min(6, valueDb)));
  const unityPct = ardourDbToPos(0) * 100;

  const updateFromY = useCallback((clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw  = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const uPos = ardourDbToPos(0);
    const snap = Math.abs(raw - uPos) < 0.02 ? uPos : raw;
    onChange(Math.round(Math.max(-60, Math.min(6, ardourPosToDb(snap))) * 10) / 10);
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromY(e.clientY); };
    const onUp   = () => { dragging.current = false; setShowTip(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [updateFromY]);

  return (
    <div
      ref={trackRef}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); dragging.current = true; setShowTip(true); updateFromY(e.clientY); }}
      onDoubleClick={(e) => { e.stopPropagation(); onChange(0); }}
      className="relative cursor-ns-resize select-none"
      style={{ width: "100%", height: "100%" }}
    >
      {/* Groove */}
      <div className="absolute" style={{
        left: 4, right: 4, top: 0, bottom: 0,
        background: FIG_GROOVE,
        borderRadius: 4,
        boxShadow: "inset 0px 4px 4px rgba(0,0,0,0.25)",
      }} />
      {/* Unity notch */}
      <div className="absolute pointer-events-none" style={{
        left: 2, right: 2, height: 1,
        bottom: `${unityPct}%`,
        background: "#3a3a3a",
      }} />
      {/* Fill below handle */}
      <div className="absolute" style={{
        left: 4, right: 4, bottom: 0,
        height: `${pos * 100}%`,
        borderRadius: "0 0 4px 4px",
        background: "linear-gradient(180deg,#343434 0%,#3a3a3a 100%)",
        borderTop: "1px solid #434343",
      }} />
      {/* Handle — wide rectangular block */}
      <div className="absolute pointer-events-none" style={{
        left: 1, right: 1,
        bottom: `${pos * 100}%`,
        transform: "translateY(50%)",
        height: 11, borderRadius: 3,
        background: "linear-gradient(180deg,#d4d4d4 0%,#a8a8a8 40%,#8c8c8c 60%,#c0c0c0 100%)",
        boxShadow: "0 2px 3px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.2)",
        border: "1px solid #555",
      }} />
      {showTip && (
        <div className="absolute pointer-events-none z-50" style={{
          bottom: `${pos * 100}%`, left: "calc(100% + 4px)",
          transform: "translateY(50%)",
          background: "#111", border: "1px solid #333", borderRadius: 3,
          padding: "1px 5px", fontSize: 9, fontFamily: "monospace", color: "#ddd",
          whiteSpace: "nowrap",
        }}>
          {valueDb >= 0 ? "+" : ""}{valueDb.toFixed(1)} dB
        </div>
      )}
    </div>
  );
}

// ── Panner — Ardour butterfly (green ▼ + angled L/R wings) ────────────────────
function ArdourPanner({ trackId, pan }: { trackId: string; pan: number }) {
  const { setTrackState } = useEngineStore();
  const pct     = (pan + 1) / 2;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw     = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v       = Math.round((raw * 2 - 1) * 100) / 100;
    const snapped = Math.abs(v) < 0.04 ? 0 : v;
    setTrackState(trackId, { pan: snapped });
    webAudioEngine.setPan(trackId, snapped);
    engineClient.setTrackPan(trackId, snapped);
  }, [trackId, setTrackState]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromX(e.clientX); };
    const onUp   = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [updateFromX]);

  return (
    <div style={{ height: 52, position: "relative", background: "#0a0a0a", borderBottom: `1px solid ${FIG_DIVIDER}` }}>
      {/* Triangle slide track */}
      <div
        ref={trackRef}
        onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; updateFromX(e.clientX); }}
        onDoubleClick={() => { setTrackState(trackId, { pan: 0 }); webAudioEngine.setPan(trackId, 0); }}
        className="absolute cursor-ew-resize"
        style={{ left: 0, right: 0, top: 0, height: 14, zIndex: 2, background: "#0a0a0a" }}
      >
        <div className="absolute pointer-events-none" style={{
          left: `${pct * 100}%`, top: 2, transform: "translateX(-50%)",
        }}>
          <div style={{
            width: 0, height: 0,
            borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
            borderTop: "10px solid #2ecc71",
            filter: "drop-shadow(0 0 2px #2ecc71aa)",
          }} />
        </div>
      </div>
      {/* Butterfly wings: wide at top, taper to center at bottom */}
      <div className="absolute" style={{ left: 2, right: 2, top: 14, bottom: 4, display: "flex", gap: 2 }}>
        <div style={{
          flex: 1, background: "#18396e",
          clipPath: "polygon(0 0, 100% 0, 55% 100%, 0 100%)",
          display: "flex", alignItems: "flex-start", paddingTop: 3, paddingLeft: 4,
        }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: "#5a9ee8", fontFamily: "monospace", lineHeight: 1 }}>L</span>
        </div>
        <div style={{
          flex: 1, background: "#18396e",
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 45% 100%)",
          display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
          paddingTop: 3, paddingRight: 4,
        }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: "#5a9ee8", fontFamily: "monospace", lineHeight: 1 }}>R</span>
        </div>
      </div>
      <div className="absolute" style={{ bottom: 0, left: 0, right: 0, textAlign: "center" }}>
        <span style={{ fontSize: 7, color: "#444", fontFamily: "monospace" }}>
          {pan < -0.02 ? `L${Math.abs(Math.round(pan * 100))}` : pan > 0.02 ? `R${Math.round(pan * 100)}` : "C"}
        </span>
      </div>
    </div>
  );
}

// ── Compact button (Figma: #4f4d4d, 1px black border, rounded-4px) ─────────────
interface BtnProps {
  label: string;
  active?: boolean;
  activeColor?: string;
  onClick?: (e: React.MouseEvent) => void;
  height?: number;
  style?: React.CSSProperties;
}
function Btn({ label, active = false, activeColor = "#444", onClick, height = BTN_H, style: extraStyle }: BtnProps) {
  return (
    <button
      onClick={onClick}
      style={{
        height,
        background: active ? activeColor : FIG_BTN,
        border: `1px solid ${active ? activeColor : FIG_BTN_BDR}`,
        borderRadius: 4,
        color: "#fff",
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "'Inter', sans-serif",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        minWidth: 0,
        ...extraStyle,
      }}
    >
      {label}
    </button>
  );
}

// ── Channel strip ─────────────────────────────────────────────────────────────
function ChannelStrip({ track }: { track: OdeonTrack }) {
  const { trackStates, setTrackState, resetClip } = useEngineStore();
  const state       = trackStates[track.id];
  const volumeDb    = state?.volumeDb   ?? track.volume_db ?? 0;
  const pan         = state?.pan        ?? track.pan       ?? 0;
  const muted       = state?.muted      ?? track.muted     ?? false;
  const soloed      = state?.soloed     ?? track.soloed    ?? false;
  const leftDb      = state?.leftMeterDb  ?? -90;
  const rightDb     = state?.rightMeterDb ?? -90;
  const peakLeftDb  = state?.peakLeftDb   ?? -90;
  const peakRightDb = state?.peakRightDb  ?? -90;
  const clipping    = state?.clipping     ?? false;
  const color       = trackColor(track);
  const peakDb      = Math.max(peakLeftDb, peakRightDb);

  const handleMute      = (e: React.MouseEvent) => { e.stopPropagation(); const n = !muted;  setTrackState(track.id, { muted: n });  webAudioEngine.setMute(track.id, n);  engineClient.muteTrack(track.id, n); };
  const handleSolo      = (e: React.MouseEvent) => { e.stopPropagation(); const n = !soloed; setTrackState(track.id, { soloed: n }); webAudioEngine.setSolo(track.id, n);  engineClient.soloTrack(track.id, n); };
  const handleVolume    = (db: number) => { setTrackState(track.id, { volumeDb: db }); webAudioEngine.setVolume(track.id, db); engineClient.setTrackVolume(track.id, db); };
  const handleResetClip = () => { resetClip(track.id); webAudioEngine.resetClip(track.id); };

  const P = "2px";  // row padding
  const G = "1px";  // row gap

  return (
    <Tooltip.Provider delayDuration={400}>
      <div style={{
        width: STRIP_W,
        background: FIG_STRIP,
        borderRight: `1px solid ${FIG_DIVIDER}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>

        {/* ── TOP PANEL: track name + panner + routing space ── */}
        <div style={{
          background: FIG_TOP,
          borderLeft: `3px solid ${color}`,
          borderBottom: `1px solid ${FIG_DIVIDER}`,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 80,
        }}>
          {/* Track name */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <div style={{
                padding: "3px 5px",
                fontSize: 9,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                color: "#bbb",
                borderBottom: `1px solid ${FIG_DIVIDER}`,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: "default",
              }}>
                {track.name}
              </div>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content style={{ background: "#111", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "2px 6px", fontSize: 10, zIndex: 9999 }}>
                {track.name}<Tooltip.Arrow style={{ fill: "#111" }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          {/* Panner */}
          <ArdourPanner trackId={track.id} pan={pan} />

          {/* Routing placeholder */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: "#3a3838" }}>-</span>
          </div>
        </div>

        {/* ── Row: [– left tall btn] [In / Disk stacked right] ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P }}>
          <Btn label="–" height={30} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: G }}>
            <Btn label="In" height={BTN_H} />
            <Btn label="Disk" height={BTN_H} active activeColor={FIG_DISK_ACT} />
          </div>
        </div>

        {/* ── Row: Iso | Lock ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          <Btn label="Iso" />
          <Btn label="Lock" />
        </div>

        {/* ── Row: Mute | Solo ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          <Btn label="Mute" active={muted}  activeColor={FIG_MUTE_ACT} onClick={handleMute} />
          <Btn label="Solo" active={soloed} activeColor={FIG_SOLO_ACT} onClick={handleSolo} />
        </div>

        {/* ── Row: [-0.0] [0.1 red] dB readouts ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          {/* Gain readout */}
          <div style={{
            flex: 1, height: BTN_H,
            background: FIG_GAIN_BG,
            border: `1px solid ${FIG_BTN_BDR}`,
            borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 600, fontFamily: "'Inter', monospace", color: "#fff",
          }}>
            {volumeDb >= 0 ? "+" : ""}{volumeDb.toFixed(1)}
          </div>
          {/* Peak readout — red on clip/hot */}
          <div
            onClick={handleResetClip}
            style={{
              flex: 1, height: BTN_H,
              background: clipping ? FIG_CLIP_BG : peakDb >= -3 ? FIG_WARN_BG : FIG_GAIN_BG,
              border: `1px solid ${FIG_BTN_BDR}`,
              borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 600, fontFamily: "'Inter', monospace", color: "#fff",
              cursor: "pointer",
            }}
          >
            {peakDb > -90 ? (peakDb >= 0 ? "+" : "") + peakDb.toFixed(1) : "-∞"}
          </div>
        </div>

        {/* ── Fader + Meter area (255px, absolute positioned) ── */}
        <div style={{
          height: FADER_AREA_H,
          position: "relative",
          flexShrink: 0,
          background: FIG_STRIP,
          borderTop: `1px solid ${FIG_DIVIDER}`,
        }}>
          {/* Clip LED row (top of meter area) */}
          <div
            onClick={handleResetClip}
            title="Clip — click to reset"
            style={{
              position: "absolute",
              left: METER_L_X,
              top: 2,
              width: METER_W * 2 + 1,
              height: 6,
              background: clipping ? "#ff2020" : "#200000",
              border: "1px solid #000",
              borderRadius: 1,
              cursor: "pointer",
              boxShadow: clipping ? "0 0 4px #ff2020aa" : undefined,
            }}
          />

          {/* Fader groove */}
          <div style={{
            position: "absolute",
            left: FADER_X, top: 4, width: FADER_W,
            height: FADER_AREA_H - 8,
          }}>
            <FaderInner valueDb={volumeDb} onChange={handleVolume} />
          </div>

          {/* L meter bar */}
          <div style={{
            position: "absolute",
            left: METER_L_X, top: 10,
            width: METER_W,
            height: FADER_AREA_H - 14,
          }}>
            <VUBar db={leftDb} peakDb={peakLeftDb} />
          </div>

          {/* R meter bar */}
          <div style={{
            position: "absolute",
            left: METER_R_X, top: 10,
            width: METER_W,
            height: FADER_AREA_H - 14,
          }}>
            <VUBar db={rightDb} peakDb={peakRightDb} />
          </div>

          {/* dBFS scale labels */}
          <div style={{
            position: "absolute",
            left: SCALE_X, top: 10,
            width: STRIP_W - SCALE_X,
            height: FADER_AREA_H - 14,
          }}>
            <DbfsScale />
          </div>
        </div>

        {/* ── Row: M | Post ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: BTN_GAP }}>
          <Btn label="M" />
          <Btn label="Post" />
        </div>

        {/* ── Row: Grp | RTA ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          <Btn label="Grp" />
          <Btn label="RTA" />
        </div>

        {/* ── Full-width "–" separator ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          <Btn label="--" style={{ flex: 1 }} />
        </div>

        {/* ── Full-width "Comments" row ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G, paddingBottom: 4 }}>
          <Btn label="--" style={{ flex: 1 }} />
        </div>

      </div>
    </Tooltip.Provider>
  );
}

// ── Master strip ──────────────────────────────────────────────────────────────
function MasterStrip() {
  const { masterMeter, resetClip } = useEngineStore();
  const [vol, setVol] = useState(0);

  const handleMasterVol = (db: number) => { setVol(db); webAudioEngine.setMasterVolume(db); };
  const handleResetClip = () => { resetClip("__master__"); webAudioEngine.resetClip("__master__"); };

  const masterPeak = Math.max(masterMeter.leftDb, masterMeter.rightDb);
  const P = "2px";
  const G = "1px";

  return (
    <div style={{
      width: STRIP_W + 16,
      background: "#1a1c21",
      borderLeft: `1px solid #3a3a3a`,
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      {/* Top panel */}
      <div style={{
        background: "#222428",
        borderLeft: "3px solid #4A90D9",
        borderBottom: `1px solid ${FIG_DIVIDER}`,
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 80,
      }}>
        <div style={{ padding: "3px 5px", fontSize: 9, fontWeight: 600, fontFamily: "'Inter', sans-serif", color: "#bbb", borderBottom: `1px solid ${FIG_DIVIDER}` }}>
          Master
        </div>
        {/* Pan spacer */}
        <div style={{ height: 52, borderBottom: `1px solid ${FIG_DIVIDER}` }} />
        <div style={{ flex: 1 }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: BTN_GAP, padding: P }}>
        <Btn label="–" height={30} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: G }}>
          <Btn label="In" height={BTN_H} />
          <Btn label="Disk" height={BTN_H} active activeColor={FIG_DISK_ACT} />
        </div>
      </div>
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
        <Btn label="Iso" />
        <Btn label="Lock" />
      </div>
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
        <Btn label="Mute" />
        <Btn label="Out" />
      </div>

      {/* dB boxes */}
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
        <div style={{
          flex: 1, height: BTN_H, background: FIG_GAIN_BG,
          border: `1px solid ${FIG_BTN_BDR}`, borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: "#fff",
        }}>
          {vol >= 0 ? "+" : ""}{vol.toFixed(1)}
        </div>
        <div
          onClick={handleResetClip}
          style={{
            flex: 1, height: BTN_H,
            background: masterMeter.clipping ? FIG_CLIP_BG : masterPeak >= -3 ? FIG_WARN_BG : FIG_GAIN_BG,
            border: `1px solid ${FIG_BTN_BDR}`, borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: "#fff",
            cursor: "pointer",
          }}
        >
          {masterPeak > -90 ? (masterPeak >= 0 ? "+" : "") + masterPeak.toFixed(1) : "-∞"}
        </div>
      </div>

      {/* Fader + Meter */}
      <div style={{ height: FADER_AREA_H, position: "relative", flexShrink: 0, background: "#1a1c21", borderTop: `1px solid ${FIG_DIVIDER}` }}>
        <div onClick={handleResetClip} title="Clip — click to reset" style={{
          position: "absolute", left: METER_L_X, top: 2,
          width: METER_W * 2 + 1, height: 6,
          background: masterMeter.clipping ? "#ff2020" : "#200000",
          border: "1px solid #000", borderRadius: 1, cursor: "pointer",
          boxShadow: masterMeter.clipping ? "0 0 4px #ff2020aa" : undefined,
        }} />
        <div style={{ position: "absolute", left: FADER_X, top: 4, width: FADER_W, height: FADER_AREA_H - 8 }}>
          <FaderInner valueDb={vol} onChange={handleMasterVol} />
        </div>
        <div style={{ position: "absolute", left: METER_L_X, top: 10, width: METER_W, height: FADER_AREA_H - 14 }}>
          <VUBar db={masterMeter.leftDb} peakDb={masterMeter.peakLeftDb} />
        </div>
        <div style={{ position: "absolute", left: METER_R_X, top: 10, width: METER_W, height: FADER_AREA_H - 14 }}>
          <VUBar db={masterMeter.rightDb} peakDb={masterMeter.peakRightDb} />
        </div>
        <div style={{ position: "absolute", left: SCALE_X, top: 10, width: STRIP_W + 16 - SCALE_X, height: FADER_AREA_H - 14 }}>
          <DbfsScale />
        </div>
      </div>

      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: BTN_GAP }}>
        <Btn label="M" /><Btn label="Post" />
      </div>
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
        <Btn label="Grp" /><Btn label="RTA" />
      </div>
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
        <Btn label="--" style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G, paddingBottom: 4 }}>
        <Btn label="--" style={{ flex: 1 }} />
      </div>
    </div>
  );
}

// ── Mixer panel ───────────────────────────────────────────────────────────────
export function Mixer() {
  const { project } = useProjectStore();
  const [collapsed, setCollapsed] = useState(false);

  if (!project || project.tracks.length === 0) return null;

  const OPEN_H = FADER_AREA_H + 300;

  return (
    <div className="flex flex-col border-t flex-shrink-0" style={{
      borderColor: "#111",
      background: "#222",
      height: collapsed ? 26 : OPEN_H,
      transition: "height 0.15s ease",
    }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 border-b flex-shrink-0" style={{ height: 26, borderColor: "#111", background: "#1a1a1a" }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ fontSize: 9, fontFamily: "monospace", color: "#555", cursor: "pointer", background: "none", border: "none" }}
        >
          {collapsed ? "▲ MIXER" : "▼ MIXER"}
        </button>
        <span style={{ fontSize: 9, fontFamily: "monospace", color: "#3a3a3a" }}>
          {project.tracks.length} ch + Master
        </span>
        <span style={{
          fontSize: 8, fontFamily: "monospace", color: "#2ecc71",
          background: "#0a2010", border: "1px solid #1e5a2e", borderRadius: 3,
          padding: "1px 5px",
        }}>
          LIVE DEV · figma-377
        </span>
        <span style={{ fontSize: 8, fontFamily: "monospace", color: "#2a2a2a", marginLeft: "auto" }}>
          dbl-click fader = 0 dB · click peak to reset clip
        </span>
      </div>

      {!collapsed && (
        <div className="flex flex-1 overflow-hidden">
          {/* Channel strips */}
          <div className="flex overflow-x-auto overflow-y-hidden" style={{ background: "#222" }}>
            {project.tracks.map((t) => <ChannelStrip key={t.id} track={t} />)}
            {/* Add slot */}
            <div style={{
              width: 50, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRight: `1px solid ${FIG_DIVIDER}`,
            }}>
              <span style={{ fontSize: 8, color: "#2e2e2e", writingMode: "vertical-rl" }}>+ add</span>
            </div>
          </div>
          {/* Pinned master */}
          <MasterStrip />
        </div>
      )}
    </div>
  );
}
