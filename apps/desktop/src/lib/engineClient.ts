/**
 * Engine client — wraps Tauri commands to the native audio engine.
 * Falls back gracefully when running in browser (dev without Tauri).
 */

type InvokeFunc = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenFunc = (
  event: string,
  handler: (e: { payload: unknown }) => void
) => Promise<() => void>;

let _invoke: InvokeFunc = async () => null;
let _listen: ListenFunc = async () => () => {};

// Dynamically import Tauri at runtime to avoid breaking the Vite dev server
async function loadTauri() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    _invoke = invoke as InvokeFunc;
    _listen = listen as ListenFunc;
  } catch {
    console.warn("[engineClient] Tauri not available — running in browser mode.");
  }
}

loadTauri();

// ─────────────────────────────────────────────
//  Engine bridge
// ─────────────────────────────────────────────

export const engineClient = {
  createProject: (projectId: string) =>
    _invoke("engine_create_project", { projectId }),

  loadProject: (projectId: string) =>
    _invoke("engine_load_project", { projectId }),

  createTrack: (
    trackId: string,
    name: string,
    role: string,
    stemType: string
  ) => _invoke("engine_create_track", { trackId, name, role, stemType }),

  loadAudioFile: (trackId: string, filePath: string) =>
    _invoke("engine_load_audio_file", { trackId, filePath }),

  addClip: (trackId: string, filePath: string, startTimeSeconds = 0) =>
    _invoke("engine_add_clip", { trackId, filePath, startTimeSeconds }),

  removeTrack: (trackId: string) =>
    _invoke("engine_remove_track", { trackId }),

  play: () => _invoke("engine_play"),
  stop: () => _invoke("engine_stop"),
  seek: (timeSeconds: number) => _invoke("engine_seek", { timeSeconds }),

  setLoop: (enabled: boolean, startSeconds: number, endSeconds: number) =>
    _invoke("engine_set_loop", { enabled, startSeconds, endSeconds }),

  saveSession: () => _invoke("engine_save_session"),

  analyze: (trackId: string) => _invoke("engine_analyze", { trackId }),

  getTransportState: () => _invoke("engine_get_transport_state"),

  setTrackVolume: (trackId: string, volumeDb: number) =>
    _invoke("engine_set_track_volume", { trackId, volumeDb }),

  setTrackPan: (trackId: string, pan: number) =>
    _invoke("engine_set_track_pan", { trackId, pan }),

  muteTrack: (trackId: string, muted: boolean) =>
    _invoke("engine_mute_track", { trackId, muted }),

  soloTrack: (trackId: string, soloed: boolean) =>
    _invoke("engine_solo_track", { trackId, soloed }),

  getTrackMeters: () => _invoke("engine_get_track_meters"),

  renderMix: (outputFilePath: string) =>
    _invoke("engine_render_mix", { outputFilePath }),

  disposeProject: () => _invoke("engine_dispose_project"),

  // ── Event subscriptions ──────────────────────────────────────

  onTransportState: (
    cb: (data: {
      isPlaying: boolean;
      positionSeconds: number;
      bpm: number;
    }) => void
  ) => _listen("engine:transportState", (e) => cb(e.payload as never)),

  onTrackMeters: (
    cb: (data: {
      meters: Record<string, { leftDb: number; rightDb: number }>;
    }) => void
  ) => _listen("engine:trackMeters", (e) => cb(e.payload as never)),

  onEngineReady: (cb: () => void) =>
    _listen("engine:engineReady", () => cb()),

  onEngineUnavailable: (cb: (reason: string) => void) =>
    _listen("engine:unavailable", (e) => cb(e.payload as string)),
};
