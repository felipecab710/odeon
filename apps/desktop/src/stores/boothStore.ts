/**
 * Pioneer booth digital twin — unified state for 4× CDJ-3000 + DJM-A9.
 *
 * Control-bus equivalent of Mixxx ControlObject + PlayerManager state.
 * Audio output via odeon-engine multi-route session (not HTML audio).
 * See docs/ODEON_DJ_RESEARCH.md and packages/shared/src/dj-types.ts
 */
import { create } from "zustand";
import type { CfAssign } from "../lib/deckMixEngine";

export type BoothMode = "interactive" | "simulation";

export interface CDJDeckState {
  deckIndex: number;
  entryId: string | null;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  isLoaded: boolean;
  /** Jog wheel rotation degrees (visual). */
  jogAngle: number;
  pitchPercent: number;
  playLit: boolean;
  cueLit: boolean;
  hotCueSlots: boolean[];
  hotCueTimes: (number | null)[];
  loopActive: boolean;
  loopInSec: number;
  loopOutSec: number;
}

export interface DJMChannelState {
  channelIndex: number;
  entryId: string | null;
  deckLabel: string;
  color: string;
  trimDb: number;
  high: number;
  mid: number;
  low: number;
  filter: number;
  faderDb: number;
  /** Effective fader for meters/engine — silent when lane is off-timeline. */
  signalFaderDb: number;
  cfAssign: CfAssign;
  cue: boolean;
  solo: boolean;
  mute: boolean;
  meterL: number;
  meterR: number;
  beatFxActive: boolean;
}

export interface DJMMixerState {
  crossfaderPos: number;
  masterDb: number;
  masterMeterL: number;
  masterMeterR: number;
  beatFxOn: boolean;
  beatFxName: string;
  beatFxLevel: number;
  soundColorFx: string;
  soundColorParam: number;
  headphoneLevel: number;
  boothLevel: number;
  tapBpm: number;
}

export interface BoothSnapshot {
  mode: BoothMode;
  simulationActive: boolean;
  currentTransitionIndex: number | null;
  transitionStrategy: string | null;
  mossReason: string | null;
  playheadSec: number;
  decks: CDJDeckState[];
  channels: DJMChannelState[];
  mixer: DJMMixerState;
}

const DECK_COLORS = ["#c8e650", "#b39ddb", "#4fc3f7", "#ffab40"];

function defaultDeck(i: number): CDJDeckState {
  return {
    deckIndex: i,
    entryId: null,
    title: "No Track",
    artist: "",
    bpm: 128,
    key: "—",
    positionSec: 0,
    durationSec: 0,
    isPlaying: false,
    isLoaded: false,
    jogAngle: 0,
    pitchPercent: 0,
    playLit: false,
    cueLit: false,
    hotCueSlots: Array(8).fill(false),
    hotCueTimes: Array(8).fill(null),
    loopActive: false,
    loopInSec: 0,
    loopOutSec: 0,
  };
}

function defaultChannel(i: number): DJMChannelState {
  return {
    channelIndex: i,
    entryId: null,
    deckLabel: `CH ${i + 1}`,
    color: DECK_COLORS[i],
    trimDb: 0,
    high: 0,
    mid: 0,
    low: 0,
    filter: 0,
    faderDb: 0,
    signalFaderDb: -60,
    cfAssign: "THRU",
    cue: false,
    solo: false,
    mute: false,
    meterL: -90,
    meterR: -90,
    beatFxActive: false,
  };
}

const DEFAULT_MIXER: DJMMixerState = {
  crossfaderPos: 0.5,
  masterDb: 0,
  masterMeterL: -90,
  masterMeterR: -90,
  beatFxOn: false,
  beatFxName: "DELAY",
  beatFxLevel: 0.5,
  soundColorFx: "FILTER",
  soundColorParam: 0,
  headphoneLevel: 0.7,
  boothLevel: 0.6,
  tapBpm: 128,
};

interface BoothStoreState extends BoothSnapshot {
  /** In Drive mode, user-edited channels persist across ticks. */
  interactiveChannels: DJMChannelState[] | null;
  setMode: (mode: BoothMode) => void;
  setSnapshot: (snap: Partial<BoothSnapshot>) => void;
  setInteractiveChannels: (channels: DJMChannelState[] | null) => void;
  patchChannel: (index: number, patch: Partial<DJMChannelState>) => void;
  patchMixer: (patch: Partial<DJMMixerState>) => void;
  patchDeck: (index: number, patch: Partial<CDJDeckState>) => void;
  reset: () => void;
}

export const useBoothStore = create<BoothStoreState>((set) => ({
  mode: "simulation",
  simulationActive: false,
  currentTransitionIndex: null,
  transitionStrategy: null,
  mossReason: null,
  interactiveChannels: null,
  playheadSec: 0,
  decks: [0, 1, 2, 3].map(defaultDeck),
  channels: [0, 1, 2, 3].map(defaultChannel),
  mixer: { ...DEFAULT_MIXER },

  setMode: (mode) => set({
    mode,
    interactiveChannels: mode === "interactive" ? null : null,
  }),
  setSnapshot: (snap) => set(snap),
  setInteractiveChannels: (interactiveChannels) => set({ interactiveChannels }),
  patchChannel: (index, patch) => set(s => ({
    channels: s.channels.map((c, i) => i === index ? { ...c, ...patch } : c),
  })),
  patchMixer: (patch) => set(s => ({ mixer: { ...s.mixer, ...patch } })),
  patchDeck: (index, patch) => set(s => ({
    decks: s.decks.map((d, i) => i === index ? { ...d, ...patch } : d),
  })),
  reset: () => set({
    simulationActive: false,
    currentTransitionIndex: null,
    transitionStrategy: null,
    mossReason: null,
    interactiveChannels: null,
    playheadSec: 0,
    decks: [0, 1, 2, 3].map(defaultDeck),
    channels: [0, 1, 2, 3].map(defaultChannel),
    mixer: { ...DEFAULT_MIXER },
  }),
}));

export { DECK_COLORS };
