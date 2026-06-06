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
import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import { rafThrottle } from "../../lib/rafThrottle";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useProjectStore } from "../../stores/projectStore";
import { useEngineStore } from "../../stores/engineStore";
import { useTrackGroupStore } from "../../stores/trackGroupStore";
import { engineClient } from "../../lib/engineClient";
import { MixerGroupStrip, MIXER_GROUP_ROW_H } from "./MixerGroupStrip";
import {
  ProToolsMeterCanvas, ProToolsMeterScale, ProToolsFaderScale, MeterPeakReadout,
} from "./ProToolsMeterPanel";
import { faderDbToPos, faderPosToDb, PT_FADER_MARKS } from "../../lib/proToolsFaderScale";
import { TRACK_STRIPE_COLOR } from "../../lib/timelineUtils";
import { onLayoutResize } from "../../lib/windowShell";
import type { OdeonTrack } from "@odeon/shared";

// ── Figma geometry (node 377:373) ─────────────────────────────────────────────
const STRIP_W      = 106;   // total channel strip width
const MASTER_W     = STRIP_W + 16;
const FADER_AREA_H = 255;   // fader + meter area height (exact from Figma)
const MIXER_TOOLBAR_H = 26;
const DEFAULT_MIXER_H = FADER_AREA_H + 300;
const MIN_MIXER_H = MIXER_TOOLBAR_H + 280;
const BTN_H        =  14;   // standard button height
const BTN_HALF     =  50;   // half-width button (each side)
const BTN_GAP      =   2;   // gap between paired buttons / rows
// Fader/meter layout — Pro Tools order: fader scale | fader | meter scale | meters
const FADER_SCALE_X =  2;
const FADER_X         = 17;   // fader groove left
const FADER_W         = 20;   // fader groove width
const METER_SCALE_X   = 39;   // dBFS scale (between fader and meters)
const METER_X         = 58;   // stereo meter canvas left
const METER_PANEL_H   = FADER_AREA_H - 14;

// ── Figma colours — neutral grey containers only (R≈G≈B, no warm tint) ─────
const FIG_STRIP     = "#2a2a2a";   // strip background
const FIG_TOP       = "#333333";   // top panel background
const FIG_BTN       = "#4f4d4d";   // button inactive bg
const FIG_BTN_BDR   = "#000000";   // button border
const FIG_DISK_ACT  = "#b06000";   // Disk active orange
const FIG_SOLO_ACT  = "#1e8a46";   // Solo active green
const FIG_MUTE_ACT  = "#b87800";   // Mute active amber
const FIG_GAIN_BG   = "#101010";   // gain readout box bg
const FIG_GROOVE    = "#1a1a1a";   // fader groove bg
const FIG_DIVIDER   = "#1a1a1a";   // divider line colour
const MIXER_BG      = "#1e1e1e";   // outer mixer + scroll container
const MASTER_STRIP  = "#262626";   // master strip (neutral grey, not blue-tinted)
const MASTER_TOP    = "#303030";

