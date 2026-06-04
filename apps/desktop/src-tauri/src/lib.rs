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
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

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

fn start_engine(app: &AppHandle, engine: SharedEngine) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;

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

// ─────────────────────────────────────────────
//  App entry point
// ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_state: SharedEngine = Arc::new(Mutex::new(EngineState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(engine_state.clone())
        .setup(move |app| {
            // Start the odeon-engine sidecar
            if let Err(e) = start_engine(app.handle(), engine_state.clone()) {
                // Non-fatal: engine may not be built yet during frontend development
                log::warn!("Could not start odeon-engine sidecar: {}. Playback unavailable.", e);
                app.emit("engine:unavailable", e).ok();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_create_project,
            engine_load_project,
            engine_create_track,
            engine_load_audio_file,
            engine_add_clip,
            engine_remove_track,
            engine_play,
            engine_stop,
            engine_seek,
            engine_get_transport_state,
            engine_set_track_volume,
            engine_set_track_pan,
            engine_mute_track,
            engine_solo_track,
            engine_get_track_meters,
            engine_render_mix,
            engine_dispose_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
