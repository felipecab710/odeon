/**
 * Pro Tools–style stereo peak meters — canvas-rendered for low latency.
 *
 * Perf: subscribes to engineStore directly and redraws canvas only when levels
 * change, so the parent ChannelStrip does not re-render at ~60 fps.
 */
import { memo, useEffect, useRef } from "react";
import { useEngineStore } from "../../stores/engineStore";
import {
  PT_SCALE_MARKS,
  METER_ZONE_HOT_END,
  METER_ZONE_NOMINAL_END,
  dbfsToTopFrac,
  formatScaleLabel,
  scaleMarkToTopFrac,
} from "../../lib/proToolsMeterScale";
import { PT_FADER_MARKS } from "../../lib/proToolsFaderScale";

const METER_W = 7;
const BAR_GAP = 1;
const CLIP_H = 5;

// Pro Tools meter — zone shades + ghost segment dividers
const ZONE_HOT      = "#1e1c12"; // olive — near clip (0–8 dB below FS)
const ZONE_NOMINAL  = "#0e160e"; // forest green — sweet spot (8–35)
const ZONE_QUIET    = "#050705"; // near-black — low level (35–60)
const DIVIDER_SUBTLE = "#222222";
// Pro Tools lit-bar bands (green → lime → yellow → orange near 0 dBFS)
const BAR_DGREEN = "#2a6a2e";
const BAR_GREEN  = "#3d9e3d";
const BAR_LIME   = "#7ed44a";
const BAR_YELLOW = "#e8c838";
const BAR_ORANGE = "#d87828";
const TICK_LIGHT = "#666";
const PEAK_HOLD = "#e8d840";
const CLIP_LIT = "#e89020";
const CLIP_UNLIT = "#1a1008";

interface Levels {
  leftDb: number;
  rightDb: number;
  peakLeftDb: number;
  peakRightDb: number;
  clipping: boolean;
}

/** Color for a lit bar segment at the given dBFS level. */
function barColorAtDb(dbfs: number): string {
  const att = -dbfs; // attenuation below full scale (0 at ceiling)
  if (att <= 5)  return BAR_ORANGE;
  if (att <= 10) return BAR_YELLOW;
  if (att <= 20) return BAR_LIME;
  if (att <= 35) return BAR_GREEN;
  return BAR_DGREEN;
}

/** Permanent zone shades — visual guide for hot / nominal / quiet ranges. */
function drawZoneShades(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  meterTop: number,
  meterH: number,
) {
  const yHot = meterTop + scaleMarkToTopFrac(METER_ZONE_HOT_END) * meterH;
  const yNom = meterTop + scaleMarkToTopFrac(METER_ZONE_NOMINAL_END) * meterH;
  const yBot = y + h;

  ctx.fillStyle = ZONE_HOT;
  ctx.fillRect(x, y, w, yHot - y);
  ctx.fillStyle = ZONE_NOMINAL;
  ctx.fillRect(x, yHot, w, yNom - yHot);
  ctx.fillStyle = ZONE_QUIET;
  ctx.fillRect(x, yNom, w, yBot - yNom);
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  db: number,
  peakDb: number,
  meterTop: number,
  meterH: number,
) {
  drawZoneShades(ctx, x, y, w, h, meterTop, meterH);

  const topFrac = dbfsToTopFrac(db);
  const fillTop = y + topFrac * h;
  const fillH = y + h - fillTop;

  if (fillH > 0.5) {
    const grad = ctx.createLinearGradient(x, fillTop, x, y + h);
    const addStop = (dbfs: number, color: string) => {
      const markY = y + dbfsToTopFrac(dbfs) * h;
      const t = (markY - fillTop) / (y + h - fillTop);
      if (t >= 0 && t <= 1) grad.addColorStop(t, color);
    };
    grad.addColorStop(0, barColorAtDb(db));
    addStop(0,   BAR_ORANGE);
    addStop(-5,  BAR_YELLOW);
    addStop(-10, BAR_LIME);
    addStop(-20, BAR_GREEN);
    addStop(-40, BAR_DGREEN);
    grad.addColorStop(1, BAR_DGREEN);
    ctx.fillStyle = grad;
    ctx.fillRect(x, fillTop, w, fillH);
  }

  // Peak hold
  if (peakDb > -60) {
    const peakY = y + dbfsToTopFrac(peakDb) * h;
    ctx.fillStyle = PEAK_HOLD;
    ctx.fillRect(x, peakY, w, 2);
  }
}

