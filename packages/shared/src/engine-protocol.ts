// ─────────────────────────────────────────────
//  Audio Engine JSON-RPC Protocol
//  One JSON object per line on stdin/stdout
// ─────────────────────────────────────────────

// ---- Requests (frontend -> engine) ----

export type EngineRpcMethod =
  | "createProject"
  | "loadProject"
  | "createTrack"
  | "loadAudioFile"
  | "addClip"
  | "removeTrack"
  | "play"
  | "stop"
  | "seek"
  | "getTransportState"
  | "setTrackVolume"
  | "setTrackPan"
  | "muteTrack"
  | "soloTrack"
  | "getTrackMeters"
  | "renderMix"
  | "disposeProject";

export interface EngineRpcRequest {
  id: number;
  method: EngineRpcMethod;
  params: Record<string, unknown>;
}

export interface CreateProjectParams  { projectId: string }
export interface LoadProjectParams    { projectId: string }
export interface CreateTrackParams    { trackId: string; name: string; role: string; stemType: string }
export interface LoadAudioFileParams  { trackId: string; filePath: string }
export interface AddClipParams        { trackId: string; filePath: string; startTimeSeconds: number }
export interface RemoveTrackParams    { trackId: string }
export interface SeekParams           { timeSeconds: number }
export interface SetTrackVolumeParams { trackId: string; volumeDb: number }
export interface SetTrackPanParams    { trackId: string; pan: number }
export interface MuteTrackParams      { trackId: string; muted: boolean }
export interface SoloTrackParams      { trackId: string; soloed: boolean }
export interface RenderMixParams      { outputFilePath: string }

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
}

export interface TrackMetersEvent {
  event: "trackMeters";
  meters: Record<string, { leftDb: number; rightDb: number }>;
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
