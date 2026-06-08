/**
 * Studio set automation — global enable, per-track lanes, keyframe curves.
 */
import { create } from "zustand";
import {
  type AutomationKeyframe,
  upsertKeyframe,
  removeKeyframeNear,
  sortKeyframes,
} from "../lib/automationMath";
import { captureUndoState } from "./undoStore";

export type AutomationCategory = "mixer" | "eq" | "filter";
export type AutomationEditMode = "draw" | "record";

export type AutomationParam =
  | "trackVolume"
  | "low"
  | "mid"
  | "high"
  | "filter"
  | "crossfader";

export interface AutomationParamDef {
  category: AutomationCategory;
  param: AutomationParam;
  label: string;
}

export const AUTOMATION_PARAMS: AutomationParamDef[] = [
  { category: "mixer", param: "trackVolume", label: "Track Volume" },
  { category: "eq", param: "low", label: "Low" },
  { category: "eq", param: "mid", label: "Mid" },
  { category: "eq", param: "high", label: "High" },
  { category: "filter", param: "filter", label: "Filter" },
  { category: "mixer", param: "crossfader", label: "Crossfader" },
];

export interface TrackAutomationState {
  expanded: boolean;
  lanes: AutomationParam[];
  activeLane: AutomationParam;
  /** Record mode — capture knob/fader moves while playing. */
  armed: boolean;
  /** Drawn or recorded breakpoints per parameter. */
  curves: Partial<Record<AutomationParam, AutomationKeyframe[]>>;
}

const DEFAULT_TRACK_STATE: TrackAutomationState = {
  expanded: false,
  lanes: ["trackVolume"],
  activeLane: "trackVolume",
  armed: false,
  curves: {},
};

function defaultTrackState(): TrackAutomationState {
  return {
    ...DEFAULT_TRACK_STATE,
    lanes: [...DEFAULT_TRACK_STATE.lanes],
    curves: {},
  };
}

interface StudioAutomationStore {
  globalEnabled: boolean;
  editMode: AutomationEditMode;
  isRecording: boolean;
  tracks: Record<number, TrackAutomationState>;

  setGlobalEnabled: (v: boolean) => void;
  setEditMode: (mode: AutomationEditMode) => void;
  setRecording: (v: boolean) => void;
  toggleTrackExpanded: (laneIndex: number) => void;
  setTrackExpanded: (laneIndex: number, expanded: boolean) => void;
  setActiveLane: (laneIndex: number, param: AutomationParam) => void;
  setTrackArmed: (laneIndex: number, armed: boolean) => void;
  addLane: (laneIndex: number, param: AutomationParam) => void;
  removeLane: (laneIndex: number, param: AutomationParam) => void;
  setKeyframes: (laneIndex: number, param: AutomationParam, kfs: AutomationKeyframe[]) => void;
  upsertKeyframe: (laneIndex: number, param: AutomationParam, timeSec: number, valueNorm: number) => void;
  removeKeyframeNear: (laneIndex: number, param: AutomationParam, timeSec: number) => void;
  clearCurve: (laneIndex: number, param: AutomationParam) => void;
  getTrack: (laneIndex: number) => TrackAutomationState;
  reset: () => void;
}

export const useStudioAutomationStore = create<StudioAutomationStore>((set, get) => ({
  globalEnabled: true,
  editMode: "draw",
  isRecording: false,
  tracks: {},

  setGlobalEnabled: (v) => set({ globalEnabled: v }),

  setEditMode: (mode) => set({ editMode: mode, isRecording: false }),

  setRecording: (v) => set({ isRecording: v }),

  toggleTrackExpanded: (laneIndex) => {
    const cur = get().getTrack(laneIndex);
    get().setTrackExpanded(laneIndex, !cur.expanded);
  },

  setTrackExpanded: (laneIndex, expanded) =>
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: { ...get().getTrack(laneIndex), expanded },
      },
    })),

  setActiveLane: (laneIndex, param) =>
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: { ...get().getTrack(laneIndex), activeLane: param },
      },
    })),

  setTrackArmed: (laneIndex, armed) =>
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: { ...get().getTrack(laneIndex), armed },
      },
    })),

  addLane: (laneIndex, param) => {
    const cur = get().getTrack(laneIndex);
    if (cur.lanes.includes(param)) return;
    captureUndoState();
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: { ...cur, lanes: [...cur.lanes, param] },
      },
    }));
  },

  removeLane: (laneIndex, param) => {
    const cur = get().getTrack(laneIndex);
    if (cur.lanes.length <= 1) return;
    captureUndoState();
    const lanes = cur.lanes.filter(p => p !== param);
    const curves = { ...cur.curves };
    delete curves[param];
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: {
          ...cur,
          lanes,
          curves,
          activeLane: cur.activeLane === param ? lanes[0] : cur.activeLane,
        },
      },
    }));
  },

  setKeyframes: (laneIndex, param, kfs) => {
    const cur = get().getTrack(laneIndex);
    captureUndoState();
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: {
          ...cur,
          curves: { ...cur.curves, [param]: sortKeyframes(kfs) },
        },
      },
    }));
  },

  upsertKeyframe: (laneIndex, param, timeSec, valueNorm) => {
    const cur = get().getTrack(laneIndex);
    const existing = cur.curves[param] ?? [];
    const next = upsertKeyframe(existing, timeSec, valueNorm);
    get().setKeyframes(laneIndex, param, next);
  },

  removeKeyframeNear: (laneIndex, param, timeSec) => {
    const cur = get().getTrack(laneIndex);
    const existing = cur.curves[param] ?? [];
    const next = removeKeyframeNear(existing, timeSec);
    get().setKeyframes(laneIndex, param, next);
  },

  clearCurve: (laneIndex, param) => {
    const cur = get().getTrack(laneIndex);
    captureUndoState();
    const curves = { ...cur.curves };
    delete curves[param];
    set(s => ({
      tracks: {
        ...s.tracks,
        [laneIndex]: { ...cur, curves },
      },
    }));
  },

  getTrack: (laneIndex) => get().tracks[laneIndex] ?? DEFAULT_TRACK_STATE,

  reset: () => set({
    globalEnabled: true,
    editMode: "draw",
    isRecording: false,
    tracks: {},
  }),
}));

export const AUTO_PARAM_ROW_H = 44;
export const AUTO_COLLAPSED_H = 20;
export const AUTO_PANEL_H = 40;

export function trackAutomationHeight(laneIndex: number): number {
  const t = useStudioAutomationStore.getState().tracks[laneIndex];
  if (!t?.expanded) return 0;
  return t.lanes.length * AUTO_PARAM_ROW_H;
}