/** Ghost horizontal segment lines — major scale marks only, 1 px, low contrast. */
function drawSegmentDividers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  meterTop: number,
  meterH: number,
) {
  ctx.save();
  ctx.strokeStyle = DIVIDER_SUBTLE;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  for (const mark of PT_SCALE_MARKS) {
    if (mark === 0) continue; // top edge is the meter border
    const ty = meterTop + scaleMarkToTopFrac(mark) * meterH + 0.5;
    if (ty <= y + 1 || ty >= y + h - 1) continue;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + w, ty);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeters(
  canvas: HTMLCanvasElement,
  levels: Levels,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, w, h);

  const meterTop = CLIP_H + 2;
  const meterH = h - meterTop - 1;
  const lx = 0;
  const rx = METER_W + BAR_GAP;

  // Clip LEDs — L / R squares
  const clipW = (METER_W * 2 + BAR_GAP) / 2 - 0.5;
  ctx.fillStyle = levels.clipping ? CLIP_LIT : CLIP_UNLIT;
  ctx.fillRect(lx, 0, clipW, CLIP_H);
  ctx.fillRect(rx, 0, clipW, CLIP_H);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.strokeRect(lx + 0.5, 0.5, clipW - 1, CLIP_H - 1);
  ctx.strokeRect(rx + 0.5, 0.5, clipW - 1, CLIP_H - 1);

  // Meter borders
  ctx.strokeStyle = "#000";
  ctx.strokeRect(lx + 0.5, meterTop + 0.5, METER_W - 1, meterH - 1);
  ctx.strokeRect(rx + 0.5, meterTop + 0.5, METER_W - 1, meterH - 1);

  const barX = lx + 1;
  const barY = meterTop + 1;
  const barW = METER_W - 2;
  const barH = meterH - 2;
  const barRX = rx + 1;

  drawBar(ctx, barX, barY, barW, barH, levels.leftDb, levels.peakLeftDb, meterTop, meterH);
  drawBar(ctx, barRX, barY, barW, barH, levels.rightDb, levels.peakRightDb, meterTop, meterH);

  drawSegmentDividers(ctx, barX, barY, barW, barH, meterTop, meterH);
  drawSegmentDividers(ctx, barRX, barY, barW, barH, meterTop, meterH);

  // L/R channel divider
  const divX = lx + METER_W + BAR_GAP / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(divX, meterTop + 1, 1, meterH - 2);
}

function levelsEqual(a: Levels, b: Levels): boolean {
  return (
    a.leftDb === b.leftDb &&
    a.rightDb === b.rightDb &&
    a.peakLeftDb === b.peakLeftDb &&
    a.peakRightDb === b.peakRightDb &&
    a.clipping === b.clipping
  );
}

function readLevels(trackId: string): Levels {
  const s = useEngineStore.getState();
  if (trackId === "__master__") {
    const m = s.masterMeter;
    return {
      leftDb: m.leftDb, rightDb: m.rightDb,
      peakLeftDb: m.peakLeftDb, peakRightDb: m.peakRightDb,
      clipping: m.clipping,
    };
  }
  const t = s.trackStates[trackId];
  return {
    leftDb: t?.leftMeterDb ?? -90,
    rightDb: t?.rightMeterDb ?? -90,
    peakLeftDb: t?.peakLeftDb ?? -90,
    peakRightDb: t?.peakRightDb ?? -90,
    clipping: t?.clipping ?? false,
  };
}

