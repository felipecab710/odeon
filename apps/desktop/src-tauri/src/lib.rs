/**
 * Odeon desktop Tauri v2 backend.
 *
 * Manages the odeon-engine sidecar process and exposes Tauri commands that
 * map 1:1 to the AudioEngineBridge JSON-RPC protocol.
 *
 * The engine binary communicates via:
 *   stdin  <- JSON-RPC requests (one per line)
 *   stdout -> JSON-RPC responses + async events (one per line)
 *
 * Async events (transport, meters) are forwarded to the frontend as Tauri
 * events via app.emit().
 */
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

mod timeline_embed;
mod timeline_spike;

use timeline_embed::{EmbedFrame, SharedTimelineEmbed, TimelineEmbedState};
use odeon_timeline::TimelineScene;

// ─────────────────────────────────────────────
//  Shared engine state
// ─────────────────────────────────────────────

struct EngineState {
    child: Option<CommandChild>,
    next_id: u64,
    /// Pending request callbacks: id -> oneshot sender
    pending: HashMap<u64, tokio::sync::oneshot::Sender<Value>>,
}

impl EngineState {
    fn new() -> Self {
        Self {
            child: None,
            next_id: 1,
            pending: HashMap::new(),
        }
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

type SharedEngine = Arc<Mutex<EngineState>>;

// ─────────────────────────────────────────────
//  Engine startup
// ─────────────────────────────────────────────

fn stop_engine_child(engine: &SharedEngine) {
    let mut state = engine.lock().unwrap();
    if let Some(child) = state.child.take() {
        let _ = child.kill();
    }
    state.pending.clear();
}

fn start_engine(app: &AppHandle, engine: SharedEngine) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;

    stop_engine_child(&engine);

    let sidecar = app
        .shell()
        .sidecar("odeon-engine")
        .map_err(|e| format!("Sidecar not found: {e}"))?;

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn odeon-engine: {e}"))?;

    {
        let mut state = engine.lock().unwrap();
        state.child = Some(child);
    }

    let app_handle = app.clone();
    let engine_clone = engine.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    handle_engine_output(&app_handle, &engine_clone, &line);
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    log::warn!("[engine stderr] {}", line.trim());
                }
                CommandEvent::Terminated(status) => {
                    log::warn!("[engine] process terminated: {:?}", status);
                    {
                        let mut state = engine_clone.lock().unwrap();
                        state.child = None;
                        state.pending.clear();
                    }
                    app_handle
                        .emit("engine:terminated", ())
                        .ok();
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn handle_engine_output(app: &AppHandle, engine: &SharedEngine, line: &str) {
    let Ok(value): Result<Value, _> = serde_json::from_str(line) else {
        log::warn!("[engine] non-JSON output: {}", line);
        return;
    };

    // Async event (has "event" key, no "id")
    if let Some(event_type) = value.get("event").and_then(|v| v.as_str()) {
        let event_name = format!("engine:{}", event_type);
        app.emit(&event_name, value.clone()).ok();
        return;
    }

    // RPC response (has "id")
    if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
        let mut state = engine.lock().unwrap();
        if let Some(tx) = state.pending.remove(&id) {
            let _ = tx.send(value.clone());
        }
    }
}

// ─────────────────────────────────────────────
//  Send an RPC call and await its response
// ─────────────────────────────────────────────

async fn rpc_call(
    engine: &SharedEngine,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let (id, rx) = {
        let mut state = engine.lock().unwrap();
        let id = state.next_id();
        let (tx, rx) = tokio::sync::oneshot::channel();
        state.pending.insert(id, tx);

        let msg = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&msg).unwrap() + "\n";

        if let Some(child) = state.child.as_mut() {
            child
                .write(line.as_bytes())
                .map_err(|e| format!("Write to engine failed: {e}"))?;
        } else {
            return Err("Engine not running".into());
        }

        (id, rx)
    };

    let response = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        rx,
    )
    .await
    .map_err(|_| format!("Engine RPC timeout for id={id}"))?
    .map_err(|_| "Engine response channel closed".to_string())?;

    Ok(response)
}

// ─────────────────────────────────────────────
//  Tauri commands — AudioEngineBridge
// ─────────────────────────────────────────────

