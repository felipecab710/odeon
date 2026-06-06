/**
 * Layout math for Studio-style set arrangement timeline.
 */
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";

export const HEADER_H = 18;
export const AUTO_H = 20;
export const WAVE_H = 36;
export const LANE_GAP = 8;
export const LANE_HEIGHT = 110;
export const LANE_STRIP_W = 148;
export const CFADER_H = 36;
export const RULER_H = 24;
export const MINIMAP_H = 20;

/** DJ.Studio palette */
export const STUDIO_BG = "#2a2a2a";
export const STUDIO_BG_DEEP = "#1e1e1e";
export const STUDIO_SIDEBAR = "#181818";
export const STUDIO_RULER = "#222222";
export const STUDIO_GRID = "#333333";
export const DEFAULT_OVERLAP_BARS = 16;
export const PX_PER_SEC = 3.2;

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
): { lanes: LaneLayout[]; transitions: TransitionRegion[]; totalSec: number; totalWidthPx: number } {
  const lanes: LaneLayout[] = [];
  const transitions: TransitionRegion[] = [];
  let cursor = 0;

  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i];
    const entry = entryMap.get(card.entryId);
    if (!entry) continue;

    const dur = entry.duration_seconds ?? 240;
    const bpm = entry.bpm ?? 128;
    const overlapSec = i === 0 ? 0 : barDurationSec(bpm) * overlapBars;

    const startSec = i === 0 ? 0 : Math.max(0, cursor - overlapSec);
    const endSec = startSec + dur;

    lanes.push({
      card, entry, index: i,
      startSec, durationSec: dur, endSec,
      leftPx: startSec * PX_PER_SEC,
      widthPx: dur * PX_PER_SEC,
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
        leftPx: tStart * PX_PER_SEC,
        widthPx: (tEnd - tStart) * PX_PER_SEC,
        laneAY: prev.laneY,
        laneBY: i * LANE_HEIGHT,
      });
    }

    cursor = endSec;
  }

  const totalSec = lanes.length ? lanes[lanes.length - 1].endSec : 0;
  return { lanes, transitions, totalSec, totalWidthPx: totalSec * PX_PER_SEC };
}

export function formatTimeline(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
