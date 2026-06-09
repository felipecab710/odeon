//! Standalone embed process — winit main thread + stdin IPC from Tauri parent.

use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use winit::dpi::{LogicalSize, PhysicalPosition};
use winit::event::{Event, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ControlFlow, EventLoopBuilder};
use winit::platform::macos::EventLoopBuilderExtMacOS;
use winit::window::{CursorIcon, WindowBuilder, WindowLevel};

use crate::embed::ipc::IpcMessage;
use crate::embed::EmbedFrame;
use crate::spike::GpuRenderer;
use crate::viewport::wheel_steps_from_delta_y;
use crate::TimelineScene;

struct PanelState {
    scene: TimelineScene,
    cursor_x: f64,
    modifiers_ctrl: bool,
    frame_times: Vec<f64>,
    pending_frame: Option<EmbedFrame>,
    applied_frame: Option<EmbedFrame>,
    stop: bool,
}

impl PanelState {
    fn new() -> Self {
        Self {
            scene: TimelineScene::default(),
            cursor_x: 400.0,
            modifiers_ctrl: false,
            frame_times: Vec::with_capacity(128),
            pending_frame: None,
            applied_frame: None,
            stop: false,
        }
    }

    fn apply_ipc(&mut self, msg: IpcMessage) {
        match msg {
            IpcMessage::Frame { frame } => self.pending_frame = Some(frame),
            IpcMessage::Scene { scene } => {
                let scale = self.applied_frame.map(|f| f.scale.max(1.0)).unwrap_or(1.0);
                let mut scene = scene;
                if let Some(frame) = self.applied_frame {
                    scene.viewport.viewport_width = frame.width * scale;
                    scene.viewport.viewport_height = frame.height * scale;
                }
                self.scene = scene;
            }
            IpcMessage::Stop => self.stop = true,
        }
    }
}

