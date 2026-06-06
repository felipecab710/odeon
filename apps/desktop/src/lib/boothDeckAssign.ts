/**
 * Dynamic deck assignment — maps 4 CDJ slots to set lanes based on playhead.
 */
import type { LaneLayout, TransitionRegion } from "../components/setbuilder/setTimelineLayout";

/** deckSlot 0-3 → lane index, or -1 if empty */
export function assignDeckLanes(
  lanes: LaneLayout[],
  playheadSec: number,
  activeTrans: { transition: TransitionRegion; t: number } | null,
): number[] {
  const slots = [-1, -1, -1, -1];
  if (lanes.length === 0) return slots;

  if (activeTrans) {
    const fromIdx = lanes.findIndex(l => l.card.entryId === activeTrans.transition.fromEntryId);
    const toIdx = lanes.findIndex(l => l.card.entryId === activeTrans.transition.toEntryId);
    if (fromIdx >= 0) slots[0] = fromIdx;
    if (toIdx >= 0) slots[1] = toIdx;

    let slot = 2;
    for (let i = 0; i < lanes.length && slot < 4; i++) {
      if (i === fromIdx || i === toIdx) continue;
      if (lanes[i].endSec > playheadSec - 30) {
        slots[slot++] = i;
      }
    }
    return slots;
  }

  // Find primary active lane
  let center = lanes.findIndex(l => playheadSec >= l.startSec && playheadSec < l.endSec);
  if (center < 0) {
    center = lanes.findIndex(l => l.startSec > playheadSec);
    if (center < 0) center = lanes.length - 1;
  }

  // Window of up to 4 lanes centered on current
  const start = Math.max(0, Math.min(center - 1, lanes.length - 4));
  for (let d = 0; d < 4; d++) {
    const idx = start + d;
    if (idx < lanes.length) slots[d] = idx;
  }
  return slots;
}
