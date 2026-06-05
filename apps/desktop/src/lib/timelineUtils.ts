/** Shared timeline geometry — pixels ↔ seconds. */

/** Full-height black strip — Pro Tools group drag gutter (left of track headers). */
export const GROUP_COL_W = 24;
/** Track strip: 2px colour rail + controls + meter — time 0 starts after group gutter. */
export const STRIPE_W   = 2;
/** Neutral rail until per-track colour coding is implemented. */
export const TRACK_STRIPE_COLOR = "#5a5a5a";
export const CONTROLS_W = 146;
export const METER_W    = 14;
export const STRIP_W    = STRIPE_W + CONTROLS_W + METER_W;
export const HEADER_W   = GROUP_COL_W + STRIP_W;
export const TRACK_H       = 80;
export const MIN_TRACK_H   = 48;
export const MAX_TRACK_H   = 320;
/** Vertical resize snaps to this pixel grid (Pro Tools–style stepped resize). */
export const RESIZE_SNAP_PX = 4;
export const RULER_H       = 40;
export const MIN_PPS       = 8;
export const MAX_PPS       = 9600;  // ~5 samples/px at 48 kHz
export const DEFAULT_PPS   = 80;

export const MIN_SESSION_SECONDS = 300;
export const SESSION_PAD_SECONDS = 120;

type TimelineTrack = {
  id?: string;
  analysis?: { duration_seconds?: number } | null;
  clip_start_seconds?: number;
};

/** Session length — always longer than any clip so clips can be repositioned freely. */
export function sessionDurationSeconds(
  tracks: TimelineTrack[],
  dragPreview?: { trackId: string; start: number } | null,
): number {
  let maxEnd = 0;
  let maxClip = 0;
  for (const t of tracks) {
    const dur = t.analysis?.duration_seconds ?? 0;
    const start = t.clip_start_seconds ?? 0;
    maxClip = Math.max(maxClip, dur);
    maxEnd = Math.max(maxEnd, start + dur);
  }
  if (dragPreview) {
    const dragged = tracks.find((t) => t.id === dragPreview.trackId);
    if (dragged) {
      const dur = dragged.analysis?.duration_seconds ?? 0;
      maxEnd = Math.max(maxEnd, dragPreview.start + dur);
    }
  }
  return Math.max(MIN_SESSION_SECONDS, maxEnd + SESSION_PAD_SECONDS, maxClip * 2);
}

/** @deprecated use sessionDurationSeconds */
export function timelineWidthSeconds(tracks: TimelineTrack[]) {
  return sessionDurationSeconds(tracks);
}

export function contentWidthPx(durationSec: number, pps: number) {
  return Math.max(800, durationSec * pps);
}

export function timeToPx(timeSec: number, pps: number) {
  return timeSec * pps;
}

export function pxToTime(px: number, pps: number) {
  return px / pps;
}

export function tickInterval(_durationSec: number, pps: number) {
  const minLabelPx = 70;
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const t of candidates) {
    if (t * pps >= minLabelPx) return t;
  }
  return 600;
}

const SNAP_MIN_PX = 12;
const SNAP_MAX_PX = 40;

/**
 * Edit-grid snap size for clip dragging — scales with zoom (and BPM when known).
 * Targets ~12–40 px per step so the clip jumps in small increments, not every pixel.
 */
export function dragSnapIntervalSeconds(pps: number, bpm?: number | null): number {
  if (bpm && bpm > 0) {
    const beat = 60 / bpm;
    const subs = [
      beat / 64, beat / 32, beat / 16, beat / 8, beat / 4, beat / 2,
      beat, beat * 2, beat * 4,
    ];
    for (const t of subs) {
      const px = t * pps;
      if (px >= SNAP_MIN_PX && px <= SNAP_MAX_PX) return t;
    }
    for (const t of subs) {
      if (t * pps >= SNAP_MIN_PX) return t;
    }
    return beat;
  }

  const candidates = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  for (const t of candidates) {
    const px = t * pps;
    if (px >= SNAP_MIN_PX && px <= SNAP_MAX_PX) return t;
  }
  for (const t of candidates) {
    if (t * pps >= SNAP_MIN_PX) return t;
  }
  return 0.1;
}

export function snapToGrid(timeSec: number, intervalSec: number): number {
  if (intervalSec <= 0) return timeSec;
  const snapped = Math.round(timeSec / intervalSec) * intervalSec;
  return Math.round(snapped * 1000) / 1000;
}

/** Minor grid subdivision — visible when zoomed in (≥ 8 px between lines). */
export function minorGridInterval(majorSec: number, pps: number): number | null {
  for (const div of [8, 4, 2]) {
    const minor = majorSec / div;
    if (minor * pps >= 8) return minor;
  }
  return null;
}

export function buildGridLines(maxDuration: number, majorStep: number, minorStep: number | null): {
  major: number[];
  minor: number[];
} {
  const major: number[] = [];
  for (let t = 0; t <= maxDuration; t += majorStep) major.push(t);

  const minor: number[] = [];
  if (minorStep && minorStep > 0) {
    for (let t = 0; t <= maxDuration + 1e-6; t += minorStep) {
      const ratio = t / majorStep;
      const isMajor = Math.abs(ratio - Math.round(ratio)) < 0.001;
      if (!isMajor) minor.push(Math.round(t * 1000) / 1000);
    }
  }
  return { major, minor };
}