#[tauri::command]
async fn engine_create_project(
    project_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "createProject", json!({ "projectId": project_id })).await
}

#[tauri::command]
async fn engine_load_project(
    project_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "loadProject", json!({ "projectId": project_id })).await
}

#[tauri::command]
async fn engine_create_track(
    track_id: String,
    name: String,
    role: String,
    stem_type: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "createTrack",
        json!({ "trackId": track_id, "name": name, "role": role, "stemType": stem_type }),
    )
    .await
}

#[tauri::command]
async fn engine_create_bus(
    bus_id: String,
    name: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "createBus",
        json!({ "busId": bus_id, "name": name }),
    )
    .await
}

#[tauri::command]
async fn engine_set_route_aux_send(
    track_id: String,
    bus_number: i32,
    gain_db: f32,
    muted: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setRouteAuxSend",
        json!({
            "trackId": track_id,
            "busNumber": bus_number,
            "gainDb": gain_db,
            "muted": muted,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_load_audio_file(
    track_id: String,
    file_path: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "loadAudioFile",
        json!({ "trackId": track_id, "filePath": file_path }),
    )
    .await
}

#[tauri::command]
async fn engine_add_clip(
    track_id: String,
    file_path: String,
    start_time_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "addClip",
        json!({ "trackId": track_id, "filePath": file_path, "startTimeSeconds": start_time_seconds }),
    )
    .await
}

#[tauri::command]
async fn engine_remove_track(
    track_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "removeTrack", json!({ "trackId": track_id })).await
}

#[tauri::command]
async fn engine_play(engine: State<'_, SharedEngine>) -> Result<Value, String> {
    rpc_call(&engine, "play", json!({})).await
}

#[tauri::command]
async fn engine_pause(engine: State<'_, SharedEngine>) -> Result<Value, String> {
    rpc_call(&engine, "pause", json!({})).await
}

#[tauri::command]
async fn engine_stop(engine: State<'_, SharedEngine>) -> Result<Value, String> {
    rpc_call(&engine, "stop", json!({})).await
}

#[tauri::command]
async fn engine_seek(
    time_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "seek", json!({ "timeSeconds": time_seconds })).await
}

#[tauri::command]
async fn engine_set_loop(
    enabled: bool,
    start_seconds: f64,
    end_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setLoop",
        json!({ "enabled": enabled, "startSeconds": start_seconds, "endSeconds": end_seconds }),
    )
    .await
}

#[tauri::command]
async fn engine_save_session(engine: State<'_, SharedEngine>) -> Result<Value, String> {
    rpc_call(&engine, "saveSession", json!({})).await
}

#[tauri::command]
async fn engine_analyze(
    track_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "analyze", json!({ "trackId": track_id })).await
}

#[tauri::command]
async fn engine_get_transport_state(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "getTransportState", json!({})).await
}

#[tauri::command]
async fn engine_set_track_volume(
    track_id: String,
    volume_db: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setTrackVolume",
        json!({ "trackId": track_id, "volumeDb": volume_db }),
    )
    .await
}

#[tauri::command]
async fn engine_set_track_pan(
    track_id: String,
    pan: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setTrackPan",
        json!({ "trackId": track_id, "pan": pan }),
    )
    .await
}

#[tauri::command]
async fn engine_mute_track(
    track_id: String,
    muted: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "muteTrack",
        json!({ "trackId": track_id, "muted": muted }),
    )
    .await
}

#[tauri::command]
async fn engine_solo_track(
    track_id: String,
    soloed: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "soloTrack",
        json!({ "trackId": track_id, "soloed": soloed }),
    )
    .await
}

#[tauri::command]
async fn engine_set_track_channel_mix(
    track_id: String,
    trim_db: f32,
    fader_db: f32,
    low_db: f32,
    mid_db: f32,
    high_db: f32,
    filter: f32,
    orientation: String,
    muted: bool,
    pfl: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setTrackChannelMix",
        json!({
            "trackId": track_id,
            "trimDb": trim_db,
            "faderDb": fader_db,
            "lowDb": low_db,
            "midDb": mid_db,
            "highDb": high_db,
            "filter": filter,
            "orientation": orientation,
            "muted": muted,
            "pfl": pfl,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_exclusive_solo(
    track_ids: Value,
    solo_track_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "exclusiveSolo",
        json!({ "trackIds": track_ids, "soloTrackId": solo_track_id }),
    )
    .await
}

#[tauri::command]
async fn engine_create_stem_stack(
    stack_id: String,
    layers: Value,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "createStemStack",
        json!({ "stackId": stack_id, "layers": layers }),
    )
    .await
}

#[tauri::command]
async fn engine_dispose_stem_stack(
    stack_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "disposeStemStack", json!({ "stackId": stack_id })).await
}

