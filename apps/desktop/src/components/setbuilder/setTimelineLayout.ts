/**
 * Layout math for Studio-style set arrangement timeline.
 */
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { snapToVisibleBeatGrid } from "../../lib/setBeatGrid";

export const HEADER_H = 18;
export const AUTO_H = 20;
export const WAVE_H = 44;
export const LANE_GAP = 8;
export const LANE_HEIGHT = 110;
export const LANE_STRIP_W = 148;
export const CFADER_H = 36;
/** Ableton beat-time ruler (top black strip) — bars / beats / sixteenths. */
export const BEAT_RULER_H = 22;
/** Ableton time ruler (bottom black strip) — minutes : seconds. */
export const TIME_RULER_H = 20;
/** Top ruler height (alias for beat-time ruler). */
export const RULER_H = BEAT_RULER_H;
/** Ableton arrangement ruler background. */
export const ABLETON_RULER_BG = "#0a0a0a";
export const MINIMAP_H = 28;
export const MINIMAP_ROW_H = 14;
export const MINIMAP_H_MAX = 88;

/** Overview bar height scales with deck count (Ableton-style stacked lanes). */
export function minimapHeight(laneCount: number): number {
  if (laneCount <= 0) return MINIMAP_H;
  return Math.min(MINIMAP_H_MAX, Math.max(MINIMAP_H, laneCount * MINIMAP_ROW_H + 2));
}

/** DJ.Studio palette */
export const STUDIO_BG = "#2a2a2a";
export const STUDIO_BG_DEEP = "#1e1e1e";
export const STUDIO_SIDEBAR = "#181818";
export const STUDIO_RULER = "#222222";
export const STUDIO_GRID = "#333333";
export const DEFAULT_OVERLAP_BARS = 16;
export const DEFAULT_PX_PER_SEC = 3.2;
/** @deprecated Use DEFAULT_PX_PER_SEC or dynamic zoom pxPerSec */
export const PX_PER_SEC = DEFAULT_PX_PER_SEC;
export const MIN_PX_PER_SEC = 0.35;
/** Absolute zoom ceiling — clip-edit depth, not sample-level. */
export const MAX_PX_PER_SEC = 256;
/** At max zoom, ~this many seconds fit in the viewport (Ableton clip-edit feel). */
export const ABLETON_CLIP_EDIT_MIN_SEC = 10;

/** Viewport-aware max px/sec — caps pinch so ~8–12 s stay visible at full zoom. */
export function maxPxPerSecForViewport(viewportWidth: number): number {
  const w = Math.max(200, viewportWidth);
  const clipEditCap = w / ABLETON_CLIP_EDIT_MIN_SEC;
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC + 0.01, clipEditCap));
}

export interface LaneLayout {
  card: SetCard;
  entry: CatalogEntry;
  index: number;
  startSec: number;
  durationSec: number;
  endSec: number;
  leftPx: number;
  widthPx: number;
  overlapSec: number;
  laneY: number;
}

export interface TransitionRegion {
  index: number;
  fromEntryId: string;
  toEntryId: string;
  startSec: number;
  endSec: number;
  leftPx: number;
  widthPx: number;
  laneAY: number;
  laneBY: number;
}

export function barDurationSec(bpm: number): number {
  return (60 / (bpm || 128)) * 4;
}

export function computeSetLayout(
  sorted: SetCard[],
  entryMap: Map<string, CatalogEntry>,
  overlapBars = DEFAULT_OVERLAP_BARS,
  pxPerSec = DEFAULT_PX_PER_SEC,
): { lanes: LaneLayout[]; transitions: TransitionRegion[]; totalSec: number; totalWidthPx: number } {
  const lanes: LaneLayout[] = [];
  const transitions: TransitionRegion[] = [];
  let cursor = 0;

  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i];
    const entry = entryMap.get(card.entryId);
    if (!entry) continue;

    const fullDur = entry.duration_seconds ?? 240;
    const bpm = entry.bpm ?? 128;
    const minDur = barDurationSec(bpm) * 4;
    const dur = card.timelineDurationSec != null
      ? Math.min(fullDur, Math.max(minDur, card.timelineDurationSec))
      : fullDur;
    const overlapSec = i === 0 ? 0 : barDurationSec(bpm) * overlapBars;

    const autoStart = i === 0 ? 0 : Math.max(0, cursor - overlapSec);
    const startSec = card.timelineStartSec != null
      ? Math.max(0, card.timelineStartSec)
      : autoStart;
    const endSec = startSec + dur;

    lanes.push({
      card, entry, index: i,
      startSec, durationSec: dur, endSec,
      leftPx: startSec * pxPerSec,
      widthPx: dur * pxPerSec,
      overlapSec,
      laneY: i * LANE_HEIGHT,
    });

    if (i > 0) {
      const prev = lanes[i - 1];
      const tStart = startSec;
      const tEnd = prev.endSec;
      transitions.push({
        index: i - 1,
        fromEntryId: prev.card.entryId,
        toEntryId: card.entryId,
        startSec: tStart,
        endSec: tEnd,
        leftPx: tStart * pxPerSec,
        widthPx: (tEnd - tStart) * pxPerSec,
        laneAY: prev.laneY,
        laneBY: i * LANE_HEIGHT,
      });
    }

    cursor = Math.max(cursor, endSec);
  }

  const totalSec = lanes.length ? Math.max(...lanes.map(l => l.endSec)) : 0;
  return { lanes, transitions, totalSec, totalWidthPx: totalSec * pxPerSec };
}

/** Ruler mark spacing that stays readable at any zoom level. */
export function rulerMarkInterval(pxPerSec: number): number {
  const targetPx = 72;
  for (const sec of [5, 10, 15, 30, 60, 120, 300, 600]) {
    if (sec * pxPerSec >= targetPx) return sec;
  }
  return 600;
}

export function clampPxPerSec(px: number, viewportWidth?: number): number {
  const max = viewportWidth != null ? maxPxPerSecForViewport(viewportWidth) : MAX_PX_PER_SEC;
  return Math.max(MIN_PX_PER_SEC, Math.min(max, px));
}

export function snapToBeat(sec: number, bpm: number, pps?: number): number {
  if (pps != null && pps > 0) {
    return snapToVisibleBeatGrid(sec, bpm, pps);
  }
  const beatDur = 60 / (bpm || 128);
  return Math.max(0, Math.round(sec / beatDur) * beatDur);
}

export function formatTimeline(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
