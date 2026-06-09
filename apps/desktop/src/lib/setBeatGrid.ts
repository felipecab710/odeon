/**
 * Ableton-style beat grid for Set Builder timeline.
 *
 * DAW parity model (Audacity / Ardour / Ableton):
 * - One global time axis in seconds; grid origin at t = 0.
 * - Beat/bar spacing from BPM; adaptive density from zoom (px between lines).
 * - Ruler ticks and vertical grid lines share the same time positions.
 * - Paint uses gridViewportX (timeSec * pps - scrollLeft; never double-apply scroll).
 */

export type BeatGridKind = "bar" | "subBar" | "beat" | "half" | "quarter";

/** Tolerance for floating grid alignment (≈1 ms at 120 BPM quarter-note). */
export const BEAT_GRID_EPS = 1e-3;

export interface BeatGridLevel {
  kind: BeatGridKind;
  intervalSec: number;
  minPx: number;
  color: string;
}

export interface BeatGridLine {
  timeSec: number;
  kind: BeatGridKind;
}

export interface BeatGridMetrics {
  bpm: number;
  pixelsPerSecond: number;
  beatsPerBar: number;
}

const BEAT_LEVELS: Omit<BeatGridLevel, "intervalSec">[] = [
  { kind: "bar", minPx: 0, color: "rgba(255,255,255,0.11)" },
  { kind: "subBar", minPx: 14, color: "rgba(255,255,255,0.045)" },
  { kind: "beat", minPx: 22, color: "rgba(255,255,255,0.065)" },
  { kind: "half", minPx: 10, color: "rgba(255,255,255,0.035)" },
  { kind: "quarter", minPx: 8, color: "rgba(255,255,255,0.02)" },
];

export function beatDurationSec(bpm: number): number {
  return 60 / Math.max(bpm, 1);
}

export function barDurationSec(bpm: number, beatsPerBar = 4): number {
  return beatDurationSec(bpm) * beatsPerBar;
}

export function beatIndexAt(timeSec: number, bpm: number): number {
  const beat = beatDurationSec(bpm);
  return Math.round(timeSec / beat);
}

export function timeSecAtBeatIndex(index: number, bpm: number): number {
  return index * beatDurationSec(bpm);
}

export function isOnGridInterval(
  timeSec: number,
  intervalSec: number,
  originSec = 0,
): boolean {
  if (intervalSec <= 0) return false;
  const n = (timeSec - originSec) / intervalSec;
  return Math.abs(n - Math.round(n)) * intervalSec < BEAT_GRID_EPS;
}

export function labeledBarMultiple(bpm: number, pps: number, targetPx = 72): number {
  const bar = barDurationSec(bpm);
  for (const mult of [1, 2, 4, 8, 16, 32, 64]) {
    if (bar * mult * pps >= targetPx) return mult;
  }
  return 64;
}

export function rulerBarLabelMultiple(bpm: number, pps: number): number {
  return gridBarMultiple(bpm, pps, 40);
}

export function gridBarMultiple(bpm: number, pps: number, targetPx = 56): number {
  const bar = barDurationSec(bpm);
  for (const mult of [1, 2, 4, 8, 16, 32, 64]) {
    if (bar * mult * pps >= targetPx) return mult;
  }
  return 64;
}

export function buildBeatGridLevels(
  bpm: number,
  pps: number,
  beatsPerBar = 4,
): BeatGridLevel[] {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm, beatsPerBar);
  const barPx = bar * pps;
  const barMult = gridBarMultiple(bpm, pps);

  const levels: BeatGridLevel[] = [
    { kind: "bar", intervalSec: bar * barMult, minPx: 0, color: BEAT_LEVELS[0].color },
  ];

  if (barMult > 1 && barPx >= BEAT_LEVELS[1].minPx) {
    levels.push({
      kind: "subBar",
      intervalSec: bar,
      minPx: BEAT_LEVELS[1].minPx,
      color: BEAT_LEVELS[1].color,
    });
  }

  if (barPx >= 20) {
    levels.push({ kind: "beat", intervalSec: beat, minPx: 20, color: BEAT_LEVELS[2].color });
  }
  if (barPx >= 44 && beat / 2 * pps >= BEAT_LEVELS[3].minPx) {
    levels.push({ kind: "half", intervalSec: beat / 2, minPx: BEAT_LEVELS[3].minPx, color: BEAT_LEVELS[3].color });
  }
  if (barPx >= 72 && beat / 4 * pps >= BEAT_LEVELS[4].minPx) {
    levels.push({ kind: "quarter", intervalSec: beat / 4, minPx: BEAT_LEVELS[4].minPx, color: BEAT_LEVELS[4].color });
  }

  return levels;
}

/** Finest visible grid step — used for edit snap (matches visible grid). */
export function finestVisibleGridInterval(bpm: number, pps: number, beatsPerBar = 4): number {
  const levels = buildBeatGridLevels(bpm, pps, beatsPerBar);
  if (levels.length === 0) return beatDurationSec(bpm);
  return levels.reduce((min, l) => (l.intervalSec < min ? l.intervalSec : min), Infinity);
}

/** Snap to the visible beat grid at the current zoom (Ableton edit snap). */
export function snapToVisibleBeatGrid(
  timeSec: number,
  bpm: number,
  pps: number,
  beatsPerBar = 4,
): number {
  const interval = finestVisibleGridInterval(bpm, pps, beatsPerBar);
  if (interval <= 0) return Math.max(0, timeSec);
  const snapped = Math.round(timeSec / interval) * interval;
  return Math.max(0, Math.round(snapped * 1e6) / 1e6);
}

