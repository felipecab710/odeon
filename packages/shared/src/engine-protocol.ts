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
  | "play"
  | "stop"
  | "seek"
  | "setLoop"
  | "getTransportState"
  | "setTrackVolume"
  | "setTrackPan"
  | "muteTrack"
  | "soloTrack"
  | "getTrackMeters"
  | "renderMix"
  | "analyze"
  | "listAudioDevices"
  | "getPlaybackEngineSettings"
  | "setPlaybackEngineSettings";

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
export interface RenderMixParams      { outputFilePath: string }
export interface AnalyzeParams        { trackId: string }

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
  | "engineError";

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

export type EngineEvent =
  | TransportStateEvent
  | TrackMetersEvent
  | EngineReadyEvent
  | EngineErrorEvent;
