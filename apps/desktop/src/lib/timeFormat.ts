/**
 * Pro Tools–style time formatters.
 * v1: constant tempo + single meter; canonical unit is seconds (sample-accurate later).
 */

export const TICKS_PER_QUARTER = 960;

export type Timebase =
  | "bars-beats"
  | "min-sec"
  | "timecode"
  | "feet-frames"
  | "samples";

export const TIMEBASE_LABELS: Record<Timebase, string> = {
  "bars-beats":  "Bars|Beats",
  "min-sec":     "Min:Secs",
  "timecode":    "Timecode",
  "feet-frames": "Feet+Frames",
  "samples":     "Samples",
};

export const TIMEBASE_MENU_ORDER: Timebase[] = [
  "bars-beats",
  "min-sec",
  "timecode",
  "feet-frames",
  "samples",
];

/** @deprecated use TIMEBASE_MENU_ORDER */
export const TIMEBASE_ORDER = TIMEBASE_MENU_ORDER;

export interface MeterConfig {
  bpm: number;
  numerator: number;
  denominator: number;
}

/** Duration of one beat (denominator note) in seconds. */
export function beatDurationSeconds({ bpm, denominator }: MeterConfig): number {
  return (60 / bpm) * (4 / denominator);
}

/** Convert seconds → { bar, beat, tick } (1-indexed bar/beat, 0-indexed tick). */
export function secondsToBarsBeats(
  seconds: number,
  meter: MeterConfig,
): { bar: number; beat: number; tick: number } {
  const beatDur = beatDurationSeconds(meter);
  if (beatDur <= 0 || seconds < 0) return { bar: 1, beat: 1, tick: 0 };

  const totalBeats = seconds / beatDur;
  const bar = Math.floor(totalBeats / meter.numerator) + 1;
  const beat = Math.floor(totalBeats % meter.numerator) + 1;
  const fracBeat = totalBeats - Math.floor(totalBeats);
  const tick = Math.min(
    TICKS_PER_QUARTER - 1,
    Math.max(0, Math.round(fracBeat * TICKS_PER_QUARTER)),
  );
  return { bar, beat, tick };
}

/** Format absolute musical position: `64|4|632` */
export function formatBarsBeats(seconds: number, meter: MeterConfig): string {
  const { bar, beat, tick } = secondsToBarsBeats(seconds, meter);
  return `${bar}|${beat}|${String(tick).padStart(3, "0")}`;
}

/**
 * Format a duration (not absolute position) as bar|beat|tick components.
 * Middle beat field may be 0 — matches Pro Tools Length display (`99|0|918`).
 */
export function formatBarsBeatsDuration(lengthSeconds: number, meter: MeterConfig): string {
  if (lengthSeconds <= 0) return `0|0|000`;
  const beatDur = beatDurationSeconds(meter);
  const totalBeats = lengthSeconds / beatDur;
  const bars = Math.floor(totalBeats / meter.numerator);
  const beats = Math.floor(totalBeats % meter.numerator);
  const fracBeat = totalBeats - Math.floor(totalBeats);
  const tick = Math.min(
    TICKS_PER_QUARTER - 1,
    Math.max(0, Math.round(fracBeat * TICKS_PER_QUARTER)),
  );
  return `${bars}|${beats}|${String(tick).padStart(3, "0")}`;
}

/** Format as minutes:seconds with centiseconds: `1:23.45` */
export function formatMinSec(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m  = Math.floor(clamped / 60);
  const s  = Math.floor(clamped % 60);
  const cs = Math.floor((clamped % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Format as timecode with centiseconds: `0:00:03.12` */
export function formatTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h   = Math.floor(clamped / 3600);
  const m   = Math.floor((clamped % 3600) / 60);
  const s   = Math.floor(clamped % 60);
  const cs  = Math.floor((clamped % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const FRAMES_PER_FOOT = 16;
const FEET_FRAMES_FPS = 30;

/** Format as feet+frames (35mm-style, 16 frames/foot @ 30 fps): `+01+08` */
export function formatFeetFrames(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalFrames = Math.round(clamped * FEET_FRAMES_FPS);
  const feet = Math.floor(totalFrames / FRAMES_PER_FOOT);
  const frames = totalFrames % FRAMES_PER_FOOT;
  return `+${String(feet).padStart(2, "0")}+${String(frames).padStart(2, "0")}`;
}

/** Format as absolute sample position. */
export function formatSamples(seconds: number, sampleRate = 48000): string {
  const samples = Math.max(0, Math.round(seconds * sampleRate));
  return samples.toLocaleString("en-US");
}

/** Format seconds using the active main timebase. */
export function formatPosition(
  seconds: number,
  timebase: Timebase,
  meter: MeterConfig,
  sampleRate = 48000,
): string {
  switch (timebase) {
    case "min-sec":     return formatMinSec(seconds);
    case "timecode":    return formatTimecode(seconds);
    case "feet-frames": return formatFeetFrames(seconds);
    case "samples":     return formatSamples(seconds, sampleRate);
    default:            return formatBarsBeats(seconds, meter);
  }
}

/** Format a duration — uses duration-style bars|beats for length fields. */
export function formatDuration(
  lengthSeconds: number,
  timebase: Timebase,
  meter: MeterConfig,
  sampleRate = 48000,
): string {
  switch (timebase) {
    case "min-sec":     return formatMinSec(lengthSeconds);
    case "timecode":    return formatTimecode(lengthSeconds);
    case "feet-frames": return formatFeetFrames(lengthSeconds);
    case "samples":     return formatSamples(lengthSeconds, sampleRate);
    default:            return formatBarsBeatsDuration(lengthSeconds, meter);
  }
}
