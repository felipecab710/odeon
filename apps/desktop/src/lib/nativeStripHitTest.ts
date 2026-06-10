import { HEADER_H } from "../components/setbuilder/setTimelineLayout";
import { nativeIsDeckStripColumn, nativeLaneIndexFromClientY, nativeLocalX, nativeLocalY } from "./nativeTimelineHitTest";

export type NativeStripAction =
  | { kind: "select"; laneIndex: number }
  | { kind: "toggleExpand"; laneIndex: number }
  | { kind: "toggleSolo"; laneIndex: number }
  | { kind: "toggleCue"; laneIndex: number }
  | { kind: "toggleMute"; laneIndex: number }
  | { kind: "toggleAutomation"; laneIndex: number };

const STRIP_BTN_Y = 28;
const STRIP_BTN_H = 12;

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
    if (lx >= 8 && lx < 26) return { kind: "toggleSolo", laneIndex };
    if (lx >= 26 && lx < 44) return { kind: "toggleCue", laneIndex };
    if (lx >= 44 && lx < 62) return { kind: "toggleMute", laneIndex };
    if (lx >= 62 && lx < 80) return { kind: "toggleAutomation", laneIndex };
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
  return "pointer";
}
