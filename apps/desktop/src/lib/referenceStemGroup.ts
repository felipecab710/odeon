/**
 * Auto-create or refresh the bus group that links separated reference stems.
 */
import type { OdeonTrack } from "@odeon/shared";
import { useTrackGroupStore } from "../stores/trackGroupStore";

export const REFERENCE_STEMS_GROUP_NAME = "Reference Stems";

const STEM_ORDER = ["drums", "bass", "vocals", "other", "music", "fx", "unknown"] as const;

export function orderedStemTrackIds(stemTracks: OdeonTrack[]): string[] {
  const byType = new Map(stemTracks.map((t) => [t.stem_type, t.id]));
  const ordered: string[] = [];
  for (const type of STEM_ORDER) {
    const id = byType.get(type);
    if (id) ordered.push(id);
  }
  return ordered;
}

/** Create or update the reference-stems bus group after Demucs separation. */
export function ensureReferenceStemBusGroup(stemTracks: OdeonTrack[]): string {
  const trackIds = orderedStemTrackIds(stemTracks);
  if (!trackIds.length) return "";

  const { groups, createGroup, updateGroup } = useTrackGroupStore.getState();
  const existing = groups.find((g) => g.name === REFERENCE_STEMS_GROUP_NAME);

  if (existing) {
    updateGroup(existing.id, { trackIds, name: REFERENCE_STEMS_GROUP_NAME });
    return existing.id;
  }

  return createGroup(trackIds, { name: REFERENCE_STEMS_GROUP_NAME });
}
