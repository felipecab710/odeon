//! Bundled Python analysis API — spawned from Resources/api-bundle in release builds.

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct ApiSidecarState {
    pub child: Option<tauri_plugin_shell::process::CommandChild>,
}

impl ApiSidecarState {
    pub fn new() -> Self {
        Self { child: None }
    }
}

pub type SharedApi = Arc<Mutex<ApiSidecarState>>;

fn stop_api(api: &SharedApi) {
    let mut state = api.lock().unwrap();
    if let Some(child) = state.child.take() {
        let _ = child.kill();
    }
}

/// Start bundled uvicorn if Resources/api-bundle exists (release .app / .dmg).
pub fn start_api(app: &AppHandle, api: SharedApi) -> Result<(), String> {
    let python = app
        .path()
        .resolve("api-bundle/venv/bin/python", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Bundled API python not found: {e}"))?;

    if !python.exists() {
        return Err(format!("Bundled API python missing at {}", python.display()));
    }

    let api_root = app
        .path()
        .resolve("api-bundle", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    stop_api(&api);

    let sidecar = app
        .shell()
        .command(python)
        .args(["run_server.py"])
        .current_dir(&api_root)
        .env("ODEON_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("ODEON_API_HOST", "127.0.0.1")
        .env("ODEON_API_PORT", "8000");

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn odeon-api: {e}"))?;

    {
        let mut state = api.lock().unwrap();
        state.child = Some(child);
    }

    let app_handle = app.clone();
    let api_clone = api.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    log::info!("[api] {}", String::from_utf8_lossy(&bytes).trim());
                }
                CommandEvent::Stderr(bytes) => {
                    log::warn!("[api stderr] {}", String::from_utf8_lossy(&bytes).trim());
                }
                CommandEvent::Terminated(status) => {
                    log::warn!("[api] process terminated: {:?}", status);
                    api_clone.lock().unwrap().child = None;
                    app_handle.emit("api:terminated", ()).ok();
                    break;
                }
                _ => {}
            }
        }
    });

    log::info!("Odeon API sidecar started (data: {})", data_dir.display());
    Ok(())
}

pub fn stop_api_sidecar(api: &SharedApi) {
    stop_api(api);
}
