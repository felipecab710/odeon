/**
 * Ableton-style beat grid for Set Builder timeline.
 * Bar / beat / subdivision lines with zoom-adaptive density.
 */

export type BeatGridKind = "bar" | "beat" | "half" | "quarter";

export interface BeatGridLevel {
  kind: BeatGridKind;
  intervalSec: number;
  /** Min px between lines of this level to include it. */
  minPx: number;
  color: string;
}

export interface BeatGridLine {
  timeSec: number;
  kind: BeatGridKind;
}

const BEAT_LEVELS: Omit<BeatGridLevel, "intervalSec">[] = [
  { kind: "bar", minPx: 24, color: "rgba(255,255,255,0.16)" },
  { kind: "beat", minPx: 12, color: "rgba(255,255,255,0.09)" },
  { kind: "half", minPx: 8, color: "rgba(255,255,255,0.05)" },
  { kind: "quarter", minPx: 4, color: "rgba(255,255,255,0.03)" },
];

export function beatDurationSec(bpm: number): number {
  return 60 / Math.max(bpm, 1);
}

export function barDurationSec(bpm: number, beatsPerBar = 4): number {
  return beatDurationSec(bpm) * beatsPerBar;
}

/** Major ruler label spacing — every N bars when zoomed out. */
export function labeledBarMultiple(bpm: number, pps: number, targetPx = 72): number {
  const bar = barDurationSec(bpm);
  for (const mult of [1, 2, 4, 8, 16, 32, 64]) {
    if (bar * mult * pps >= targetPx) return mult;
  }
  return 64;
}

/**
 * Ableton-style bar-number density on the beat ruler.
 * Every bar when barPx ≥ 18; otherwise 1, 5, 9… or 1, 9, 17…
 */
export function rulerBarLabelMultiple(bpm: number, pps: number): number {
  const barPx = barDurationSec(bpm) * pps;
  if (barPx >= 18) return 1;
  for (const mult of [2, 4, 8, 16, 32, 64]) {
    if (barDurationSec(bpm) * mult * pps >= 40) return mult;
  }
  return 64;
}

export function buildBeatGridLevels(bpm: number, pps: number): BeatGridLevel[] {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm);

  // Always draw every bar line — Ableton keeps bar grid even when zoomed out.
  const levels: BeatGridLevel[] = [
    { kind: "bar", intervalSec: bar, minPx: 6, color: BEAT_LEVELS[0].color },
  ];

  const subs: { kind: BeatGridKind; interval: number; template: Omit<BeatGridLevel, "intervalSec"> }[] = [
    { kind: "beat", interval: beat, template: BEAT_LEVELS[1] },
    { kind: "half", interval: beat / 2, template: BEAT_LEVELS[2] },
    { kind: "quarter", interval: beat / 4, template: BEAT_LEVELS[3] },
  ];

  for (const s of subs) {
    if (s.interval * pps >= s.template.minPx) {
      levels.push({ ...s.template, intervalSec: s.interval });
    }
  }

  return levels;
}

/** Iterate grid line times in [startSec, endSec] without building the full array. */
export function* iterGridLines(
  startSec: number,
  endSec: number,
  intervalSec: number,
): Generator<number> {
  if (intervalSec <= 0) return;
  let t = Math.ceil(startSec / intervalSec) * intervalSec;
  // Snap to grid with tolerance for float drift
  t = Math.round(t * 10000) / 10000;
  while (t <= endSec + 1e-6) {
    yield t;
    t = Math.round((t + intervalSec) * 10000) / 10000;
  }
}

export function collectGridLines(
  totalSec: number,
  levels: BeatGridLevel[],
  viewStartSec: number,
  viewEndSec: number,
): BeatGridLine[] {
  const start = Math.max(0, viewStartSec);
  const end = Math.min(totalSec, viewEndSec);
  const lines: BeatGridLine[] = [];

  for (const level of levels) {
    for (const t of iterGridLines(start, end, level.intervalSec)) {
      lines.push({ timeSec: t, kind: level.kind });
    }
  }

  lines.sort((a, b) => a.timeSec - b.timeSec || kindRank(a.kind) - kindRank(b.kind));

  // One line per time — prefer bar > beat > half > quarter.
  const deduped: BeatGridLine[] = [];
  for (const line of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.timeSec - line.timeSec) < 0.001) {
      if (kindRank(line.kind) < kindRank(prev.kind)) {
        deduped[deduped.length - 1] = line;
      }
    } else {
      deduped.push(line);
    }
  }
  return deduped;
}

