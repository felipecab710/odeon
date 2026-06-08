/**
 * Unified Odeon route IDs — one graph, multiple UI shells.
 *
 * Studio:     project track IDs (opaque)
 * Set Builder: set:{entryId} + optional set:{entryId}:stem:{type}
 * Select:      deck:{n} (transport) + deck:{n}:stem:{type} (solo group)
 * Stem stacks: stack:{stackId}:{layer} (DAW routes at t=0)
 */
export const SET_PROJECT_ID = "odeon-set-preview";
export const SELECT_PREVIEW_PROJECT = "odeon-select-preview";

export function setTrackId(entryId: string): string {
  return `set:${entryId}`;
}

export function setStemTrackId(entryId: string, stem: string): string {
  return `set:${entryId}:stem:${stem}`;
}

export function setStemStackId(entryId: string): string {
  return `set:${entryId}`;
}

export function deckTrackId(deckIndex: number): string {
  return `deck:${deckIndex}`;
}

export function deckStemTrackId(deckIndex: number, stem: string): string {
  if (stem === "full") return deckTrackId(deckIndex);
  return `${deckTrackId(deckIndex)}:stem:${stem}`;
}

export function stackTrackId(stackId: string, layerId: string): string {
  return `stack:${stackId}:${layerId}`;
}

export function selectStemStackId(entryId: string): string {
  return `select:${entryId}`;
}