#[tauri::command]
async fn engine_exclusive_solo_stack(
    stack_id: String,
    layer_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "exclusiveSoloStack",
        json!({ "stackId": stack_id, "layerId": layer_id }),
    )
    .await
}

#[tauri::command]
async fn engine_set_master_volume(
    volume_db: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "setMasterVolume", json!({ "volumeDb": volume_db })).await
}

#[tauri::command]
async fn engine_move_clip(
    track_id: String,
    clip_id: String,
    new_start_time_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "moveClip",
        json!({ "trackId": track_id, "clipId": clip_id, "newStartTimeSeconds": new_start_time_seconds }),
    )
    .await
}

#[tauri::command]
async fn engine_notify_tracks_ready(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "notifyTracksReady", json!({})).await
}

#[tauri::command]
async fn engine_create_dj_session(
    num_decks: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "createDjSession",
        json!({ "numDecks": num_decks }),
    )
    .await
}

#[tauri::command]
async fn engine_load_deck(
    deck_index: u32,
    file_path: String,
    name: String,
    timeline_start_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "loadDeck",
        json!({
            "deckIndex": deck_index,
            "filePath": file_path,
            "name": name,
            "timelineStartSeconds": timeline_start_seconds,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_unload_deck(
    deck_index: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "unloadDeck", json!({ "deckIndex": deck_index })).await
}

#[tauri::command]
async fn engine_deck_seek(
    deck_index: u32,
    local_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSeek",
        json!({
            "deckIndex": deck_index,
            "localSeconds": local_seconds,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_play(
    deck_index: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "deckPlay", json!({ "deckIndex": deck_index })).await
}

#[tauri::command]
async fn engine_deck_pause(
    deck_index: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "deckPause", json!({ "deckIndex": deck_index })).await
}

#[tauri::command]
async fn engine_deck_set_rate(
    deck_index: u32,
    rate: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSetRate",
        json!({ "deckIndex": deck_index, "rate": rate }),
    )
    .await
}

#[tauri::command]
async fn engine_get_dj_state(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "getDjState", json!({})).await
}

#[tauri::command]
async fn engine_set_deck_eq(
    deck_index: u32,
    low_db: f32,
    mid_db: f32,
    high_db: f32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setDeckEq",
        json!({ "deckIndex": deck_index, "lowDb": low_db, "midDb": mid_db, "highDb": high_db }),
    )
    .await
}

#[tauri::command]
async fn engine_set_deck_filter(
    deck_index: u32,
    filter: f32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setDeckFilter",
        json!({ "deckIndex": deck_index, "filter": filter }),
    )
    .await
}

