import type { CatalogMarker } from "@odeon/shared";

/** Map Select catalog hot_cue markers to CDJ deck hot-cue slot arrays. */
export function markersToHotCueState(markers: CatalogMarker[]): {
  hotCueSlots: boolean[];
  hotCueTimes: (number | null)[];
} {
  const hotCueSlots = Array(8).fill(false) as boolean[];
  const hotCueTimes = Array(8).fill(null) as (number | null)[];
  for (const m of markers) {
    if (m.type !== "hot_cue" || !m.label) continue;
    const idx = parseInt(m.label, 10) - 1;
    if (idx >= 0 && idx < 8) {
      hotCueSlots[idx] = true;
      hotCueTimes[idx] = m.time_seconds;
    }
  }
  return { hotCueSlots, hotCueTimes };
}

/** Prefer booth overrides; fall back to catalog when slots are still empty. */
export function resolveDeckHotCues(
  entryId: string,
  prevDeck:
    | { entryId: string | null; hotCueSlots: boolean[]; hotCueTimes: (number | null)[] }
    | undefined,
  catalogMarkers: CatalogMarker[] | undefined,
): { hotCueSlots: boolean[]; hotCueTimes: (number | null)[] } {
  const empty = {
    hotCueSlots: Array(8).fill(false) as boolean[],
    hotCueTimes: Array(8).fill(null) as (number | null)[],
  };
  const fromCatalog = catalogMarkers?.length
    ? markersToHotCueState(catalogMarkers)
    : null;
  const prevHasHotCues =
    prevDeck?.entryId === entryId && prevDeck.hotCueSlots.some(Boolean);

  if (prevHasHotCues) {
    return {
      hotCueSlots: prevDeck!.hotCueSlots,
      hotCueTimes: prevDeck!.hotCueTimes,
    };
  }
  if (fromCatalog?.hotCueSlots.some(Boolean)) return fromCatalog;
  if (prevDeck?.entryId === entryId) {
    return {
      hotCueSlots: prevDeck.hotCueSlots,
      hotCueTimes: prevDeck.hotCueTimes,
    };
  }
  return empty;
}
