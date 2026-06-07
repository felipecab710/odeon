/**
 * Engine client — wraps Tauri commands to the native audio engine.
 * Falls back gracefully when running in browser (dev without Tauri).
 *
 * Race-condition fix: listen() calls made before Tauri loads are queued
 * and replayed once the real listen function is available.
 */

type InvokeFunc = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenFunc = (
  event: string,
  handler: (e: { payload: unknown }) => void
) => Promise<() => void>;

let _invoke: InvokeFunc = async () => null;
let _listen: ListenFunc | null = null;

// Queued listen calls registered before Tauri loaded
const _pendingListens: Array<{
  event: string;
  handler: (e: { payload: unknown }) => void;
  resolve: (unsub: () => void) => void;
}> = [];

async function loadTauri() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    _invoke = invoke as InvokeFunc;
    _listen = listen as ListenFunc;

    // Replay any listen calls that arrived before Tauri was ready
    for (const pending of _pendingListens) {
      void _listen(pending.event, pending.handler)
        .then(pending.resolve)
        .catch((err) => {
          console.warn(`[engineClient] listen failed for ${pending.event}:`, err);
          pending.resolve(() => {});
        });
    }
    _pendingListens.length = 0;
  } catch {
    console.warn("[engineClient] Tauri not available — running in browser mode.");
    // Resolve all pending listens with a no-op unsub so callers don't hang
    for (const pending of _pendingListens) {
      pending.resolve(() => {});
    }
    _pendingListens.length = 0;
  }
}

loadTauri();

function safeListenImpl(event: string, handler: (e: { payload: unknown }) => void): Promise<() => void> {
  if (_listen) {
    return _listen(event, handler);
  }
  // Queue it — will be replayed once Tauri loads
  return new Promise<() => void>((resolve) => {
    _pendingListens.push({ event, handler, resolve });
  });
}

// ─────────────────────────────────────────────
//  RPC unwrap
// ─────────────────────────────────────────────

interface EngineRpcEnvelope {
  result?: { ok?: boolean; result?: unknown; error?: string };
}