pub fn run_ipc() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Odeon native timeline embed process starting");

    let state = Arc::new(Mutex::new(PanelState::new()));
    let stdin_ready = Arc::new(AtomicBool::new(false));

    {
        let state = state.clone();
        let stdin_ready = stdin_ready.clone();
        thread::Builder::new()
            .name("odeon-timeline-embed-ipc".into())
            .spawn(move || {
                let stdin = std::io::stdin();
                let reader = BufReader::new(stdin.lock());
                for line in reader.lines() {
                    match line {
                        Ok(line) if line.trim().is_empty() => continue,
                        Ok(line) => match serde_json::from_str::<IpcMessage>(&line) {
                            Ok(msg) => {
                                stdin_ready.store(true, Ordering::SeqCst);
                                let stop = matches!(msg, IpcMessage::Stop);
                                if let Ok(mut s) = state.lock() {
                                    s.apply_ipc(msg);
                                }
                                if stop {
                                    break;
                                }
                            }
                            Err(e) => log::warn!("[timeline embed] bad ipc: {e}"),
                        },
                        Err(e) => {
                            log::warn!("[timeline embed] stdin closed: {e}");
                            if let Ok(mut s) = state.lock() {
                                s.stop = true;
                            }
                            break;
                        }
                    }
                }
            })
            .expect("ipc thread");
    }

    let event_loop = EventLoopBuilder::new()
        .with_activation_policy(winit::platform::macos::ActivationPolicy::Prohibited)
        .build()
        .expect("event loop");

    let window = WindowBuilder::new()
        .with_title("Odeon Timeline")
        .with_decorations(false)
        .with_resizable(false)
        .with_visible(false)
        .with_active(false)
        .with_window_level(WindowLevel::AlwaysOnTop)
        .with_inner_size(LogicalSize::new(800.0, 400.0))
        .build(&event_loop)
        .expect("window");

    window.set_cursor_icon(CursorIcon::Default);

    let window = Arc::new(window);
    let mut renderer = pollster::block_on(GpuRenderer::new(window.clone()));
    let mut last_instant = Instant::now();

    event_loop
        .run(move |event, elwt| {
            if state.lock().map(|s| s.stop).unwrap_or(true) {
                elwt.exit();
                return;
            }

            elwt.set_control_flow(ControlFlow::Poll);

            match event {
                Event::WindowEvent { event, window_id }
                    if window_id == window.id() =>
                {
                    match event {
                        WindowEvent::CloseRequested => elwt.exit(),
                        WindowEvent::CursorMoved { position, .. } => {
                            if let Ok(mut s) = state.lock() {
                                s.cursor_x = position.x;
                            }
                        }
                        WindowEvent::ModifiersChanged(m) => {
                            if let Ok(mut s) = state.lock() {
                                s.modifiers_ctrl =
                                    m.state().control_key() || m.state().super_key();
                            }
                        }
                        WindowEvent::MouseWheel { delta, .. } => {
                            if let Ok(mut s) = state.lock() {
                                let ctrl = s.modifiers_ctrl;
                                let anchor = s.cursor_x;
                                let vp = &mut s.scene.viewport;
                                match delta {
                                    MouseScrollDelta::LineDelta(_, y) => {
                                        if ctrl {
                                            vp.apply_wheel_steps(f64::from(y), anchor);
                                        } else {
                                            vp.pan_pixels(f64::from(y) * 40.0);
                                        }
                                    }
                                    MouseScrollDelta::PixelDelta(pos) => {
                                        if ctrl {
                                            vp.apply_wheel_steps(
                                                wheel_steps_from_delta_y(pos.y),
                                                anchor,
                                            );
                                        } else {
                                            vp.pan_pixels(-pos.y);
                                        }
                                    }
                                }
                            }
                            window.request_redraw();
                        }
                        WindowEvent::RedrawRequested => {
                            if let Ok(mut s) = state.lock() {
                                if let Some(frame) = s.pending_frame.take() {
                                    apply_overlay_frame(&window, &mut renderer, &frame);
                                    s.applied_frame = Some(frame);
                                    let scale = frame.scale.max(1.0);
                                    s.scene.viewport.viewport_width = frame.width * scale;
                                    s.scene.viewport.viewport_height = frame.height * scale;
                                    window.set_visible(true);
                                }

                                if s.applied_frame.is_some() {
                                    let frame_ms =
                                        last_instant.elapsed().as_secs_f64() * 1000.0;
                                    last_instant = Instant::now();
                                    s.record_frame_time(frame_ms);
                                    let p99 = s.p99_frame_ms();
                                    renderer.draw_scene(&s.scene, p99);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Event::AboutToWait => {
                    if stdin_ready.load(Ordering::SeqCst) {
                        window.request_redraw();
                    }
                }
                _ => {}
            }
        })
        .expect("event loop run");
}

fn apply_overlay_frame(
    window: &winit::window::Window,
    renderer: &mut GpuRenderer,
    frame: &EmbedFrame,
) {
    let w = frame.width.max(1.0);
    let h = frame.height.max(1.0);

    window.set_outer_position(PhysicalPosition::new(
        frame.x.round() as i32,
        frame.y.round() as i32,
    ));
    let _ = window.request_inner_size(LogicalSize::new(w, h));

    let size = window.inner_size();
    renderer.resize(size.width.max(1), size.height.max(1));

    log::info!(
        "[timeline embed] screen=({:.0},{:.0}) logical={:.0}x{:.0} physical={}x{} scale={:.1}",
        frame.x,
        frame.y,
        w,
        h,
        size.width,
        size.height,
        frame.scale,
    );
}

impl PanelState {
    fn record_frame_time(&mut self, ms: f64) {
        if self.frame_times.len() >= 120 {
            self.frame_times.remove(0);
        }
        self.frame_times.push(ms);
    }

    fn p99_frame_ms(&self) -> f64 {
        if self.frame_times.is_empty() {
            return 0.0;
        }
        let mut sorted = self.frame_times.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let idx = ((sorted.len() as f64 * 0.99).floor() as usize).min(sorted.len() - 1);
        sorted[idx]
    }
}