function kindRank(k: BeatGridKind): number {
  switch (k) {
    case "bar": return 0;
    case "beat": return 1;
    case "half": return 2;
    case "quarter": return 3;
  }
}

export function levelStyle(kind: BeatGridKind, levels: BeatGridLevel[]): string {
  return levels.find((l) => l.kind === kind)?.color ?? "rgba(255,255,255,0.05)";
}

export interface BeatRulerMark {
  timeSec: number;
  kind: BeatGridKind;
  label: string | null;
}

export interface TimeRulerMark {
  timeSec: number;
  label: string;
}

/**
 * Beat-time ruler label (top strip): bar → "10", beat → "10.2", 16th → "10.3.2".
 * Half-beat labels are omitted — Ableton uses sixteenths, not ".2" halfway ticks as text.
 */
export function formatBeatRulerLabel(
  timeSec: number,
  bpm: number,
  pps: number,
  beatsPerBar = 4,
  barLabelMult?: number,
): string | null {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm, beatsPerBar);
  const beatPx = beat * pps;
  const barPx = bar * pps;
  const mult = barLabelMult ?? rulerBarLabelMultiple(bpm, pps);

  const totalBeats = timeSec / beat;
  const barNum = Math.floor(totalBeats / beatsPerBar) + 1;
  const barIndex = barNum - 1;
  const beatInBar = (Math.floor(totalBeats) % beatsPerBar) + 1;
  const fracBeat = totalBeats - Math.floor(totalBeats);

  const isBarLine = timeSec < 0.001 || Math.abs(timeSec % bar) < 0.002;
  const isBeatLine = Math.abs(fracBeat) < 0.002;
  const isSixteenth = Math.abs(fracBeat - 0.25) < 0.002 || Math.abs(fracBeat - 0.75) < 0.002;

  if (isBarLine && barPx >= 8 && barIndex % mult === 0) return String(barNum);
  if (isBeatLine && !isBarLine && beatPx >= 18) return `${barNum}.${beatInBar}`;
  if (isSixteenth && beatPx >= 28) {
    return `${barNum}.${beatInBar}.${fracBeat < 0.5 ? 2 : 4}`;
  }

  return null;
}

/** @deprecated Use formatBeatRulerLabel */
export const formatAbletonRulerLabel = formatBeatRulerLabel;

const MAX_RULER_TICKS = 400;

/** Pick tick density so we never exceed MAX_RULER_TICKS in the view span. */
export function rulerTickIntervalSec(
  bpm: number,
  pps: number,
  viewSpanSec: number,
): number {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm);
  const candidates = [beat / 4, beat / 2, beat, bar, bar * 2, bar * 4, bar * 8];
  for (const interval of candidates) {
    if (viewSpanSec / interval <= MAX_RULER_TICKS) return interval;
  }
  return bar * 16;
}

/** Collect beat-time ruler marks with label collision filtering. */
export function collectBeatRulerMarks(
  totalSec: number,
  _levels: BeatGridLevel[],
  viewStartSec: number,
  viewEndSec: number,
  bpm: number,
  pps: number,
): BeatRulerMark[] {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm);
  const barPx = bar * pps;
  const barMult = rulerBarLabelMultiple(bpm, pps);
  const start = Math.max(0, viewStartSec);
  const end = Math.min(totalSec, viewEndSec);
  const viewSpan = Math.max(0, end - start);

  const tickInterval = rulerTickIntervalSec(bpm, pps, viewSpan);
  const raw: BeatRulerMark[] = [];
  for (const t of iterGridLines(start, end, tickInterval)) {
    raw.push({ timeSec: t, kind: classifyGridLine(t, bpm), label: null });
  }

  const deduped: BeatRulerMark[] = [];
  for (const mark of raw) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.timeSec - mark.timeSec) < 0.001) {
      if (kindRank(mark.kind) < kindRank(prev.kind)) {
        deduped[deduped.length - 1] = mark;
      }
    } else {
      deduped.push(mark);
    }
  }

  let lastLabelRight = -Infinity;
  return deduped.map((mark) => {
    const label = formatBeatRulerLabel(mark.timeSec, bpm, pps, 4, barMult);
    let showLabel: string | null = null;

    if (label) {
      const leftPx = mark.timeSec * pps;
      const approxWidth = label.length * 6 + 4;
      const minGap = label.includes(".")
        ? Math.max(20, approxWidth)
        : Math.max(10, barMult === 1 ? barPx * 0.65 : approxWidth);
      if (leftPx >= lastLabelRight + minGap) {
        showLabel = label;
        lastLabelRight = leftPx + approxWidth;
      }
    }

    return { ...mark, label: showLabel };
  });
}

