/**
 * Apply drawn/recorded keyframes to deck mix at a global playhead time.
 */
import {
  sampleKeyframes,
  normToMixValue,
  type AutomationKeyframe,
} from "./automationMath";
import type { AutomationParam } from "../stores/studioAutomationStore";
import type { DeckMix } from "./deckMixEngine";
import {
  transitionGainCurve,
  transitionFilterCurve,
  transitionEqKillCurve,
} from "./boothCurves";

const GAIN_TO_DB = (g: number) => (g <= 0.001 ? -60 : 20 * Math.log10(g));

function hasCustomCurve(curves: Partial<Record<AutomationParam, AutomationKeyframe[]>> | undefined, param: AutomationParam): boolean {
  const kfs = curves?.[param];
  return !!kfs && kfs.length > 0;
}

/** Merge custom keyframes with built-in transition curves (keyframes win when present). */
export function applyLaneAutomation(
  mix: DeckMix,
  curves: Partial<Record<AutomationParam, AutomationKeyframe[]>> | undefined,
  playheadSec: number,
  opts?: {
    inTransition?: boolean;
    transT?: number;
    isOutgoing?: boolean;
    globalEnabled?: boolean;
  },
): DeckMix {
  if (!opts?.globalEnabled || !mix.showAutomation) return mix;

  let result = { ...mix };
  const inTrans = opts.inTransition ?? false;
  const transT = opts.transT ?? 0;
  const isOutgoing = opts.isOutgoing ?? false;

  const applyParam = (param: AutomationParam, apply: (v: number) => void) => {
    const norm = sampleKeyframes(curves?.[param], playheadSec);
    if (norm != null) {
      apply(normToMixValue(param, norm));
    }
  };

  if (hasCustomCurve(curves, "trackVolume")) {
    applyParam("trackVolume", v => { result.faderDb = v; });
  } else if (inTrans) {
    result.faderDb = GAIN_TO_DB(transitionGainCurve(transT, isOutgoing));
  }

  if (hasCustomCurve(curves, "filter")) {
    applyParam("filter", v => { result.filter = v; });
  } else if (inTrans && isOutgoing) {
    result.filter = mix.filter + transitionFilterCurve(transT, true) * 12;
  }

  if (hasCustomCurve(curves, "low")) {
    applyParam("low", v => { result.low = v; });
  } else if (inTrans && isOutgoing) {
    const eqKill = transitionEqKillCurve(transT, true);
    if (eqKill < 0) result.low = Math.min(result.low, eqKill);
  }

  if (hasCustomCurve(curves, "mid")) {
    applyParam("mid", v => { result.mid = v; });
  }
  if (hasCustomCurve(curves, "high")) {
    applyParam("high", v => { result.high = v; });
  }

  if (hasCustomCurve(curves, "crossfader")) {
    applyParam("crossfader", v => {
      result.cfAssign = v < 0.33 ? "A" : v > 0.66 ? "B" : "THRU";
    });
  }

  return result;
}
