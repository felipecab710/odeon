import { HEADER_H } from "../components/setbuilder/setTimelineLayout";
import { faderDbToPos, faderPosToDb } from "./proToolsFaderScale";
import { nativeIsDeckStripColumn, nativeLaneIndexFromClientY, nativeLocalX, nativeLocalY } from "./nativeTimelineHitTest";

export type NativeStripAction =
  | { kind: "select"; laneIndex: number }
  | { kind: "toggleExpand"; laneIndex: number }
  | { kind: "toggleSolo"; laneIndex: number }
  | { kind: "toggleCue"; laneIndex: number }
  | { kind: "toggleMute"; laneIndex: number }
  | { kind: "toggleAutomation"; laneIndex: number }
  | { kind: "faderDrag"; laneIndex: number };

const STRIP_BTN_Y = 28;
const STRIP_BTN_H = 12;
const STRIP_FADER_W = 16;

export function nativeStripFaderBounds(
  laneTop: number,
  laneHeight: number,
  stripWidth: number,
): { left: number; right: number; top: number; bottom: number } {
  const top = laneTop + 24;
  const bottom = laneTop + laneHeight - 6;
  const left = stripWidth - 22;
  return { left, right: left + STRIP_FADER_W, top, bottom };
}

export function nativeStripFaderDbFromY(
  clientY: number,
  hostEl: HTMLElement,
  laneIndex: number,
  laneYs: number[],
  laneHeights: number[],
  laneStripWidth: number,
): number {
  const laneTop = laneYs[laneIndex] ?? 0;
  const laneH = laneHeights[laneIndex] ?? HEADER_H;
  const { top, bottom } = nativeStripFaderBounds(laneTop, laneH, laneStripWidth);
  const ly = nativeLocalY(clientY, hostEl);
  const raw = 1 - Math.max(0, Math.min(1, (ly - top) / Math.max(1, bottom - top)));
  const uPos = faderDbToPos(0);
  const snap = Math.abs(raw - uPos) < 0.025 ? uPos : raw;
  return Math.round(Math.max(-60, Math.min(12, faderPosToDb(snap))) * 10) / 10;
}

export function nativeStripHitTest(
  clientX: number,
  clientY: number,
  hostEl: HTMLElement,
  laneStripWidth: number,
  laneYs: number[],
  laneHeights: number[],
): NativeStripAction | null {
  if (!nativeIsDeckStripColumn(clientX, hostEl, laneStripWidth)) return null;
  const laneIndex = nativeLaneIndexFromClientY(clientY, hostEl, laneYs, laneHeights);
  if (laneIndex == null) return null;

  const lx = nativeLocalX(clientX, hostEl);
  const ly = nativeLocalY(clientY, hostEl);
  const laneTop = laneYs[laneIndex];
  const lyInLane = ly - laneTop;

  if (lx < 16.0 && lyInLane < HEADER_H) {
    return { kind: "toggleExpand", laneIndex };
  }
  if (lyInLane >= STRIP_BTN_Y && lyInLane <= STRIP_BTN_Y + STRIP_BTN_H) {
    if (lx >= 8 && lx < 22) return { kind: "toggleSolo", laneIndex };
    if (lx >= 26 && lx < 40) return { kind: "toggleCue", laneIndex };
    if (lx >= 44 && lx < 58) return { kind: "toggleMute", laneIndex };
    if (lx >= 62 && lx < 76) return { kind: "toggleAutomation", laneIndex };
  }
  const fader = nativeStripFaderBounds(laneTop, laneHeights[laneIndex] ?? HEADER_H, laneStripWidth);
  if (lx >= fader.left && lx <= fader.right && ly >= fader.top && ly <= fader.bottom) {
    return { kind: "faderDrag", laneIndex };
  }
  return { kind: "select", laneIndex };
}

export function nativeStripCursor(
  clientX: number,
  clientY: number,
  hostEl: HTMLElement,
  laneStripWidth: number,
  laneYs: number[],
  laneHeights: number[],
): string {
  if (!nativeIsDeckStripColumn(clientX, hostEl, laneStripWidth)) return "default";
  const action = nativeStripHitTest(clientX, clientY, hostEl, laneStripWidth, laneYs, laneHeights);
  if (!action) return "default";
  if (action.kind === "faderDrag") return "ns-resize";
  return "pointer";
}
