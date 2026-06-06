/**
 * Track/bus group store — Pro Tools–style linked track groups.
 */
import { create } from "zustand";
import {
  DEFAULT_GROUP_SHARING,
  nextGroupColor,
  nextGroupName,
  type TrackBusGroup,
  type TrackGroupSharing,
} from "../lib/trackGroup";
import { useEngineStore } from "./engineStore";
import { useProjectStore } from "./projectStore";
import { useSelectionStore } from "./selectionStore";
import { engineClient } from "../lib/engineClient";
let groupIdCounter = 0;
function newGroupId() {
  return `grp-${++groupIdCounter}-${Date.now().toString(36)}`;
}

/** Pixel-space drag rect while drawing; snaps to channels on mouseup. */
export interface GroupDragPreview {
  axis: "x" | "y";
  start: number;
  current: number;
}

interface TrackGroupState {
  groups: TrackBusGroup[];
  editingGroupId: string | null;
  dragPreview: GroupDragPreview | null;

  createGroup: (trackIds: string[], opts?: Partial<Pick<TrackBusGroup, "name" | "color">>) => string;
  updateGroup: (groupId: string, patch: Partial<Omit<TrackBusGroup, "id">>) => void;
  deleteGroup: (groupId: string) => void;
  removeTrackFromAllGroups: (trackId: string) => void;
  getGroupForTrack: (trackId: string) => TrackBusGroup | null;
  openEditDialog: (groupId: string) => void;
  closeEditDialog: () => void;
  setDragPreview: (preview: GroupDragPreview | null) => void;

  /** Apply a linked control change to all members when sharing is enabled. */
  applyGroupedMute: (sourceTrackId: string, muted: boolean) => void;
  applyGroupedSolo: (sourceTrackId: string, soloed: boolean) => void;
  applyGroupedGain: (sourceTrackId: string, newDb: number, prevDb: number) => void;
  applyGroupedSelection: (sourceTrackId: string) => void;
  /** Set clip/bus colour — propagates to group members when colour sharing is on. */
  applyClipColor: (sourceTrackId: string, color: string) => void;
  hydrateFromProject: (groups: TrackBusGroup[]) => void;
}

function persistGroups() {
  void useProjectStore.getState().saveTrackGroups();
}

function stripTrackFromOthers(groups: TrackBusGroup[], trackIds: string[], keepGroupId?: string) {
  const idSet = new Set(trackIds);
  return groups.map((g) => {
    if (g.id === keepGroupId) return g;
    const next = g.trackIds.filter((id) => !idSet.has(id));
    return next.length === g.trackIds.length ? g : { ...g, trackIds: next };
  });
}

function activeGroupForTrack(groups: TrackBusGroup[], trackId: string): TrackBusGroup | null {
  return groups.find((g) => g.active && g.trackIds.includes(trackId)) ?? null;
}

function syncClipColorToGroupTracks(group: TrackBusGroup, color: string) {
  if (!group.active || !group.sharing.color) return;
  const { setTrackColor } = useProjectStore.getState();
  for (const id of group.trackIds) setTrackColor(id, color);
}

