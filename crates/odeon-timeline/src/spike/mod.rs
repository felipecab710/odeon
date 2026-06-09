//! Phase 0 native timeline spike — wgpu + winit, single clock, anchor zoom.

mod appkit_surface;
mod renderer;

pub use appkit_surface::AppKitViewSurface;
pub use renderer::GpuRenderer;

use std::sync::{Arc, Mutex};

use winit::dpi::LogicalSize;
use winit::event::{ElementState, Event, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ControlFlow, EventLoop};
use winit::keyboard::{Key, ModifiersState};
use winit::window::{CursorIcon, WindowBuilder};

use crate::grid::{collect_grid_for_viewport, GridKind};
use crate::viewport::{wheel_steps_from_delta_y, TimelineViewport};

pub const BEAT_RULER_H: f32 = 22.0;
pub const TIME_RULER_H: f32 = 20.0;
pub const CLIP_HEADER_H: f32 = 18.0;
pub const LANE_H: f32 = 100.0;

/// Demo clip — one lane for the spike.
#[derive(Debug, Clone, Copy)]
pub struct DemoClip {
    pub start_sec: f64,
    pub duration_sec: f64,
    pub color: [f32; 4],
}

impl Default for DemoClip {
    fn default() -> Self {
        Self {
            start_sec: 32.0,
            duration_sec: 180.0,
            color: [0.22, 0.35, 0.55, 1.0],
        }
    }
}

#[derive(Debug)]
struct SpikeState {
    viewport: TimelineViewport,
    clip: DemoClip,
    playhead_sec: f64,
    cursor_x: f64,
    modifiers: ModifiersState,
    frame_times: Vec<f64>,
}

impl SpikeState {
    fn new(width: f32, height: f32) -> Self {
        Self {
            viewport: TimelineViewport {
                viewport_width: f64::from(width),
                viewport_height: f64::from(height),
                total_sec: 600.0,
                scroll_left: 80.0,
                ..TimelineViewport::default()
            },
            clip: DemoClip::default(),
            playhead_sec: 48.0,
            cursor_x: f64::from(width) * 0.5,
            modifiers: ModifiersState::empty(),
            frame_times: Vec::with_capacity(128),
        }
    }

    fn lane_top(&self) -> f32 {
        BEAT_RULER_H
    }

    fn lane_bottom(&self) -> f32 {
        BEAT_RULER_H + LANE_H
    }

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

/// Entry point for the standalone spike process (must run on main thread on macOS).
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Odeon native timeline spike — Cmd+scroll or pinch to zoom, scroll to pan");

    let event_loop = EventLoop::new().expect("event loop");
    let window = Arc::new(
        WindowBuilder::new()
            .with_title("Odeon Native Timeline (Phase 0 spike)")
            .with_inner_size(LogicalSize::new(1280.0, 200.0))
            .build(&event_loop)
            .expect("window"),
    );

    window.set_cursor_icon(CursorIcon::Default);

    let state = Arc::new(Mutex::new(SpikeState::new(
        window.inner_size().width as f32,
        window.inner_size().height as f32,
    )));

    let mut renderer = pollster::block_on(renderer::GpuRenderer::new(window.clone()));
    let mut last_instant = std::time::Instant::now();

    event_loop
        .run(move |event, elwt| {
            elwt.set_control_flow(ControlFlow::Poll);

            match event {
                Event::WindowEvent { event, window_id } if window_id == window.id() => {
                    match event {
                        WindowEvent::CloseRequested => elwt.exit(),
                        WindowEvent::Resized(size) => {
                            renderer.resize(size.width, size.height);
                            let mut s = state.lock().unwrap();
                            s.viewport.viewport_width = f64::from(size.width);
                            s.viewport.viewport_height = f64::from(size.height);
                            window.request_redraw();
                        }
                        WindowEvent::CursorMoved { position, .. } => {
                            state.lock().unwrap().cursor_x = position.x;
                        }
                        WindowEvent::ModifiersChanged(m) => {
                            state.lock().unwrap().modifiers = m.state();
                        }
                        WindowEvent::MouseWheel { delta, .. } => {
                            let mut s = state.lock().unwrap();
                            let ctrl = s.modifiers.control_key() || s.modifiers.super_key();
                            let anchor = s.cursor_x;
                            match delta {
                                MouseScrollDelta::LineDelta(_, y) => {
                                    if ctrl {
                                        s.viewport.apply_wheel_steps(f64::from(y), anchor);
                                    } else {
                                        s.viewport.pan_pixels(f64::from(y) * 40.0);
                                    }
                                }
                                MouseScrollDelta::PixelDelta(pos) => {
                                    let dy = pos.y;
                                    if ctrl {
                                        s.viewport.apply_wheel_steps(
                                            wheel_steps_from_delta_y(dy),
                                            anchor,
                                        );
                                    } else {
                                        s.viewport.pan_pixels(-dy);
                                    }
                                }
                            }
                            window.request_redraw();
                        }
                        WindowEvent::KeyboardInput { event, .. } => {
                            if event.state == ElementState::Pressed {
                                match event.logical_key {
                                    Key::Character(ref c) if c.as_str() == "r" => {
                                        let mut s = state.lock().unwrap();
                                        s.viewport.pixels_per_second =
                                            crate::viewport::DEFAULT_PX_PER_SEC;
                                        s.viewport.scroll_left = 0.0;
                                        window.request_redraw();
                                    }
                                    _ => {}
                                }
                            }
                        }
                        WindowEvent::RedrawRequested => {
                            let frame_ms = last_instant.elapsed().as_secs_f64() * 1000.0;
                            last_instant = std::time::Instant::now();

                            let mut s = state.lock().unwrap();
                            s.record_frame_time(frame_ms);

                            let grid = collect_grid_for_viewport(&s.viewport);
                            let p99 = s.p99_frame_ms();

                            renderer.draw(
                                &s.viewport,
                                &grid,
                                s.clip,
                                s.playhead_sec,
                                s.lane_top(),
                                s.lane_bottom(),
                                p99,
                            );
                        }
                        _ => {}
                    }
                }
                Event::AboutToWait => {
                    window.request_redraw();
                }
                _ => {}
            }
        })
        .expect("event loop run");
}

pub fn grid_line_color(kind: GridKind) -> [f32; 4] {
    match kind {
        GridKind::Bar => [1.0, 1.0, 1.0, 0.11],
        GridKind::SubBar => [1.0, 1.0, 1.0, 0.045],
        GridKind::Beat => [1.0, 1.0, 1.0, 0.065],
        GridKind::Half => [1.0, 1.0, 1.0, 0.035],
        GridKind::Quarter => [1.0, 1.0, 1.0, 0.02],
    }
}
