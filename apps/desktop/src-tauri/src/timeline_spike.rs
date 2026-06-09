//! Spawn the native timeline spike as a separate process (winit main thread on macOS).

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SPIKE_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn spike_binary_path() -> PathBuf {
    // Same target dir as odeon-desktop when built via `cargo build --bin timeline-spike`.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/debug/timeline-spike")
}

#[tauri::command]
pub fn timeline_spike_open() -> Result<(), String> {
    let mut guard = SPIKE_CHILD.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => *guard = None,
            Ok(None) => return Ok(()),
            Err(e) => return Err(format!("timeline spike status: {e}")),
        }
    }

    let bin = spike_binary_path();
    if !bin.exists() {
        return Err(format!(
            "timeline-spike binary not found at {}. Run: cargo build --bin timeline-spike",
            bin.display()
        ));
    }

    let child = Command::new(&bin)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn timeline spike: {e}"))?;

    log::info!("native timeline spike started (pid {})", child.id());
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn timeline_spike_close() -> Result<(), String> {
    let mut guard = SPIKE_CHILD.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
    Ok(())
}
