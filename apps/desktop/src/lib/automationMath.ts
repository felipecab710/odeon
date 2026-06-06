/**
 * Automation keyframe math — Pro Tools / Ableton style breakpoint lanes.
 */
import type { AutomationParam } from "../stores/studioAutomationStore";
import type { DeckMix } from "./deckMixEngine";

export interface AutomationKeyframe {
  /** Global timeline position (seconds). */
  timeSec: number;
  /** Normalized 0..1 (bottom..top of lane). */
  valueNorm: number;
}

const PARAM_RANGES: Record<AutomationParam, { min: number; max: number }> = {
  trackVolume: { min: -60, max: 0 },
  low: { min: -12, max: 12 },
  mid: { min: -12, max: 12 },
  high: { min: -12, max: 12 },
  filter: { min: -12, max: 12 },
  crossfader: { min: 0, max: 1 },
};

export function mixValueToNorm(param: AutomationParam, value: number): number {
  const { min, max } = PARAM_RANGES[param];
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function normToMixValue(param: AutomationParam, norm: number): number {
  const { min, max } = PARAM_RANGES[param];
  return min + Math.max(0, Math.min(1, norm)) * (max - min);
}

export function getMixParamValue(mix: DeckMix, param: AutomationParam): number {
  switch (param) {
    case "trackVolume": return mix.faderDb;
    case "low": return mix.low;
    case "mid": return mix.mid;
    case "high": return mix.high;
    case "filter": return mix.filter;
    case "crossfader":
      return mix.cfAssign === "A" ? 0 : mix.cfAssign === "B" ? 1 : 0.5;
    default: return 0;
  }
}

export function getBaselineNorm(mix: DeckMix, param: AutomationParam): number {
  return mixValueToNorm(param, getMixParamValue(mix, param));
}

/** Write a normalized automation value back onto a deck mix (live baseline tweak). */
export function applyNormToMix(mix: DeckMix, param: AutomationParam, norm: number): DeckMix {
  const v = normToMixValue(param, norm);
  switch (param) {
    case "trackVolume": return { ...mix, faderDb: v };
    case "low": return { ...mix, low: v };
    case "mid": return { ...mix, mid: v };
    case "high": return { ...mix, high: v };
    case "filter": return { ...mix, filter: v };
    case "crossfader":
      return { ...mix, cfAssign: v < 0.33 ? "A" : v > 0.66 ? "B" : "THRU" };
    default: return mix;
  }
}

export function sortKeyframes(kfs: AutomationKeyframe[]): AutomationKeyframe[] {
  return [...kfs].sort((a, b) => a.timeSec - b.timeSec);
}

/** Linear interpolation between breakpoints. Holds before first / after last. */
export function sampleKeyframes(
  keyframes: AutomationKeyframe[] | undefined,
  timeSec: number,
): number | null {
  if (!keyframes || keyframes.length === 0) return null;
  const sorted = sortKeyframes(keyframes);
  if (timeSec <= sorted[0].timeSec) return sorted[0].valueNorm;
  if (timeSec >= sorted[sorted.length - 1].timeSec) {
    return sorted[sorted.length - 1].valueNorm;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (timeSec >= a.timeSec && timeSec <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      if (span <= 0) return a.valueNorm;
      const t = (timeSec - a.timeSec) / span;
      return a.valueNorm + (b.valueNorm - a.valueNorm) * t;
    }
  }
  return sorted[sorted.length - 1].valueNorm;
}

export function upsertKeyframe(
  keyframes: AutomationKeyframe[],
  timeSec: number,
  valueNorm: number,
  mergeThresholdSec = 0.15,
): AutomationKeyframe[] {
  const norm = Math.max(0, Math.min(1, valueNorm));
  const existing = keyframes.findIndex(
    k => Math.abs(k.timeSec - timeSec) < mergeThresholdSec,
  );
  if (existing >= 0) {
    const next = [...keyframes];
    next[existing] = { timeSec, valueNorm: norm };
    return sortKeyframes(next);
  }
  return sortKeyframes([...keyframes, { timeSec, valueNorm: norm }]);
}

export function removeKeyframeNear(
  keyframes: AutomationKeyframe[],
  timeSec: number,
  thresholdSec = 0.2,
): AutomationKeyframe[] {
  return keyframes.filter(k => Math.abs(k.timeSec - timeSec) >= thresholdSec);
}

export function formatAutomationValue(param: AutomationParam, norm: number): string {
  const v = normToMixValue(param, norm);
  if (param === "trackVolume") {
    return v <= -59 ? "-inf" : `${v.toFixed(1)} dB`;
  }
  if (param === "crossfader") return v.toFixed(2);
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
}
