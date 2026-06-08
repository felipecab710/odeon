/**
 * Per-deck timeline lane sizes — independent automation + waveform heights.
 */
import { create } from "zustand";
import { HEADER_H, WAVE_H, LANE_HEIGHT } from "../components/setbuilder/setTimelineLayout";
import { trackAutomationHeight } from "./studioAutomationStore";

export const MIN_WAVE_H = 28;
export const MAX_WAVE_H = 240;
export const MIN_AUTO_PANEL_H = 0;
export const MAX_AUTO_PANEL_H = 280;
export const MIN_LANE_TOTAL_H = 72;
export const MAX_LANE_TOTAL_H = 420;

const STORAGE_KEY = "odeon-lane-splits";
const LEGACY_KEY = "odeon-lane-heights";

interface LaneSplit {
  automationH: number;
  waveH: number;
}

function readStored(): Record<number, LaneSplit> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, LaneSplit>;
      const out: Record<number, LaneSplit> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && Number.isFinite(v.automationH) && Number.isFinite(v.waveH)) {
          out[Number(k)] = { automationH: v.automationH, waveH: v.waveH };
        }
      }
      return out;
    }
    // Migrate legacy total-height storage
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return {};
    const totals = JSON.parse(legacy) as Record<string, number>;
    const out: Record<number, LaneSplit> = {};
    for (const [k, total] of Object.entries(totals)) {
      if (!Number.isFinite(total)) continue;
      const idx = Number(k);
      const autoMin = automationContentMin(idx);
      const wave = Math.max(MIN_WAVE_H, total - HEADER_H - autoMin);
      out[idx] = { automationH: autoMin, waveH: wave };
    }
    return out;
  } catch {
    return {};
  }
}

function persist(splits: Record<number, LaneSplit>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(splits));
  } catch { /* ignore */ }
}

/** Minimum automation block height from expand/collapse state. */
export function automationContentMin(laneIndex: number): number {
  return trackAutomationHeight(laneIndex);
}

function defaultSplit(laneIndex: number): LaneSplit {
  const auto = automationContentMin(laneIndex);
  return {
    automationH: auto,
    waveH: Math.max(WAVE_H, LANE_HEIGHT - HEADER_H - auto),
  };
}

function clampSplit(laneIndex: number, split: LaneSplit): LaneSplit {
  const autoMin = automationContentMin(laneIndex);
  // Collapsed decks reserve zero automation space — no grey gap under the waveform.
  let automationH = autoMin > 0
    ? Math.max(autoMin, Math.min(MAX_AUTO_PANEL_H, split.automationH))
    : 0;
  let waveH = Math.max(MIN_WAVE_H, Math.min(MAX_WAVE_H, split.waveH));
  const total = HEADER_H + automationH + waveH;
  if (total > MAX_LANE_TOTAL_H) {
    const excess = total - MAX_LANE_TOTAL_H;
    waveH = Math.max(MIN_WAVE_H, waveH - excess);
  }
  if (total < MIN_LANE_TOTAL_H) {
    waveH += MIN_LANE_TOTAL_H - (HEADER_H + automationH + waveH);
  }
  return { automationH, waveH };
}

interface StudioLaneStore {
  splits: Record<number, LaneSplit>;
  getSplit: (laneIndex: number) => LaneSplit;
  getLaneHeight: (laneIndex: number) => number;
  getAutomationPanelHeight: (laneIndex: number) => number;
  getWaveHeight: (laneIndex: number) => number;
  setSplit: (laneIndex: number, split: LaneSplit) => void;
  /** Drag inner splitter — shift pixels from wave → automation or reverse. */
  nudgeSplit: (laneIndex: number, deltaAutomation: number) => void;
  /** Drag bottom edge — grow/shrink total; keeps automation:wave ratio. */
  setLaneHeight: (laneIndex: number, totalHeight: number) => void;
  reset: () => void;
}

export const useStudioLaneStore = create<StudioLaneStore>((set, get) => ({
  splits: readStored(),

  getSplit: (laneIndex) => {
    const stored = get().splits[laneIndex];
    return clampSplit(laneIndex, stored ?? defaultSplit(laneIndex));
  },

  getLaneHeight: (laneIndex) => {
    const { automationH, waveH } = get().getSplit(laneIndex);
    return HEADER_H + automationH + waveH;
  },

  getAutomationPanelHeight: (laneIndex) => get().getSplit(laneIndex).automationH,

  getWaveHeight: (laneIndex) => get().getSplit(laneIndex).waveH,

  setSplit: (laneIndex, split) => {
    const clamped = clampSplit(laneIndex, split);
    set(s => {
      const splits = { ...s.splits, [laneIndex]: clamped };
      persist(splits);
      return { splits };
    });
  },

  nudgeSplit: (laneIndex, deltaAutomation) => {
    const cur = get().getSplit(laneIndex);
    get().setSplit(laneIndex, {
      automationH: cur.automationH + deltaAutomation,
      waveH: cur.waveH - deltaAutomation,
    });
  },

  setLaneHeight: (laneIndex, totalHeight) => {
    const cur = get().getSplit(laneIndex);
    const curTotal = HEADER_H + cur.automationH + cur.waveH;
    const delta = totalHeight - curTotal;
    if (Math.abs(delta) < 0.5) return;
    const content = cur.automationH + cur.waveH;
    const autoRatio = content > 0 ? cur.automationH / content : 0.35;
    get().setSplit(laneIndex, {
      automationH: cur.automationH + delta * autoRatio,
      waveH: cur.waveH + delta * (1 - autoRatio),
    });
  },

  reset: () => {
    persist({});
    set({ splits: {} });
  },
}));

export function computeLaneLayout(laneCount: number): {
  ys: number[];
  heights: number[];
  totalH: number;
} {
  const store = useStudioLaneStore.getState();
  const ys: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (let i = 0; i < laneCount; i++) {
    ys.push(y);
    const h = store.getLaneHeight(i);
    heights.push(h);
    y += h;
  }
  return { ys, heights, totalH: y };
}