export function unwrapEngineResult<T>(response: unknown): T {
  const envelope = response as EngineRpcEnvelope;
  const inner = envelope?.result as { ok?: boolean; result?: unknown; error?: string } | undefined;
  if (inner?.ok) {
    return inner.result as T;
  }
  if (inner?.ok === false) {
    throw new Error(
      typeof inner.error === "string" ? inner.error : "Engine RPC failed",
    );
  }
  // Legacy/raw payloads (should not happen after engine envelope fix).
  if (inner && typeof inner === "object" && "numDecks" in inner) {
    return inner as T;
  }
  throw new Error(
    typeof inner?.error === "string" ? inner.error : "Engine RPC failed",
  );
}

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
  pause: () => _invoke("engine_pause"),
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

  setMasterVolume: (volumeDb: number) =>
    _invoke("engine_set_master_volume", { volumeDb }),

  moveClip: (trackId: string, clipId: string, newStartTimeSeconds: number) =>
    _invoke("engine_move_clip", { trackId, clipId, newStartTimeSeconds }),

  notifyTracksReady: () => _invoke("engine_notify_tracks_ready"),

  getTrackMeters: () => _invoke("engine_get_track_meters"),

  renderMix: (outputFilePath: string) =>
    _invoke("engine_render_mix", { outputFilePath }),

  disposeProject: () => _invoke("engine_dispose_project"),

  createDjSession: (numDecks: number) =>
    _invoke("engine_create_dj_session", { numDecks }),

  loadDeck: (
    deckIndex: number,
    filePath: string,
    name: string,
    timelineStartSeconds: number
  ) =>
    _invoke("engine_load_deck", {
      deckIndex,
      filePath,
      name,
      timelineStartSeconds,
    }),

  unloadDeck: (deckIndex: number) =>
    _invoke("engine_unload_deck", { deckIndex }),

  deckSeek: (deckIndex: number, localSeconds: number) =>
    _invoke("engine_deck_seek", { deckIndex, localSeconds }),

  deckPlay: (deckIndex: number) =>
    _invoke("engine_deck_play", { deckIndex }),

  deckPause: (deckIndex: number) =>
    _invoke("engine_deck_pause", { deckIndex }),

  deckSetRate: (deckIndex: number, rate: number) =>
    _invoke("engine_deck_set_rate", { deckIndex, rate }),

  getDjState: () => _invoke("engine_get_dj_state"),

  setDeckEq: (deckIndex: number, lowDb: number, midDb: number, highDb: number) =>
    _invoke("engine_set_deck_eq", { deckIndex, lowDb, midDb, highDb }),

  setDeckFilter: (deckIndex: number, filter: number) =>
    _invoke("engine_set_deck_filter", { deckIndex, filter }),

  setDeckChannelMix: (
    deckIndex: number,
    mix: {
      trimDb: number;
      faderDb: number;
      lowDb: number;
      midDb: number;
      highDb: number;
      filter: number;
      orientation: string;
      muted: boolean;
      pfl: boolean;
    },
  ) =>
    _invoke("engine_set_deck_channel_mix", { deckIndex, ...mix }),

  setCrossfader: (position: number) =>
    _invoke("engine_set_crossfader", { position }),

  setDeckOrientation: (deckIndex: number, orientation: string) =>
    _invoke("engine_set_deck_orientation", { deckIndex, orientation }),

  setPflDeck: (deckIndex: number, enabled: boolean) =>
    _invoke("engine_set_pfl_deck", { deckIndex, enabled }),

  deckSetHotcue: (deckIndex: number, slot: number, timeSeconds: number) =>
    _invoke("engine_deck_set_hotcue", { deckIndex, slot, timeSeconds }),

  deckJumpHotcue: (deckIndex: number, slot: number) =>
    _invoke("engine_deck_jump_hotcue", { deckIndex, slot }),

  deckClearHotcue: (deckIndex: number, slot: number) =>
    _invoke("engine_deck_clear_hotcue", { deckIndex, slot }),

  deckSetLoop: (
    deckIndex: number,
    enabled: boolean,
    inSeconds: number,
    outSeconds: number,
  ) =>
    _invoke("engine_deck_set_loop", {
      deckIndex,
      enabled,
      inSeconds,
      outSeconds,
    }),

  deckSetSyncMode: (deckIndex: number, mode: string) =>
    _invoke("engine_deck_set_sync_mode", { deckIndex, mode }),

  listAudioDevices: () =>
    _invoke("engine_list_audio_devices", {}).then(unwrapEngineResult),

  getPlaybackEngineSettings: () =>
    _invoke("engine_get_playback_settings", {}).then(unwrapEngineResult),

  setPlaybackEngineSettings: (settings: Record<string, unknown>) =>
    _invoke("engine_set_playback_settings", { settings }).then(unwrapEngineResult),

  // ── Event subscriptions ──────────────────────────────────────

  onTransportState: (
    cb: (data: {
      isPlaying: boolean;
      positionSeconds: number;
      bpm: number;
    }) => void
  ) => safeListenImpl("engine:transportState", (e) => cb(e.payload as never)),

  onTrackMeters: (
    cb: (data: {
      meters: Record<string, { leftDb: number; rightDb: number }>;
    }) => void
  ) => safeListenImpl("engine:trackMeters", (e) => cb(e.payload as never)),

  onEngineReady: (cb: () => void) =>
    safeListenImpl("engine:engineReady", () => cb()),

  onTracksReady: (cb: () => void) =>
    safeListenImpl("engine:tracksReady", () => cb()),

  onEngineUnavailable: (cb: (reason: string) => void) =>
    safeListenImpl("engine:unavailable", (e) => cb(e.payload as string)),
};
