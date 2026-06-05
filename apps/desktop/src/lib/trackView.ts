/** Pro Tools–style track view modes (playlist lane display). */

export type TrackViewMode =
  | "blocks"
  | "playlists"
  | "analysis"
  | "warp"
  | "markers"
  | "transcript"
  | "waveform"
  | "volume"
  | "volume-trim"
  | "lfe"
  | "mute"
  | "pan-left"
  | "pan-right";

export interface TrackViewOption {
  id: TrackViewMode;
  label: string;
  disabled?: boolean;
}

export const TRACK_VIEW_OPTIONS: TrackViewOption[] = [
  { id: "blocks",      label: "blocks" },
  { id: "playlists",   label: "playlists" },
  { id: "analysis",    label: "analysis" },
  { id: "warp",        label: "warp" },
  { id: "markers",     label: "markers" },
  { id: "transcript",  label: "transcript" },
  { id: "waveform",    label: "waveform" },
  { id: "volume",      label: "volume" },
  { id: "volume-trim", label: "volume trim" },
  { id: "lfe",         label: "LFE" },
  { id: "mute",        label: "mute" },
  { id: "pan-left",    label: "pan left" },
  { id: "pan-right",   label: "pan right" },
];

export function trackViewLabel(mode: TrackViewMode): string {
  return TRACK_VIEW_OPTIONS.find((o) => o.id === mode)?.label ?? mode;
}

export function isClipAudioView(mode: TrackViewMode): boolean {
  return mode === "waveform" || mode === "blocks" || mode === "playlists";
}