export function* iterGridLines(
  startSec: number,
  endSec: number,
  intervalSec: number,
  originSec = 0,
): Generator<number> {
  if (intervalSec <= 0) return;
  const first = Math.ceil((startSec - originSec - BEAT_GRID_EPS) / intervalSec);
  const last = Math.floor((endSec - originSec + BEAT_GRID_EPS) / intervalSec);
  for (let i = first; i <= last; i++) {
    yield Math.round((originSec + i * intervalSec) * 1e6) / 1e6;
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

  const deduped: BeatGridLine[] = [];
  for (const line of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.timeSec - line.timeSec) < BEAT_GRID_EPS) {
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
    case "subBar": return 1;
    case "beat": return 2;
    case "half": return 3;
    case "quarter": return 4;
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

  const beatIdx = beatIndexAt(timeSec, bpm);
  const barNum = Math.floor(beatIdx / beatsPerBar) + 1;
  const barIndex = barNum - 1;
  const beatInBar = (beatIdx % beatsPerBar) + 1;

  const isBarLine = isOnGridInterval(timeSec, bar);
  const isBeatLine = isOnGridInterval(timeSec, beat) && !isBarLine;
  const isSixteenth = isOnGridInterval(timeSec, beat / 4) && !isOnGridInterval(timeSec, beat / 2);

  if (isBarLine && barPx >= 8 && barIndex % mult === 0) return String(barNum);
  if (isBeatLine && beatPx >= 18) return `${barNum}.${beatInBar}`;
  if (isSixteenth && beatPx >= 28) {
    const sixteenthInBeat = Math.round((timeSec % beat) / (beat / 4));
    return `${barNum}.${beatInBar}.${sixteenthInBeat || 2}`;
  }

  return null;
}

/** @deprecated Use formatBeatRulerLabel */
export const formatAbletonRulerLabel = formatBeatRulerLabel;

/**
 * Beat ruler marks — same time positions as vertical grid (DAW parity).
 */
export function collectBeatRulerMarks(
  totalSec: number,
  levels: BeatGridLevel[],
  viewStartSec: number,
  viewEndSec: number,
  bpm: number,
  pps: number,
  beatsPerBar = 4,
): BeatRulerMark[] {
  const bar = barDurationSec(bpm, beatsPerBar);
  const barPx = bar * pps;
  const barMult = rulerBarLabelMultiple(bpm, pps);
  const start = Math.max(0, viewStartSec);
  const end = Math.min(totalSec, viewEndSec);

  const lines = collectGridLines(totalSec, levels, start, end);

  let lastLabelRight = -Infinity;
  return lines.map((line) => {
    const label = formatBeatRulerLabel(line.timeSec, bpm, pps, beatsPerBar, barMult);
    let showLabel: string | null = null;

    if (label) {
      const leftPx = line.timeSec * pps;
      const approxWidth = label.length * 6 + 4;
      const minGap = label.includes(".")
        ? Math.max(20, approxWidth)
        : Math.max(10, barMult === 1 ? barPx * 0.65 : approxWidth);
      if (leftPx >= lastLabelRight + minGap) {
        showLabel = label;
        lastLabelRight = leftPx + approxWidth;
      }
    }

    return { timeSec: line.timeSec, kind: line.kind, label: showLabel };
  });
}

export function timeRulerIntervalSec(pps: number, targetPx = 72): number {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const sec of candidates) {
    if (sec * pps >= targetPx) return sec;
  }
  return 600;
}

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
    marks.push({ timeSec: t, label: formatTimeRulerLabel(t) });
  }
  return marks;
}

export function rulerTickHeight(kind: BeatGridKind): number {
  switch (kind) {
    case "bar": return 14;
    case "subBar": return 10;
    case "beat": return 9;
    case "half": return 6;
    case "quarter": return 4;
  }
}

export function classifyGridLine(timeSec: number, bpm: number, beatsPerBar = 4): BeatGridKind {
  const beat = beatDurationSec(bpm);
  const bar = barDurationSec(bpm, beatsPerBar);

  if (isOnGridInterval(timeSec, bar)) return "bar";
  if (isOnGridInterval(timeSec, beat)) return "beat";
  if (isOnGridInterval(timeSec, beat / 2)) return "half";
  return "quarter";
}

/** @deprecated Use setTimelineViewport.viewTimeRange */
export function viewTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  pps: number,
  padSec = 2,
): { start: number; end: number } {
  const safe = Math.max(pps, 1e-9);
  return {
    start: Math.max(0, scrollLeft / safe - padSec),
    end: (scrollLeft + viewportWidth) / safe + padSec,
  };
}

export function gridViewportX(timeSec: number, scrollLeft: number, pps: number): number {
  return timeSec * pps - scrollLeft;
}

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
    const x = Math.round(gridViewportX(mark.timeSec, scrollLeft, pps)) + 0.5;
    if (x < -2 || x > width + 2) continue;

    const tickH = rulerTickHeight(mark.kind);
    ctx.fillStyle = mark.kind === "bar"
      ? "rgba(255,255,255,0.4)"
      : mark.kind === "subBar" || mark.kind === "beat"
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
    const x = Math.round(gridViewportX(mark.timeSec, scrollLeft, pps)) + 0.5;
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
    const x = Math.round(gridViewportX(line.timeSec, scrollLeft, pps)) + 0.5;
    if (x < 0 || x > width) continue;
    ctx.fillStyle = levelStyle(line.kind, levels);
    ctx.fillRect(x, 0, 1, height);
  }
}