export const useTrackGroupStore = create<TrackGroupState>((set, get) => ({
  groups: [],
  editingGroupId: null,
  dragPreview: null,

  createGroup: (trackIds, opts) => {
    const unique = [...new Set(trackIds)];
    if (!unique.length) return "";

    const { groups } = get();
    const id = newGroupId();
    const name = opts?.name ?? nextGroupName(groups.map((g) => g.name));
    const color = opts?.color ?? nextGroupColor(groups.length);

    const cleaned = stripTrackFromOthers(groups, unique);
    const group: TrackBusGroup = {
      id,
      name,
      color,
      active: true,
      trackIds: unique,
      sharing: { ...DEFAULT_GROUP_SHARING },
    };

    set({ groups: [...cleaned.filter((g) => g.trackIds.length > 0), group] });
    persistGroups();
    return id;
  },

  updateGroup: (groupId, patch) => {
    set((s) => {
      let groups = s.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g));

      if (patch.trackIds) {
        const unique = [...new Set(patch.trackIds)];
        groups = stripTrackFromOthers(groups, unique, groupId).map((g) =>
          g.id === groupId ? { ...g, trackIds: unique } : g
        );
      }

      return { groups: groups.filter((g) => g.trackIds.length > 0) };
    });

    const updated = get().groups.find((g) => g.id === groupId);
    if (updated && patch.color !== undefined) {
      syncClipColorToGroupTracks(updated, patch.color);
    }
    if (updated && patch.trackIds) {
      syncClipColorToGroupTracks(updated, updated.color);
    }

    persistGroups();
  },

  deleteGroup: (groupId) => {
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== groupId),
      editingGroupId: s.editingGroupId === groupId ? null : s.editingGroupId,
    }));
    persistGroups();
  },

  removeTrackFromAllGroups: (trackId) => {
    set((s) => ({
      groups: s.groups
        .map((g) => ({ ...g, trackIds: g.trackIds.filter((id) => id !== trackId) }))
        .filter((g) => g.trackIds.length > 0),
    }));
    persistGroups();
  },

  hydrateFromProject: (groups) => set({
    groups,
    editingGroupId: null,
    dragPreview: null,
  }),

  getGroupForTrack: (trackId) => get().groups.find((g) => g.trackIds.includes(trackId)) ?? null,

  openEditDialog: (groupId) => set({ editingGroupId: groupId }),
  closeEditDialog: () => set({ editingGroupId: null }),
  setDragPreview: (preview) => set({ dragPreview: preview }),

  applyGroupedMute: (sourceTrackId, muted) => {
    const group = activeGroupForTrack(get().groups, sourceTrackId);
    if (!group?.sharing.muting) return;

    const { setTrackState } = useEngineStore.getState();
    for (const id of group.trackIds) {
      if (id === sourceTrackId) continue;
      setTrackState(id, { muted });
      engineClient.muteTrack(id, muted).catch(() => {});
    }
  },

  applyGroupedSolo: (sourceTrackId, soloed) => {
    const group = activeGroupForTrack(get().groups, sourceTrackId);
    if (!group?.sharing.soloing) return;

    const { setTrackState } = useEngineStore.getState();
    for (const id of group.trackIds) {
      if (id === sourceTrackId) continue;
      setTrackState(id, { soloed });
      engineClient.soloTrack(id, soloed).catch(() => {});
    }
  },

  applyGroupedGain: (sourceTrackId, newDb, prevDb) => {
    const group = activeGroupForTrack(get().groups, sourceTrackId);
    if (!group?.sharing.gain) return;

    const { setTrackState, trackStates } = useEngineStore.getState();
    const delta = group.sharing.gainRelative ? newDb - prevDb : 0;
    const absolute = group.sharing.gainRelative ? null : newDb;

    for (const id of group.trackIds) {
      if (id === sourceTrackId) continue;
      const cur = trackStates[id]?.volumeDb ?? 0;
      const next = absolute !== null ? absolute : Math.max(-60, Math.min(6, cur + delta));
      setTrackState(id, { volumeDb: next });
      engineClient.setTrackVolume(id, next).catch(() => {});
    }
  },

  applyGroupedSelection: (sourceTrackId) => {
    const group = activeGroupForTrack(get().groups, sourceTrackId);
    if (!group?.sharing.selection) return;
    // Primary selection stays on source; extend later with multi-select.
    useSelectionStore.getState().selectTrack(sourceTrackId);
  },

  applyClipColor: (sourceTrackId, color) => {
    const group = activeGroupForTrack(get().groups, sourceTrackId);
    if (group?.sharing.color) {
      get().updateGroup(group.id, { color });
      return;
    }
    useProjectStore.getState().setTrackColor(sourceTrackId, color);
  },
}));

export type { TrackGroupSharing };
