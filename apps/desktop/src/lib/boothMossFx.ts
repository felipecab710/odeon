import type { TransitionPlanData } from "./apiClient";

export interface MossFxHints {
  beatFxName: string;
  soundColorFx: string;
  reason?: string;
}

const STRATEGY_FX: Record<string, MossFxHints> = {
  filter_sweep:     { beatFxName: "ECHO",    soundColorFx: "FILTER" },
  eq_kill:          { beatFxName: "DELAY",   soundColorFx: "CRUSH" },
  bass_swap:        { beatFxName: "SPIRAL",  soundColorFx: "SWEEP" },
  echo_out:         { beatFxName: "ECHO",    soundColorFx: "D.ECHO" },
  quick_cut:        { beatFxName: "DELAY",   soundColorFx: "NOISE" },
  harmonic_blend:   { beatFxName: "REVERB",  soundColorFx: "SPACE" },
  energy_build:     { beatFxName: "SPIRAL",  soundColorFx: "SWEEP" },
  drop_mix:         { beatFxName: "FLANGER", soundColorFx: "CRUSH" },
};

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "_");
}

export function mossFxFromPlan(plan: TransitionPlanData | null | undefined): MossFxHints {
  if (!plan?.strategy) {
    return { beatFxName: "ECHO", soundColorFx: "FILTER", reason: plan?.reason };
  }
  const key = normalizeKey(plan.strategy);
  const hit = STRATEGY_FX[key];
  if (hit) {
    return { ...hit, reason: plan.reason ?? plan.strategy };
  }
  return {
    beatFxName: "DELAY",
    soundColorFx: "FILTER",
    reason: plan.strategy,
  };
}
