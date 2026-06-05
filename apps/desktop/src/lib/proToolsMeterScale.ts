/**
 * Pro Tools peak-meter scale — attenuation labels 0…60 dB below full scale.
 * Non-linear layout: 0–40 dB evenly spaced, 40–60 compressed at the bottom.
 */

export const PT_SCALE_MARKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60] as const;

/** dB attenuation (0 = top / full scale, 60 = bottom / -60 dBFS) → fraction from top [0,1]. */
export function attenuationToTopFrac(att: number): number {
  if (att <= 0) return 0;
  if (att >= 60) return 1;
  if (att <= 40) return 0.82 * (att / 40);
  if (att <= 50) return 0.82 + 0.10 * ((att - 40) / 10);
  return 0.92 + 0.08 * ((att - 50) / 10);
}

/** dBFS → fraction from top. 0 dBFS = 0, -60 dBFS = 1. */
export function dbfsToTopFrac(db: number): number {
  if (db > 0) return 0;
  return attenuationToTopFrac(Math.min(60, -db));
}

export function scaleMarkToTopFrac(mark: number): number {
  return attenuationToTopFrac(mark);
}

/** Format attenuation label (Pro Tools shows positive numbers, 0 at top). */
export function formatScaleLabel(mark: number): string {
  return String(mark);
}

/**
 * Permanent meter background zones (Pro Tools "shades"):
 *   0–8 dB below FS  → hot / near-clip (olive)
 *   8–35 dB below FS → nominal (forest green)
 *   35–60 dB below FS → quiet (near-black)
 */
export const METER_ZONE_HOT_END = 8;
export const METER_ZONE_NOMINAL_END = 35;
