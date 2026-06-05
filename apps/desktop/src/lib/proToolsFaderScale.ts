/**
 * Pro Tools fader scale — gain in dB, unity (0) ~⅓ from top.
 * Labels: 12, 6, 0, 5, 10, 15, 20, 30, 40, 60, ∞
 */

export interface FaderMark {
  label: string;
  db: number;
  /** 0 = top of travel, 1 = bottom (∞). */
  topFrac: number;
}

export const PT_FADER_MARKS: readonly FaderMark[] = [
  { label: "12", db: 12,   topFrac: 0.03 },
  { label: "6",  db: 6,    topFrac: 0.13 },
  { label: "0",  db: 0,    topFrac: 0.34 },
  { label: "5",  db: -5,   topFrac: 0.44 },
  { label: "10", db: -10,  topFrac: 0.52 },
  { label: "15", db: -15,  topFrac: 0.58 },
  { label: "20", db: -20,  topFrac: 0.62 },
  { label: "30", db: -30,  topFrac: 0.72 },
  { label: "40", db: -40,  topFrac: 0.82 },
  { label: "60", db: -60,  topFrac: 0.93 },
  { label: "∞",  db: -120, topFrac: 1.0 },
] as const;

const BY_DB = [...PT_FADER_MARKS].sort((a, b) => a.db - b.db);
const BY_TOP = [...PT_FADER_MARKS].sort((a, b) => a.topFrac - b.topFrac);

/** Fader position 0 = bottom (∞), 1 = top (+12 dB). */
export function faderDbToPos(db: number): number {
  const clamped = Math.max(-120, Math.min(12, db));
  for (let i = 0; i < BY_DB.length - 1; i++) {
    const lo = BY_DB[i];
    const hi = BY_DB[i + 1];
    if (clamped >= lo.db && clamped <= hi.db) {
      const t = hi.db === lo.db ? 0 : (clamped - lo.db) / (hi.db - lo.db);
      return 1 - (lo.topFrac + t * (hi.topFrac - lo.topFrac));
    }
  }
  return clamped >= BY_DB[BY_DB.length - 1].db ? 0 : 1;
}

export function faderPosToDb(pos: number): number {
  const topFrac = 1 - Math.max(0, Math.min(1, pos));
  for (let i = 0; i < BY_TOP.length - 1; i++) {
    const lo = BY_TOP[i];
    const hi = BY_TOP[i + 1];
    if (topFrac >= lo.topFrac && topFrac <= hi.topFrac) {
      const t = hi.topFrac === lo.topFrac ? 0 : (topFrac - lo.topFrac) / (hi.topFrac - lo.topFrac);
      return lo.db + t * (hi.db - lo.db);
    }
  }
  return topFrac >= BY_TOP[BY_TOP.length - 1].topFrac
    ? BY_TOP[BY_TOP.length - 1].db
    : BY_TOP[0].db;
}

export function faderMarkTopFrac(mark: FaderMark): number {
  return mark.topFrac;
}
