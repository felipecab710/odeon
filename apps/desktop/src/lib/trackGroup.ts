/** Pro Tools–style track/bus group model. */

import { BUS_COLOR_PALETTE } from "./clipColorPresets";

export interface TrackGroupSharing {
  gain: boolean;
  gainRelative: boolean;
  muting: boolean;
  soloing: boolean;
  recordEnable: boolean;
  selection: boolean;
  activeState: boolean;
  color: boolean;
  monitoring: boolean;
}

export interface TrackBusGroup {
  id: string;
  name: string;
  color: string;
  active: boolean;
  trackIds: string[];
  sharing: TrackGroupSharing;
}

export const DEFAULT_GROUP_SHARING: TrackGroupSharing = {
  gain: true,
  gainRelative: true,
  muting: true,
  soloing: true,
  recordEnable: true,
  selection: true,
  activeState: true,
  color: true,
  monitoring: true,
};

/** Pro Tools clip/bus colour presets (teal, steel, royal, purple). */
export const GROUP_COLOR_PALETTE = BUS_COLOR_PALETTE;

const GROUP_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function nextGroupName(existing: string[]): string {
  const used = new Set(existing.map((n) => n.toUpperCase()));
  for (const ch of GROUP_NAMES) {
    if (!used.has(ch)) return ch;
  }
  return `G${existing.length + 1}`;
}

export function nextGroupColor(index: number): string {
  return GROUP_COLOR_PALETTE[index % GROUP_COLOR_PALETTE.length];
}
