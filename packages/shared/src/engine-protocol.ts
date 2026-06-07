// ─────────────────────────────────────────────
//  Audio Engine JSON-RPC Protocol
//  One JSON object per line on stdin/stdout
// ─────────────────────────────────────────────

// ---- Requests (frontend -> engine) ----

export type EngineRpcMethod =
  | "createSession"
  | "openSession"
  | "saveSession"
  | "disposeSession"
  // back-compat aliases (map to the session methods in the engine):
  | "createProject"
  | "loadProject"
  | "disposeProject"
  | "createTrack"
  | "loadAudioFile"
  | "addClip"
  | "removeTrack"
  | "moveClip"
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "setLoop"
  | "getTransportState"
  | "notifyTracksReady"
  | "setTrackVolume"
  | "setTrackPan"
  | "muteTrack"
  | "soloTrack"
  | "setMasterVolume"
  | "getTrackMeters"
  | "renderMix"
  | "analyze"
  | "listAudioDevices"
  | "getPlaybackEngineSettings"
  | "setPlaybackEngineSettings"
  | "createDjSession"
  | "loadDeck"
  | "unloadDeck"
  | "deckSeek"
  | "deckPlay"
  | "deckPause"
  | "deckSetRate"
  | "getDjState"
  | "setDeckEq"
  | "setDeckFilter"
  | "setDeckChannelMix"
  | "setCrossfader"
  | "setDeckOrientation"
  | "setPflDeck"
  | "deckSetHotcue"
  | "deckJumpHotcue"
  | "deckClearHotcue"
  | "deckSetLoop"
  | "deckSetSyncMode";

export interface EngineRpcRequest {
  id: number;
  method: EngineRpcMethod;
  params: Record<string, unknown>;
}

export interface CreateSessionParams  { projectId: string; projectDir?: string }
export interface OpenSessionParams    { projectId: string; projectDir?: string }
export interface CreateTrackParams    { trackId: string; name: string; role: string; stemType: string }
export interface LoadAudioFileParams  { trackId: string; filePath: string }
export interface AddClipParams        { trackId: string; clipId?: string; filePath: string; startTimeSeconds: number }
export interface RemoveTrackParams    { trackId: string }
export interface SeekParams           { timeSeconds: number }
export interface SetLoopParams        { enabled: boolean; startSeconds: number; endSeconds: number }
export interface SetTrackVolumeParams { trackId: string; volumeDb: number }
export interface SetTrackPanParams    { trackId: string; pan: number }
export interface MuteTrackParams      { trackId: string; muted: boolean }
export interface SoloTrackParams      { trackId: string; soloed: boolean }
export interface SetMasterVolumeParams { volumeDb: number }
export interface MoveClipParams       { trackId: string; clipId: string; newStartTimeSeconds: number }
export interface RenderMixParams      { outputFilePath: string }
export interface AnalyzeParams        { trackId: string }

export interface CreateDjSessionParams { numDecks: number }
export interface LoadDeckParams {
  deckIndex: number;
  filePath: string;
  name: string;
  timelineStartSeconds: number;
}
export interface UnloadDeckParams     { deckIndex: number }
export interface DeckSeekParams {
  deckIndex: number;
  /** Local position inside the loaded track (seconds). */
  localSeconds: number;
}
export interface DeckPlayParams  { deckIndex: number }
export interface DeckPauseParams { deckIndex: number }
export interface DeckSetRateParams    { deckIndex: number; rate: number }

export interface SetDeckEqParams {
  deckIndex: number;
  lowDb: number;
  midDb: number;
  highDb: number;
}

export interface SetDeckFilterParams {
  deckIndex: number;
  filter: number;
}

export interface SetDeckChannelMixParams {
  deckIndex: number;
  trimDb: number;
  faderDb: number;
  lowDb: number;
  midDb: number;
  highDb: number;
  filter: number;
  orientation: string;
  muted: boolean;
  pfl: boolean;
}

export interface SetCrossfaderParams { position: number }
export interface SetDeckOrientationParams { deckIndex: number; orientation: string }
export interface SetPflDeckParams { deckIndex: number; enabled: boolean }

export interface DeckSetHotcueParams {
  deckIndex: number;
  slot: number;
  timeSeconds: number;
}

export interface DeckJumpHotcueParams { deckIndex: number; slot: number }
export interface DeckClearHotcueParams { deckIndex: number; slot: number }

export interface DeckSetLoopParams {
  deckIndex: number;
  enabled: boolean;
  inSeconds: number;
  outSeconds: number;
}

export interface DeckSetSyncModeParams {
  deckIndex: number;
  mode: string;
}

export interface DjDeckHotcueState {
  slot: number;
  timeSeconds: number;
}

export interface DjDeckEngineState {
  deckIndex: number;
  trackId: string;
  loaded: boolean;
  filePath: string;
  timelineStart: number;
  durationSeconds: number;
  localPositionSeconds: number;
  isPlaying: boolean;
  rate: number;
  bpm?: number;
  syncFollower?: boolean;
  loopActive?: boolean;
  loopIn?: number;
  loopOut?: number;
  hotcues?: DjDeckHotcueState[];
}

export interface DjStateResult {
  numDecks: number;
  decks: DjDeckEngineState[];
}

// ---- Responses (engine -> frontend) ----

export interface EngineRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---- Async Events (engine -> frontend, no id) ----

export type EngineEventType =
  | "transportState"
  | "trackMeters"
  | "engineReady"
  | "engineError"
  | "tracksReady"
  | "analysisRequested"
  | "terminated";

export interface TransportStateEvent {
  event: "transportState";
  isPlaying: boolean;
  positionSeconds: number;
  bpm: number;
  looping?: boolean;
}

export interface TrackMeterValue {
  leftDb: number;        // peak (back-compat alias)
  rightDb: number;       // peak (back-compat alias)
  peakLeftDb?: number;
  peakRightDb?: number;
  rmsLeftDb?: number;
  rmsRightDb?: number;
}

export interface TrackMetersEvent {
  event: "trackMeters";
  meters: Record<string, TrackMeterValue>;
}

export interface EngineReadyEvent {
  event: "engineReady";
  version: string;
}

export interface EngineErrorEvent {
  event: "engineError";
  message: string;
}

export interface TracksReadyEvent {
  event: "tracksReady";
}

export type EngineEvent =
  | TransportStateEvent
  | TrackMetersEvent
  | EngineReadyEvent
  | EngineErrorEvent
  | TracksReadyEvent;