// ── Vertical fader (Pro Tools–style thin track + metallic cap) ───────────────
function FaderInner({ valueDb, onChange }: { valueDb: number; onChange: (db: number) => void }) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const [showTip, setShowTip] = useState(false);

  const pos      = faderDbToPos(Math.max(-60, Math.min(12, valueDb)));
  const unityPct = faderDbToPos(0) * 100;

  const updateFromY = useCallback((clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw  = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const uPos = faderDbToPos(0);
    const snap = Math.abs(raw - uPos) < 0.02 ? uPos : raw;
    onChange(Math.round(Math.max(-60, Math.min(12, faderPosToDb(snap))) * 10) / 10);
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
      {/* Groove well */}
      <div className="absolute" style={{
        left: 3, right: 3, top: 0, bottom: 0,
        background: FIG_GROOVE,
        borderRadius: 3,
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.5)",
      }} />
      {/* Thin centre track line (Pro Tools) */}
      <div className="absolute pointer-events-none" style={{
        left: "50%", transform: "translateX(-50%)",
        width: 1, top: 4, bottom: 4,
        background: "#000",
      }} />
      {/* Fader scale tick marks (aligned to Pro Tools gain marks) */}
      {PT_FADER_MARKS.map((mark) => (
        <div
          key={mark.label}
          className="absolute pointer-events-none"
          style={{
            left: 0, width: mark.label === "0" ? 6 : 4,
            top: `${mark.topFrac * 100}%`,
            transform: "translateY(-50%)",
            height: 1,
            background: mark.label === "0" ? "#666" : "#3a3a3a",
          }}
        />
      ))}
      {/* Unity notch */}
      <div className="absolute pointer-events-none" style={{
        left: 2, right: 2, height: 1,
        bottom: `${unityPct}%`,
        background: "#555",
      }} />
      {/* Handle — brushed-metal cap with centre groove */}
      <div className="absolute pointer-events-none" style={{
        left: 2, right: 2,
        bottom: `${pos * 100}%`,
        transform: "translateY(50%)",
        height: 14, borderRadius: 2,
        background: "linear-gradient(180deg,#e8e8e8 0%,#b0b0b0 25%,#909090 50%,#a8a8a8 75%,#d0d0d0 100%)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.35)",
        border: "1px solid #666",
      }}>
        <div style={{
          position: "absolute", left: 3, right: 3, top: "50%",
          transform: "translateY(-50%)",
          height: 2, borderRadius: 1,
          background: "linear-gradient(180deg,#555 0%,#333 100%)",
        }} />
      </div>
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

// ── Panner — horizontal FaderInner-style slider ───────────────────────────────
function ArdourPanner({ trackId, pan }: { trackId: string; pan: number }) {
  const { setTrackState } = useEngineStore();
  const trackRef  = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const [showTip, setShowTip] = useState(false);

  const pct = (pan + 1) / 2; // 0 = full L, 0.5 = center, 1 = full R

  const applyPan = useCallback((v: number) => {
    const snapped = Math.abs(v) < 0.04 ? 0 : v;
    setTrackState(trackId, { pan: snapped });
    engineClient.setTrackPan(trackId, snapped);
  }, [trackId, setTrackState]);

  const updateFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const snapped = Math.abs(raw - 0.5) < 0.02 ? 0.5 : raw;
    applyPan(Math.round((snapped * 2 - 1) * 100) / 100);
  }, [applyPan]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) updateFromX(e.clientX); };
    const onUp   = () => { dragging.current = false; setShowTip(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [updateFromX]);

  const panLabel =
    pan < -0.02 ? `L${Math.abs(Math.round(pan * 100))}`
    : pan > 0.02 ? `R${Math.round(pan * 100)}`
    : "C";

  return (
    <div style={{
      padding: "6px 8px 4px",
      borderBottom: `1px solid ${FIG_DIVIDER}`,
      background: FIG_TOP,
    }}>
      <div
        ref={trackRef}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragging.current = true;
          setShowTip(true);
          updateFromX(e.clientX);
        }}
        onDoubleClick={(e) => { e.stopPropagation(); applyPan(0); }}
        className="relative cursor-ew-resize select-none"
        style={{ height: 18, width: "100%" }}
      >
        {/* Groove — same as FaderInner */}
        <div className="absolute" style={{
          left: 0, right: 0, top: 2, bottom: 2,
          background: FIG_GROOVE,
          borderRadius: 4,
          boxShadow: "inset 0px 2px 4px rgba(0,0,0,0.35)",
        }} />

        {/* Centre notch */}
        <div className="absolute pointer-events-none" style={{
          top: 1, bottom: 1, width: 1, left: "50%",
          transform: "translateX(-50%)",
          background: "#3a3a3a",
        }} />

        {/* Fill from centre → handle */}
        {pct >= 0.5 ? (
          <div className="absolute" style={{
            top: 2, bottom: 2,
            left: "50%",
            width: `${(pct - 0.5) * 100}%`,
            borderRadius: "0 4px 4px 0",
            background: "linear-gradient(180deg,#343434 0%,#3a3a3a 100%)",
            borderLeft: "1px solid #434343",
          }} />
        ) : (
          <div className="absolute" style={{
            top: 2, bottom: 2,
            right: "50%",
            width: `${(0.5 - pct) * 100}%`,
            borderRadius: "4px 0 0 4px",
            background: "linear-gradient(180deg,#343434 0%,#3a3a3a 100%)",
            borderRight: "1px solid #434343",
          }} />
        )}

        {/* Handle — FaderInner block, rotated to horizontal */}
        <div className="absolute pointer-events-none" style={{
          top: 0, bottom: 0,
          left: `${pct * 100}%`,
          transform: "translateX(-50%)",
          width: 11, borderRadius: 3,
          background: "linear-gradient(180deg,#d4d4d4 0%,#a8a8a8 40%,#8c8c8c 60%,#c0c0c0 100%)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.2)",
          border: "1px solid #555",
        }} />

        {showTip && (
          <div className="absolute pointer-events-none z-50" style={{
            left: `${pct * 100}%`, top: -18,
            transform: "translateX(-50%)",
            background: "#111", border: "1px solid #333", borderRadius: 3,
            padding: "1px 5px", fontSize: 9, fontFamily: "monospace", color: "#ddd",
            whiteSpace: "nowrap",
          }}>
            {panLabel}
          </div>
        )}
      </div>

      {/* L · C · R labels */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 3, padding: "0 1px",
      }}>
        <span style={{ fontSize: 7, color: "#555", fontFamily: "monospace", fontWeight: 600 }}>L</span>
        <span style={{
          fontSize: 7, fontFamily: "monospace", fontWeight: 600,
          color: panLabel === "C" ? "#888" : "#aaa",
        }}>{panLabel}</span>
        <span style={{ fontSize: 7, color: "#555", fontFamily: "monospace", fontWeight: 600 }}>R</span>
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
  const setTrackState = useEngineStore((s) => s.setTrackState);
  const resetClip     = useEngineStore((s) => s.resetClip);
  const trackGroup    = useTrackGroupStore((s) => s.groups.find((g) => g.trackIds.includes(track.id)) ?? null);
  const applyGroupedMute = useTrackGroupStore((s) => s.applyGroupedMute);
  const applyGroupedSolo = useTrackGroupStore((s) => s.applyGroupedSolo);
  const applyGroupedGain = useTrackGroupStore((s) => s.applyGroupedGain);
  const openEditDialog   = useTrackGroupStore((s) => s.openEditDialog);
  const volumeDb      = useEngineStore((s) => s.trackStates[track.id]?.volumeDb   ?? track.volume_db ?? 0);
  const pan           = useEngineStore((s) => s.trackStates[track.id]?.pan        ?? track.pan       ?? 0);
  const muted         = useEngineStore((s) => s.trackStates[track.id]?.muted      ?? track.muted     ?? false);
  const soloed        = useEngineStore((s) => s.trackStates[track.id]?.soloed     ?? track.soloed    ?? false);
  const meterPost     = useEngineStore((s) => s.trackStates[track.id]?.meterPost  ?? false);
  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const n = !muted;
    setTrackState(track.id, { muted: n });
    engineClient.muteTrack(track.id, n);
    applyGroupedMute(track.id, n);
  };
  const handleSolo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const n = !soloed;
    setTrackState(track.id, { soloed: n });
    engineClient.soloTrack(track.id, n);
    applyGroupedSolo(track.id, n);
  };
  const handleVolume = (db: number) => {
    const prev = volumeDb;
    setTrackState(track.id, { volumeDb: db });
    engineClient.setTrackVolume(track.id, db);
    applyGroupedGain(track.id, db, prev);
  };
  const handleGroup = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (trackGroup) openEditDialog(trackGroup.id);
  };
  const handleResetClip = () => { resetClip(track.id); };
  const handleMeterPost = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTrackState(track.id, { meterPost: !meterPost });
  };

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
          borderLeft: `3px solid ${TRACK_STRIPE_COLOR}`,
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
          <MeterPeakReadout trackId={track.id} onResetClip={handleResetClip} />
        </div>

        {/* ── Fader + Meter area (255px, absolute positioned) ── */}
        <div style={{
          height: FADER_AREA_H,
          position: "relative",
          flexShrink: 0,
          background: FIG_STRIP,
          borderTop: `1px solid ${FIG_DIVIDER}`,
        }}>
          {/* Fader gain scale — 12, 6, 0, 5 … ∞ */}
          <div style={{ position: "absolute", left: FADER_SCALE_X, top: 4 }}>
            <ProToolsFaderScale height={FADER_AREA_H - 8} />
          </div>

          {/* Fader groove */}
          <div style={{
            position: "absolute",
            left: FADER_X, top: 4, width: FADER_W,
            height: FADER_AREA_H - 8,
          }}>
            <FaderInner valueDb={volumeDb} onChange={handleVolume} />
          </div>

          {/* Meter scale (dBFS) — 0 at top, 60 at bottom */}
          <div style={{ position: "absolute", left: METER_SCALE_X, top: 10 }}>
            <ProToolsMeterScale height={METER_PANEL_H} />
          </div>

          {/* Stereo peak meters */}
          <div style={{ position: "absolute", left: METER_X, top: 10 }}>
            <ProToolsMeterCanvas trackId={track.id} height={METER_PANEL_H} />
          </div>
        </div>

        {/* ── Row: M | Post ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: BTN_GAP }}>
          <Btn label="M" />
          <Btn label="Post" active={meterPost} activeColor="#1a6a8a" onClick={handleMeterPost} />
        </div>

        {/* ── Row: Grp | RTA ── */}
        <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: G }}>
          <Btn
            label={trackGroup?.name?.[0] ?? "Grp"}
            active={!!trackGroup}
            activeColor={trackGroup?.color ?? "#444"}
            onClick={handleGroup}
          />
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
  const resetClip    = useEngineStore((s) => s.resetClip);
  const [vol, setVol] = useState(0);

  const handleMasterVol = (db: number) => { setVol(db); engineClient.setMasterVolume(db); };
  const handleResetClip = () => { resetClip("__master__"); };
  const P = "2px";
  const G = "1px";

  return (
    <div style={{
      width: STRIP_W + 16,
      background: MASTER_STRIP,
      borderLeft: `1px solid #3a3a3a`,
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
    }}>
      {/* Top panel */}
      <div style={{
        background: MASTER_TOP,
        borderLeft: `3px solid ${TRACK_STRIPE_COLOR}`,
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
        <MeterPeakReadout trackId="__master__" onResetClip={handleResetClip} />
      </div>

      {/* Fader + Meter */}
      <div style={{ height: FADER_AREA_H, position: "relative", flexShrink: 0, background: MASTER_STRIP, borderTop: `1px solid ${FIG_DIVIDER}` }}>
        <div style={{ position: "absolute", left: FADER_SCALE_X, top: 4 }}>
          <ProToolsFaderScale height={FADER_AREA_H - 8} />
        </div>
        <div style={{ position: "absolute", left: FADER_X, top: 4, width: FADER_W, height: FADER_AREA_H - 8 }}>
          <FaderInner valueDb={vol} onChange={handleMasterVol} />
        </div>
        <div style={{ position: "absolute", left: METER_SCALE_X, top: 10 }}>
          <ProToolsMeterScale height={METER_PANEL_H} />
        </div>
        <div style={{ position: "absolute", left: METER_X, top: 10 }}>
          <ProToolsMeterCanvas trackId="__master__" height={METER_PANEL_H} />
        </div>
      </div>

      <div style={{ display: "flex", gap: BTN_GAP, padding: P, paddingTop: BTN_GAP }}>
        <Btn label="M" /><Btn label="Post" active activeColor="#1a6a8a" />
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

function maxMixerHeight() {
  return Math.max(MIN_MIXER_H, Math.floor(window.innerHeight * 0.75));
}

// ── Mixer panel ───────────────────────────────────────────────────────────────
export function Mixer() {
  const { project } = useProjectStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mixerHeight, setMixerHeight] = useState(DEFAULT_MIXER_H);
  const isResizingRef = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(DEFAULT_MIXER_H);
  const groupScrollRef = useRef<HTMLDivElement>(null);
  const channelsScrollRef = useRef<HTMLDivElement>(null);
  const scrollSyncLock = useRef(false);

  const tracks = project?.tracks ?? [];
  const mixerColumns = useMemo(
    () => tracks.map((t, i) => ({
      id: t.id,
      left: i * STRIP_W,
      width: STRIP_W,
    })),
    [tracks],
  );
  const channelsScrollWidth = tracks.length * STRIP_W;
  const [groupStripWidth, setGroupStripWidth] = useState(channelsScrollWidth);

  useEffect(() => {
    setGroupStripWidth((w) => Math.max(channelsScrollWidth, w));
  }, [channelsScrollWidth]);

  useEffect(() => {
    const el = groupScrollRef.current;
    if (!el) return;
    const measure = () => {
      setGroupStripWidth(Math.max(channelsScrollWidth, el.clientWidth));
    };
    return onLayoutResize(el, measure);
  }, [channelsScrollWidth, collapsed]);

  const syncScroll = useCallback((source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (!target || scrollSyncLock.current) return;
    scrollSyncLock.current = true;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => { scrollSyncLock.current = false; });
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartY.current = e.clientY;
    resizeStartH.current = mixerHeight;

    const onMove = rafThrottle((ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartY.current - ev.clientY;
      const next = Math.max(MIN_MIXER_H, Math.min(maxMixerHeight(), resizeStartH.current + delta));
      setMixerHeight(next);
    });

    const onUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [mixerHeight]);

  if (!project || tracks.length === 0) return null;

  return (
    <div className="relative flex flex-col border-t flex-shrink-0" style={{
      borderColor: "#111",
      background: MIXER_BG,
      height: collapsed ? MIXER_TOOLBAR_H : mixerHeight,
    }}>
      {/* Top-edge resize handle */}
      {!collapsed && (
        <div
          className="absolute left-0 right-0 z-30 flex items-center justify-center group"
          style={{ top: -3, height: 6, cursor: "ns-resize" }}
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize mixer"
        >
          <div
            className="rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ width: 48, height: 3, background: "#555" }}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 border-b flex-shrink-0" style={{ height: MIXER_TOOLBAR_H, borderColor: "#111", background: "#1a1a1a" }}>
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
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Full-width black group gutter — edge to edge above channels + master */}
          <div
            className="flex flex-shrink-0 w-full"
            style={{
              height: MIXER_GROUP_ROW_H,
              background: "#000",
              borderBottom: "1px solid #2a2a2a",
              boxShadow: "0 1px 0 #3a3a3a",
            }}
          >
            <div
              ref={groupScrollRef}
              className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
              onScroll={(e) => syncScroll(e.currentTarget, channelsScrollRef.current)}
            >
              <MixerGroupStrip columns={mixerColumns} width={groupStripWidth} />
            </div>
            <div
              style={{
                width: MASTER_W,
                flexShrink: 0,
                background: "#000",
                borderLeft: "1px solid #3a3a3a",
              }}
            />
          </div>

          {/* Channel strips + pinned master */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            <div
              ref={channelsScrollRef}
              className="flex flex-1 overflow-x-auto overflow-y-hidden min-w-0"
              style={{ background: MIXER_BG }}
              onScroll={(e) => syncScroll(e.currentTarget, groupScrollRef.current)}
            >
              {project.tracks.map((t) => <ChannelStrip key={t.id} track={t} />)}
            </div>
            <MasterStrip />
          </div>
        </div>
      )}
    </div>
  );
}
