//! Phase 1 — embedded native timeline panel (NSView subview + wgpu on macOS).

#[cfg(target_os = "macos")]
mod macos;

use std::sync::{Arc, Mutex};

use odeon_timeline::TimelineScene;

pub use odeon_timeline::EmbedFrame;

#[cfg(target_os = "macos")]
std::thread_local! {
    static EMBED_PANEL: std::cell::RefCell<Option<macos::MacTimelinePanel>> =
        const { std::cell::RefCell::new(None) };
}

pub struct TimelineEmbedState {
    active: bool,
    #[cfg(target_os = "macos")]
    parent_view: Option<usize>,
    #[cfg(target_os = "macos")]
    pending_frame: Option<EmbedFrame>,
    #[cfg(target_os = "macos")]
    pending_scene: Option<TimelineScene>,
    #[cfg(target_os = "macos")]
    pending_wheel: Option<(f64, bool, f64)>,
    #[cfg(target_os = "macos")]
    pending_playhead: Option<f64>,
    #[cfg(target_os = "macos")]
    needs_init: bool,
    #[cfg(target_os = "macos")]
    needs_stop: bool,
}

impl TimelineEmbedState {
    pub fn new() -> Self {
        Self {
            active: false,
            #[cfg(target_os = "macos")]
            parent_view: None,
            #[cfg(target_os = "macos")]
            pending_frame: None,
            #[cfg(target_os = "macos")]
            pending_scene: None,
            #[cfg(target_os = "macos")]
            pending_wheel: None,
            #[cfg(target_os = "macos")]
            pending_playhead: None,
            #[cfg(target_os = "macos")]
            needs_init: false,
            #[cfg(target_os = "macos")]
            needs_stop: false,
        }
    }
}

pub type SharedTimelineEmbed = Arc<Mutex<TimelineEmbedState>>;

#[cfg(target_os = "macos")]
pub fn embed_start(
    state: &SharedTimelineEmbed,
    parent_view: *mut std::ffi::c_void,
    frame: EmbedFrame,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.active = true;
    guard.parent_view = Some(parent_view as usize);
    guard.pending_frame = Some(frame);
    guard.needs_init = true;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_start(
    _state: &SharedTimelineEmbed,
    _parent: *mut std::ffi::c_void,
    _frame: EmbedFrame,
) -> Result<(), String> {
    Err("Native timeline embed is macOS-only in Phase 1".into())
}

#[cfg(target_os = "macos")]
pub fn embed_set_frame(state: &SharedTimelineEmbed, frame: EmbedFrame) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.pending_frame = Some(frame);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_set_frame(_state: &SharedTimelineEmbed, _frame: EmbedFrame) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn embed_set_scene(state: &SharedTimelineEmbed, scene: TimelineScene) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.pending_scene = Some(scene);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_set_scene(_state: &SharedTimelineEmbed, _scene: TimelineScene) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_set_playhead(_state: &SharedTimelineEmbed, _playhead_sec: f64) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn embed_set_playhead(state: &SharedTimelineEmbed, playhead_sec: f64) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.pending_playhead = Some(playhead_sec);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn embed_wheel(
    state: &SharedTimelineEmbed,
    delta_y: f64,
    ctrl: bool,
    cursor_x: f64,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.pending_wheel = Some((delta_y, ctrl, cursor_x));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_wheel(
    _state: &SharedTimelineEmbed,
    _delta_y: f64,
    _ctrl: bool,
    _cursor_x: f64,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn embed_tick(state: &SharedTimelineEmbed, app: &tauri::AppHandle) {
    let tick_input = {
        let Ok(mut guard) = state.lock() else {
            return;
        };

        if guard.needs_stop {
            EMBED_PANEL.with(|cell| {
                if let Some(panel) = cell.borrow_mut().take() {
                    panel.stop();
                }
            });
            guard.active = false;
            guard.needs_init = false;
            guard.needs_stop = false;
            guard.parent_view = None;
            guard.pending_frame = None;
            guard.pending_scene = None;
            guard.pending_wheel = None;
            guard.pending_playhead = None;
            return;
        }

        if !guard.active {
            return;
        }

        if guard.needs_init {
            if let (Some(parent), Some(frame)) = (guard.parent_view, guard.pending_frame.take()) {
                EMBED_PANEL.with(|cell| {
                    if let Some(panel) = cell.borrow_mut().take() {
                        panel.stop();
                    }
                });
                match macos::MacTimelinePanel::create(parent as *mut _, frame) {
                    Ok(panel) => {
                        EMBED_PANEL.with(|cell| *cell.borrow_mut() = Some(panel));
                        guard.needs_init = false;
                    }
                    Err(e) => {
                        log::error!("[timeline embed] init failed: {e}");
                        guard.active = false;
                        guard.needs_init = false;
                        return;
                    }
                }
            } else {
                return;
            }
        }

        (
            guard.pending_frame.take(),
            guard.pending_scene.take(),
            guard.pending_wheel.take(),
            guard.pending_playhead.take(),
        )
    };

    let viewport_emit = EMBED_PANEL.with(|cell| {
        let mut panel_slot = cell.borrow_mut();
        let Some(panel) = panel_slot.as_mut() else {
            return None;
        };
        if let Some(frame) = tick_input.0 {
            panel.set_frame(frame);
        }
        if let Some(scene) = tick_input.1 {
            panel.set_scene(scene);
        }
        if let Some((delta_y, ctrl, cursor_x)) = tick_input.2 {
            panel.apply_wheel(delta_y, ctrl, cursor_x);
        }
        if let Some(playhead) = tick_input.3 {
            panel.set_playhead(playhead);
        }
        let emit = panel.take_viewport_emit();
        panel.tick();
        emit
    });

    if let Some((pps, scroll)) = viewport_emit {
        use tauri::Emitter;
        let _ = app.emit(
            "timeline-embed:viewport",
            serde_json::json!({
                "pixels_per_second": pps,
                "scroll_left": scroll,
            }),
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub fn embed_tick(_state: &SharedTimelineEmbed, _app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
pub fn embed_stop(state: &SharedTimelineEmbed) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.needs_stop = true;
    guard.active = false;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn embed_stop(state: &SharedTimelineEmbed) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.active = false;
    Ok(())
}

pub fn embed_is_active(state: &SharedTimelineEmbed) -> bool {
    state.lock().map(|g| g.active).unwrap_or(false)
}
