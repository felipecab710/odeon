/**
 * Ardour fader taper — gain/dB ↔ fader position.
 *
 * Extracted from the former webAudioEngine module; standalone with no Web Audio dependency.
 *
 * Taper (control_math.h):
 *   gain = 2^( (198 · pos^(1/8) − 192) / 6 )   pos ∈ [0,1]
 * Unity (0 dB) at pos ≈ 0.785; ceiling +6 dB at pos = 1.
 */

export function dbToGain(db: number): number { return db <= -120 ? 0 : Math.pow(10, db / 20); }
export function gainToDb(g: number):   number { return g < 1e-7 ? -120 : 20 * Math.log10(g); }

function ardourPosToGain(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 1) return 2;
  return Math.pow(2, (198 * Math.pow(pos, 1 / 8) - 192) / 6);
}
function ardourGainToPos(gain: number): number {
  if (gain <= 0) return 0;
  const inner = (6 * Math.log2(gain) + 192) / 198;
  return inner <= 0 ? 0 : Math.min(1, Math.pow(inner, 8));
}

export function ardourDbToPos(db: number): number { return ardourGainToPos(dbToGain(db)); }
export function ardourPosToDb(pos: number): number { return gainToDb(ardourPosToGain(pos)); }
