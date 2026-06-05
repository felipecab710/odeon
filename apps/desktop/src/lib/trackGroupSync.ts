/**
 * Convert between desktop track-group store shape and API / shared types.
 */
import type { TrackBusGroup as ApiTrackBusGroup, TrackGroupSharing as ApiSharing } from "@odeon/shared";
import type { TrackBusGroup, TrackGroupSharing } from "./trackGroup";

function sharingToApi(s: TrackGroupSharing): ApiSharing {
  return {
    gain: s.gain,
    gain_relative: s.gainRelative,
    muting: s.muting,
    soloing: s.soloing,
    record_enable: s.recordEnable,
    selection: s.selection,
    active_state: s.activeState,
    color: s.color,
    monitoring: s.monitoring,
  };
}

function sharingFromApi(s: ApiSharing): TrackGroupSharing {
  return {
    gain: s.gain,
    gainRelative: s.gain_relative,
    muting: s.muting,
    soloing: s.soloing,
    recordEnable: s.record_enable,
    selection: s.selection,
    activeState: s.active_state,
    color: s.color,
    monitoring: s.monitoring,
  };
}

export function trackGroupsToApi(groups: TrackBusGroup[]): ApiTrackBusGroup[] {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    active: g.active,
    track_ids: g.trackIds,
    sharing: sharingToApi(g.sharing),
  }));
}

export function trackGroupsFromApi(
  groups: ApiTrackBusGroup[] | undefined,
  validTrackIds: Set<string>,
): TrackBusGroup[] {
  if (!groups?.length) return [];

  return groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      active: g.active,
      trackIds: g.track_ids.filter((id) => validTrackIds.has(id)),
      sharing: sharingFromApi(g.sharing),
    }))
    .filter((g) => g.trackIds.length > 0);
}