/** Canvas L/R meters — isolated from parent React tree for perf. */
export const ProToolsMeterCanvas = memo(function ProToolsMeterCanvas({
  trackId,
  height,
}: {
  trackId: string;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<Levels>(readLevels(trackId));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const redraw = () => drawMeters(canvas, levelsRef.current);

    redraw();

    const unsub = useEngineStore.subscribe((state) => {
      let next: Levels;
      if (trackId === "__master__") {
        const m = state.masterMeter;
        next = {
          leftDb: m.leftDb, rightDb: m.rightDb,
          peakLeftDb: m.peakLeftDb, peakRightDb: m.peakRightDb,
          clipping: m.clipping,
        };
      } else {
        const t = state.trackStates[trackId];
        next = {
          leftDb: t?.leftMeterDb ?? -90,
          rightDb: t?.rightMeterDb ?? -90,
          peakLeftDb: t?.peakLeftDb ?? -90,
          peakRightDb: t?.peakRightDb ?? -90,
          clipping: t?.clipping ?? false,
        };
      }
      if (!levelsEqual(levelsRef.current, next)) {
        levelsRef.current = next;
        redraw();
      }
    });

    return unsub;
  }, [trackId, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: METER_W * 2 + BAR_GAP,
        height,
        display: "block",
        flexShrink: 0,
      }}
    />
  );
});

/** Meter scale (dBFS) — sits between fader and meter bars. */
export const ProToolsMeterScale = memo(function ProToolsMeterScale({
  height,
}: {
  height: number;
}) {
  const meterTop = CLIP_H + 2;
  const meterH = height - meterTop - 1;

  return (
    <div className="relative" style={{ width: 18, height, flexShrink: 0 }}>
      {PT_SCALE_MARKS.map((mark) => {
        const top = meterTop + scaleMarkToTopFrac(mark) * meterH;
        const isHot = mark <= 5;
        return (
          <div
            key={mark}
            className="absolute pointer-events-none flex items-center justify-end"
            style={{ top, transform: "translateY(-50%)", right: 0, gap: 2, width: "100%" }}
          >
            <span style={{
              fontSize: 7.5, lineHeight: 1,
              fontFamily: "'Inter', Arial, sans-serif",
              fontWeight: 500,
              color: isHot ? "#eee" : "#aaa",
              whiteSpace: "nowrap",
            }}>
              {formatScaleLabel(mark)}
            </span>
            <div style={{
              width: 3, height: 1,
              background: isHot ? "#ccc" : TICK_LIGHT,
              flexShrink: 0,
            }} />
          </div>
        );
      })}
    </div>
  );
});

/** Fader gain scale — sits left of the fader groove. */
export const ProToolsFaderScale = memo(function ProToolsFaderScale({
  height,
}: {
  height: number;
}) {
  const travelTop = 4;
  const travelH = height - 8;

  return (
    <div className="relative" style={{ width: 14, height, flexShrink: 0 }}>
      {PT_FADER_MARKS.map((mark) => {
        const top = travelTop + mark.topFrac * travelH;
        const isUnity = mark.label === "0";
        const isBoost = mark.db > 0;
        return (
          <div
            key={mark.label}
            className="absolute pointer-events-none flex items-center"
            style={{ top, transform: "translateY(-50%)", left: 0, gap: 1, width: "100%" }}
          >
            <div style={{
              width: isUnity ? 4 : 2, height: 1,
              background: isUnity ? "#aaa" : "#555",
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 7, lineHeight: 1,
              fontFamily: "'Inter', Arial, sans-serif",
              fontWeight: isUnity ? 600 : 500,
              color: isBoost ? "#ddd" : isUnity ? "#eee" : "#888",
              whiteSpace: "nowrap",
            }}>
              {mark.label}
            </span>
          </div>
        );
      })}
    </div>
  );
});

/** Peak readout — isolated subscriber (peak + clip only, not full strip). */
export const MeterPeakReadout = memo(function MeterPeakReadout({
  trackId,
  onResetClip,
}: {
  trackId: string;
  onResetClip: () => void;
}) {
  const { peakDb, clipping } = useEngineStore((s) => {
    if (trackId === "__master__") {
      const m = s.masterMeter;
      return {
        peakDb: Math.max(m.peakLeftDb, m.peakRightDb),
        clipping: m.clipping,
      };
    }
    const t = s.trackStates[trackId];
    return {
      peakDb: Math.max(t?.peakLeftDb ?? -90, t?.peakRightDb ?? -90),
      clipping: t?.clipping ?? false,
    };
  });

  const FIG_CLIP_BG = "#ff0000";
  const FIG_WARN_BG = "#880000";
  const FIG_GAIN_BG = "#101010";
  const FIG_BTN_BDR = "#000000";

  return (
    <div
      onClick={onResetClip}
      style={{
        flex: 1, height: 14,
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
  );
});

export { METER_W as PT_METER_BAR_W };