/** Adaptive interval for bottom time ruler (~64–96px between labels). */
export function timeRulerIntervalSec(pps: number, targetPx = 72): number {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const sec of candidates) {
    if (sec * pps >= targetPx) return sec;
  }
  return 600;
}

/** Ableton time ruler: m:ss (e.g. 0:00, 1:30). */
export function formatTimeRulerLabel(timeSec: number): string {
  const t = Math.max(0, timeSec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function collectTimeRulerMarks(
  totalSec: number,
  viewStartSec: number,
  viewEndSec: number,
  pps: number,
): TimeRulerMark[] {
  const interval = timeRulerIntervalSec(pps);
  const start = Math.max(0, viewStartSec);
  const end = Math.min(totalSec, viewEndSec);
  const marks: TimeRulerMark[] = [];

  for (const t of iterGridLines(start, end, interval)) {
    marks.push({
      timeSec: t,
      label: formatTimeRulerLabel(t),
    });
  }
  return marks;
}

/** Ruler tick height in px — taller for stronger grid levels. */
export function rulerTickHeight(kind: BeatGridKind): number {
  switch (kind) {
    case "bar": return 14;
    case "beat": return 9;
    case "half": return 6;
    case "quarter": return 4;
  }
}

export function classifyGridLine(timeSec: number, bpm: number, beatsPerBar = 4): BeatGridKind {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm, beatsPerBar);
  const totalBeats = timeSec / beat;
  const frac = totalBeats % 1;

  if (Math.abs(timeSec % bar) < 0.02 || Math.abs(timeSec % bar - bar) < 0.02) return "bar";
  if (Math.abs(frac) < 0.02) return "beat";
  if (Math.abs(frac - 0.5) < 0.02) return "half";
  return "quarter";
}

export function viewTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  pps: number,
  padSec = 2,
): { start: number; end: number } {
  return {
    start: Math.max(0, scrollLeft / pps - padSec),
    end: (scrollLeft + viewportWidth) / pps + padSec,
  };
}

/** Paint beat ruler into a viewport-sized canvas (scroll-offset). */
export function paintBeatRulerCanvas(
  ctx: CanvasRenderingContext2D,
  marks: BeatRulerMark[],
  scrollLeft: number,
  pps: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  for (const mark of marks) {
    const x = Math.round(mark.timeSec * pps - scrollLeft) + 0.5;
    if (x < -2 || x > width + 2) continue;

    const tickH = rulerTickHeight(mark.kind);
    ctx.fillStyle = mark.kind === "bar"
      ? "rgba(255,255,255,0.4)"
      : mark.kind === "beat"
        ? "rgba(255,255,255,0.22)"
        : "rgba(255,255,255,0.1)";
    ctx.fillRect(x, height - tickH, 1, tickH);

    if (mark.label) {
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = mark.kind === "bar" ? "#d4d4d4" : "#888";
      ctx.textBaseline = "top";
      ctx.fillText(mark.label, x + 4, 2);
    }
  }
}

/** Paint time ruler into a viewport-sized canvas (scroll-offset). */
export function paintTimeRulerCanvas(
  ctx: CanvasRenderingContext2D,
  marks: TimeRulerMark[],
  scrollLeft: number,
  pps: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);

  for (const mark of marks) {
    const x = Math.round(mark.timeSec * pps - scrollLeft) + 0.5;
    if (x < -12 || x > width + 12) continue;

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x, 0, 1, 6);
    ctx.fillRect(x, 5, 10, 1);

    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#999";
    ctx.textBaseline = "top";
    ctx.fillText(mark.label, x + 2, 8);
  }
}

/** Paint beat grid lines into a viewport-sized canvas (scroll-offset). */
export function paintBeatGridCanvas(
  ctx: CanvasRenderingContext2D,
  lines: BeatGridLine[],
  scrollLeft: number,
  pps: number,
  width: number,
  height: number,
  levels: BeatGridLevel[],
): void {
  for (const line of lines) {
    const x = Math.round(line.timeSec * pps - scrollLeft) + 0.5;
    if (x < 0 || x > width) continue;
    ctx.fillStyle = levelStyle(line.kind, levels);
    ctx.fillRect(x, 0, 1, height);
  }
}