#[tauri::command]
async fn engine_set_deck_channel_mix(
    deck_index: u32,
    trim_db: f32,
    fader_db: f32,
    low_db: f32,
    mid_db: f32,
    high_db: f32,
    filter: f32,
    orientation: String,
    muted: bool,
    pfl: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setDeckChannelMix",
        json!({
            "deckIndex": deck_index,
            "trimDb": trim_db,
            "faderDb": fader_db,
            "lowDb": low_db,
            "midDb": mid_db,
            "highDb": high_db,
            "filter": filter,
            "orientation": orientation,
            "muted": muted,
            "pfl": pfl,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_set_crossfader(
    position: f32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "setCrossfader", json!({ "position": position })).await
}

#[tauri::command]
async fn engine_set_deck_orientation(
    deck_index: u32,
    orientation: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setDeckOrientation",
        json!({ "deckIndex": deck_index, "orientation": orientation }),
    )
    .await
}

#[tauri::command]
async fn engine_set_pfl_deck(
    deck_index: u32,
    enabled: bool,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "setPflDeck",
        json!({ "deckIndex": deck_index, "enabled": enabled }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_set_hotcue(
    deck_index: u32,
    slot: u32,
    time_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSetHotcue",
        json!({ "deckIndex": deck_index, "slot": slot, "timeSeconds": time_seconds }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_jump_hotcue(
    deck_index: u32,
    slot: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckJumpHotcue",
        json!({ "deckIndex": deck_index, "slot": slot }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_clear_hotcue(
    deck_index: u32,
    slot: u32,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckClearHotcue",
        json!({ "deckIndex": deck_index, "slot": slot }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_set_loop(
    deck_index: u32,
    enabled: bool,
    in_seconds: f64,
    out_seconds: f64,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSetLoop",
        json!({
            "deckIndex": deck_index,
            "enabled": enabled,
            "inSeconds": in_seconds,
            "outSeconds": out_seconds,
        }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_set_sync_mode(
    deck_index: u32,
    mode: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSetSyncMode",
        json!({ "deckIndex": deck_index, "mode": mode }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_load_stem_layers(
    deck_index: u32,
    layers: Value,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckLoadStemLayers",
        json!({ "deckIndex": deck_index, "layers": layers }),
    )
    .await
}

#[tauri::command]
async fn engine_deck_set_stem_layer(
    deck_index: u32,
    layer_id: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "deckSetStemLayer",
        json!({ "deckIndex": deck_index, "layerId": layer_id }),
    )
    .await
}

#[tauri::command]
async fn engine_get_track_meters(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "getTrackMeters", json!({})).await
}

#[tauri::command]
async fn engine_render_mix(
    output_file_path: String,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(
        &engine,
        "renderMix",
        json!({ "outputFilePath": output_file_path }),
    )
    .await
}

#[tauri::command]
async fn engine_dispose_project(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "disposeProject", json!({})).await
}

#[tauri::command]
async fn engine_list_audio_devices(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "listAudioDevices", json!({})).await
}

#[tauri::command]
async fn engine_get_playback_settings(
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "getPlaybackEngineSettings", json!({})).await
}

#[tauri::command]
async fn engine_set_playback_settings(
    settings: Value,
    engine: State<'_, SharedEngine>,
) -> Result<Value, String> {
    rpc_call(&engine, "setPlaybackEngineSettings", settings).await
}

// ─────────────────────────────────────────────
//  macOS window chrome
// ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn set_macos_window_background(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "macos"))]
fn set_macos_window_background(_window: &tauri::WebviewWindow) {}

// ─────────────────────────────────────────────
//  App entry point
// ─────────────────────────────────────────────
//  Engine restart (sidecar crashed or device change left it dead)
// ─────────────────────────────────────────────

#[tauri::command]
fn engine_restart(app: AppHandle, engine: State<'_, SharedEngine>) -> Result<(), String> {
    start_engine(&app, engine.inner().clone())
}

// ─────────────────────────────────────────────
//  Utility commands
// ─────────────────────────────────────────────

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("--reveal")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────
//  Native timeline embed (Phase 1)
// ─────────────────────────────────────────────

#[tauri::command]
fn timeline_embed_start(
    window: tauri::WebviewWindow,
    embed: State<'_, SharedTimelineEmbed>,
    frame: EmbedFrame,
) -> Result<(), String> {
    let parent = window
        .ns_view()
        .map_err(|e| format!("ns_view: {e}"))?;
    timeline_embed::embed_start(embed.inner(), parent, frame)
}

#[tauri::command]
fn timeline_embed_wheel(
    embed: State<'_, SharedTimelineEmbed>,
    delta_y: f64,
    ctrl: bool,
    cursor_x: f64,
) -> Result<(), String> {
    timeline_embed::embed_wheel(embed.inner(), delta_y, ctrl, cursor_x)
}

#[tauri::command]
fn timeline_embed_set_frame(
    embed: State<'_, SharedTimelineEmbed>,
    frame: EmbedFrame,
) -> Result<(), String> {
    timeline_embed::embed_set_frame(embed.inner(), frame)
}

#[tauri::command]
fn timeline_embed_set_scene(
    embed: State<'_, SharedTimelineEmbed>,
    scene: TimelineScene,
) -> Result<(), String> {
    timeline_embed::embed_set_scene(embed.inner(), scene)
}

#[tauri::command]
fn timeline_embed_set_playhead(
    embed: State<'_, SharedTimelineEmbed>,
    playhead_sec: f64,
) -> Result<(), String> {
    timeline_embed::embed_set_playhead(embed.inner(), playhead_sec)
}

#[tauri::command]
fn timeline_embed_stop(embed: State<'_, SharedTimelineEmbed>) -> Result<(), String> {
    timeline_embed::embed_stop(embed.inner())
}

#[tauri::command]
fn timeline_embed_is_active(embed: State<'_, SharedTimelineEmbed>) -> Result<bool, String> {
    Ok(timeline_embed::embed_is_active(embed.inner()))
}

// ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_state: SharedEngine = Arc::new(Mutex::new(EngineState::new()));
    let timeline_embed_state: SharedTimelineEmbed =
        Arc::new(Mutex::new(TimelineEmbedState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(engine_state.clone())
        .manage(timeline_embed_state.clone())
        .setup(move |app| {
            // Start the odeon-engine sidecar
            if let Err(e) = start_engine(app.handle(), engine_state.clone()) {
                log::warn!("Could not start odeon-engine sidecar: {}. Playback unavailable.", e);
                app.emit("engine:unavailable", e).ok();
            }

            // Forward OS-level file drag-and-drop events to the frontend.
            // Tauri intercepts these before they reach the WebView, so the HTML5
            // drag API never fires — we re-emit them as custom events instead.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(Some(tauri::Theme::Dark));
                set_macos_window_background(&window);

                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Resized(..) => {
                            // Layout is handled in the webview; avoid redundant native calls per frame.
                        }
                        WindowEvent::DragDrop(tauri::DragDropEvent::Enter { paths, .. }) => {
                            let strs: Vec<String> = paths
                                .iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            handle.emit("file-drop:hover", strs).ok();
                        }
                        WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                            let strs: Vec<String> = paths
                                .iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect();
                            handle.emit("file-drop:dropped", strs).ok();
                        }
                        WindowEvent::DragDrop(tauri::DragDropEvent::Leave) => {
                            handle.emit("file-drop:cancel", ()).ok();
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_create_project,
            engine_load_project,
            engine_create_track,
            engine_create_bus,
            engine_set_route_aux_send,
            engine_load_audio_file,
            engine_add_clip,
            engine_remove_track,
            engine_play,
            engine_pause,
            engine_stop,
            engine_seek,
            engine_set_loop,
            engine_save_session,
            engine_analyze,
            engine_get_transport_state,
            engine_set_track_volume,
            engine_set_track_pan,
            engine_mute_track,
            engine_solo_track,
            engine_set_track_channel_mix,
            engine_exclusive_solo,
            engine_create_stem_stack,
            engine_dispose_stem_stack,
            engine_exclusive_solo_stack,
            engine_get_track_meters,
            engine_set_master_volume,
            engine_move_clip,
            engine_notify_tracks_ready,
            engine_create_dj_session,
            engine_load_deck,
            engine_unload_deck,
            engine_deck_seek,
            engine_deck_play,
            engine_deck_pause,
            engine_deck_set_rate,
            engine_get_dj_state,
            engine_set_deck_eq,
            engine_set_deck_filter,
            engine_set_deck_channel_mix,
            engine_set_crossfader,
            engine_set_deck_orientation,
            engine_set_pfl_deck,
            engine_deck_set_hotcue,
            engine_deck_jump_hotcue,
            engine_deck_clear_hotcue,
            engine_deck_set_loop,
            engine_deck_set_sync_mode,
            engine_deck_load_stem_layers,
            engine_deck_set_stem_layer,
            engine_render_mix,
            engine_dispose_project,
            engine_list_audio_devices,
            engine_get_playback_settings,
            engine_set_playback_settings,
            engine_restart,
            reveal_in_finder,
            timeline_spike::timeline_spike_open,
            timeline_spike::timeline_spike_close,
            timeline_embed_start,
            timeline_embed_set_frame,
            timeline_embed_set_scene,
            timeline_embed_set_playhead,
            timeline_embed_wheel,
            timeline_embed_stop,
            timeline_embed_is_active,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |handle, event| {
            if matches!(event, tauri::RunEvent::MainEventsCleared { .. }) {
                timeline_embed::embed_tick(&timeline_embed_state, &handle);
            }
        });
}
