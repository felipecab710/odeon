/** Shared automation curves for set transitions (DJ.Studio / Pioneer simulation). */

export function transitionGainCurve(t: number, isOutgoing: boolean): number {
  if (isOutgoing) return t < 0.35 ? 1 : t > 0.65 ? 0 : 1 - (t - 0.35) / 0.3;
  return t < 0.35 ? 0 : t > 0.65 ? 1 : (t - 0.35) / 0.3;
}

export function transitionFilterCurve(t: number, isOutgoing: boolean): number {
  if (!isOutgoing) return 0;
  return t < 0.3 ? 0 : t > 0.7 ? 1 : (t - 0.3) / 0.4;
}

export function transitionEqKillCurve(t: number, isOutgoing: boolean): number {
  if (!isOutgoing) return 0;
  return t < 0.4 ? 0 : t > 0.6 ? -12 : -12 * ((t - 0.4) / 0.2);
}

/** Crossfader position through a transition (0 = full outgoing, 1 = full incoming). */
export function transitionCrossfaderPos(t: number): number {
  if (t < 0.3) return 0;
  if (t > 0.7) return 1;
  return (t - 0.3) / 0.4;
}
