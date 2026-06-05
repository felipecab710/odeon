import type { OdeonTrack } from "@odeon/shared";
import type { TrackViewMode } from "./trackView";

export interface AutomationPoint {
  timeSec: number;
  value: number;
}

export interface LaneValueRange {
  min: number;
  max: number;
  unit: string;
  stepped?: boolean;
}

const AUTOMATION_MODES = new Set<TrackViewMode>([
  "volume", "volume-trim", "lfe", "mute", "pan-left", "pan-right",
]);

export function isAutomationMode(mode: TrackViewMode): boolean {
  return AUTOMATION_MODES.has(mode);
}

export function laneValueRange(mode: TrackViewMode): LaneValueRange {
  switch (mode) {
    case "volume":      return { min: -60, max: 12, unit: "dB" };
    case "volume-trim": return { min: -24, max: 24, unit: "dB" };
    case "lfe":         return { min: 0, max: 100, unit: "%" };
    case "mute":        return { min: 0, max: 1, unit: "", stepped: true };
    case "pan-left":
    case "pan-right":   return { min: -1, max: 1, unit: "" };
    default:            return { min: 0, max: 1, unit: "" };
  }
}

/** Default automation playlist — flat until user edits points. */
export function defaultAutomation(
  track: OdeonTrack,
  mode: TrackViewMode,
  durationSec: number,
): AutomationPoint[] {
  const end = Math.max(durationSec, 1);
  let value = 0;
  switch (mode) {
    case "volume":      value = track.volume_db ?? 0; break;
    case "volume-trim": value = 0; break;
    case "lfe":         value = 0; break;
    case "mute":        value = track.muted ? 0 : 1; break;
    case "pan-left":
    case "pan-right":   value = track.pan ?? 0; break;
    default:            value = 0;
  }
  return [{ timeSec: 0, value }, { timeSec: end, value }];
}

/** Linear interpolation between automation points. */
export function valueAtTime(points: AutomationPoint[], timeSec: number): number {
  if (!points.length) return 0;
  if (timeSec <= points[0].timeSec) return points[0].value;
  if (timeSec >= points[points.length - 1].timeSec) return points[points.length - 1].value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (timeSec >= a.timeSec && timeSec <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      if (span <= 0) return b.value;
      const t = (timeSec - a.timeSec) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return points[points.length - 1].value;
}

/** Map value → Y coordinate (0 = top, h = bottom). */
export function valueToY(value: number, range: LaneValueRange, height: number): number {
  const norm = (value - range.min) / (range.max - range.min);
  return height - norm * height;
}
