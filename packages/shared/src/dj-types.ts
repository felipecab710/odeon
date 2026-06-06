/**
 * DJ deck/mixer types — aligned with Mixxx 2.5 control model.
 * Used by Research, Booth twin, Select PlayerStrip, and future engine RPC.
 *
 * Reference: mixxx-2.5/src/engine/ + src/mixer/
 */

/** Max decks — matches Mixxx kMaxNumberOfDecks and Pioneer DJM-A9 */
export const MAX_DECKS = 4;

/** Crossfader orientation — Mixxx EngineChannel::LEFT | CENTER | RIGHT */
export type DeckOrientation = "A" | "THRU" | "B";

/** Mixxx Syncable mode */
export type DeckSyncMode = "off" | "leader" | "follower";

/** Mixxx SoundManager output paths */
export type DjOutputBus = "main" | "headphones" | "booth";

export interface DeckHotcue {
  slot: number;          // 0-7 (Mixxx uses up to 36; UI shows 8)
  timeSeconds: number;
  label?: string;
  color?: string;
}

export interface DeckLoop {
  inSeconds: number | null;
  outSeconds: number | null;
  active: boolean;
}

/** Per-deck state — mirrors Mixxx EngineBuffer + controls */
export interface DjDeckState {
  deckIndex: number;
  entryId: string | null;
  filePath: string | null;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  /** Local position within loaded track */
  positionSeconds: number;
  durationSeconds: number;
  rate: number;          // 1.0 = normal (Mixxx rate ratio)
  pitchPercent: number;  // UI display
  isPlaying: boolean;
  isLoaded: boolean;
  syncMode: DeckSyncMode;
  hotcues: DeckHotcue[];
  loop: DeckLoop;
  /** Visual — jog wheel angle degrees */
  jogAngle: number;
}

/** Per-channel mixer strip — mirrors Mixxx channel + EQ chain */
export interface DjChannelState {
  channelIndex: number;
  deckIndex: number;
  entryId: string | null;
  trimDb: number;
  highDb: number;
  midDb: number;
  lowDb: number;
  filter: number;
  faderDb: number;
  orientation: DeckOrientation;
  cue: boolean;          // PFL — routes to headphones bus (not solo)
  solo: boolean;
  mute: boolean;
  meterLeftDb: number;
  meterRightDb: number;
}

/** Mixer global — mirrors Mixxx EngineMixer */
export interface DjMixerState {
  crossfaderPosition: number;  // 0 = full A, 1 = full B
  masterDb: number;
  headphoneLevel: number;
  headphoneMix: number;        // 0 = all cue, 1 = all main (Mixxx head_mix)
  boothLevel: number;
  masterMeterLeftDb: number;
  masterMeterRightDb: number;
  beatFxOn: boolean;
  beatFxName: string;
  beatFxLevel: number;
  soundColorFx: string;
  soundColorParam: number;
  tapBpm: number;
}

/** Full booth snapshot — Mixxx PlayerManager + EngineMixer */
export interface DjBoothSnapshot {
  decks: DjDeckState[];
  channels: DjChannelState[];
  mixer: DjMixerState;
  playheadSeconds: number;
  isPlaying: boolean;
  activeTransitionIndex: number | null;
  transitionStrategy: string | null;
}

/** Future engine RPC methods (Phase B) */
export type DjEngineRpcMethod =
  | "createDjSession"
  | "loadDeck"
  | "unloadDeck"
  | "deckPlay"
  | "deckPause"
  | "deckSeek"
  | "deckSetRate"
  | "deckSetHotcue"
  | "deckJumpHotcue"
  | "deckClearHotcue"
  | "deckSetLoop"
  | "setDeckEq"
  | "setDeckFilter"
  | "setDeckOrientation"
  | "setCrossfader"
  | "setPflDeck"
  | "setHeadMix"
  | "setBoothLevel"
  | "setDeckSyncMode";
