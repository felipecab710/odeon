//! macOS embedded timeline — Metal NSView subview inside the Tauri WKWebView.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use cocoa::base::{id, nil, YES};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::Class;
use odeon_timeline::spike::GpuRenderer;
use odeon_timeline::wavecache::{load_wavecache, WaveformCache};
use odeon_timeline::TimelineScene;

use super::EmbedFrame;

#[link(name = "QuartzCore", kind = "framework")]
extern "C" {}

pub struct MacTimelinePanel {
    webview: id,
    host_view: id,
    metal_view: id,
    renderer: GpuRenderer,
    scene: TimelineScene,
    wavecaches: HashMap<String, Arc<WaveformCache>>,
    applied_frame: EmbedFrame,
    pending_frame: Option<EmbedFrame>,
    frame_times: Vec<f64>,
    last_instant: Instant,
    last_emitted_viewport: (f64, f64),
    viewport_dirty: bool,
}

impl MacTimelinePanel {
    pub fn create(webview: *mut std::ffi::c_void, frame: EmbedFrame) -> Result<Self, String> {
        let webview = webview as id;
        if webview.is_null() {
            return Err("null WKWebView".into());
        }

        let host_view = unsafe {
            let superview: id = msg_send![webview, superview];
            if superview.is_null() {
                webview
            } else {
                superview
            }
        };

        let metal_view: id = unsafe {
            let view: id = msg_send![class!(NSView), alloc];
            msg_send![view, initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0))]
        };

        unsafe {
            setup_metal_layer(metal_view, &frame)?;
            let _: () = msg_send![metal_view, setOpaque: YES];
            let ns_rect = frame_to_host_rect(webview, host_view, &frame);
            let _: () = msg_send![metal_view, setFrame: ns_rect];
            let _: () = msg_send![metal_view, setAutoresizingMask: 0];
            // NSWindowAbove = 1 — draw above the WKWebView sibling.
            let _: () = msg_send![host_view, addSubview: metal_view positioned: 1i64 relativeTo: webview];
        }

        let scale = frame.scale.max(1.0);
        let w = frame.width.max(1.0);
        let h = frame.height.max(1.0);
        let pw = (w * scale).round().max(1.0) as u32;
        let ph = (h * scale).round().max(1.0) as u32;

        let mut renderer = pollster::block_on(GpuRenderer::new_from_appkit_view(
            metal_view as *mut _,
            pw,
            ph,
        ));
        renderer.set_logical_size(w as f32, h as f32);
        sync_metal_layer(metal_view, &frame);

        let mut scene = TimelineScene::default();
        scene.viewport.viewport_width = frame.width;
        scene.viewport.viewport_height = frame.height;

        log::info!(
            "[timeline embed] subview logical={:.0}x{:.0} at ({:.0},{:.0}) physical={}x{} scale={:.1}",
            frame.width,
            frame.height,
            frame.x,
            frame.y,
            pw,
            ph,
            scale,
        );

        let initial_viewport = (
            scene.viewport.pixels_per_second,
            scene.viewport.scroll_left,
        );

        Ok(Self {
            webview,
            host_view,
            metal_view,
            renderer,
            scene,
            wavecaches: HashMap::new(),
            applied_frame: frame,
            pending_frame: None,
            frame_times: Vec::with_capacity(128),
            last_instant: Instant::now(),
            last_emitted_viewport: initial_viewport,
            viewport_dirty: false,
        })
    }

    pub fn set_frame(&mut self, frame: EmbedFrame) {
        self.pending_frame = Some(frame);
    }

    pub fn set_scene(&mut self, scene: TimelineScene) {
        let mut scene = scene;
        scene.viewport.viewport_width = self.applied_frame.width;
        scene.viewport.viewport_height = self.applied_frame.height;
        self.last_emitted_viewport = (
            scene.viewport.pixels_per_second,
            scene.viewport.scroll_left,
        );
        self.viewport_dirty = false;
        self.scene = scene;
        self.ensure_wavecaches();
    }

    pub fn set_playhead(&mut self, playhead_sec: f64) {
        self.scene.playhead_sec = playhead_sec;
    }

    pub fn apply_wheel(&mut self, delta_y: f64, ctrl: bool, cursor_x: f64) {
        let vp = &mut self.scene.viewport;
        if ctrl {
            vp.apply_wheel_steps(odeon_timeline::viewport::wheel_steps_from_delta_y(delta_y), cursor_x);
        } else {
            vp.pan_pixels(-delta_y);
        }
        self.viewport_dirty = true;
    }

    pub fn take_viewport_emit(&mut self) -> Option<(f64, f64)> {
        if !self.viewport_dirty {
            return None;
        }
        let vp = &self.scene.viewport;
        let cur = (vp.pixels_per_second, vp.scroll_left);
        if (cur.0 - self.last_emitted_viewport.0).abs() < 1e-6
            && (cur.1 - self.last_emitted_viewport.1).abs() < 0.5
        {
            self.viewport_dirty = false;
            return None;
        }
        self.last_emitted_viewport = cur;
        self.viewport_dirty = false;
        Some(cur)
    }

    pub fn tick(&mut self) {
        if let Some(frame) = self.pending_frame.take() {
            self.apply_frame(frame);
        }

        let frame_ms = self.last_instant.elapsed().as_secs_f64() * 1000.0;
        self.last_instant = Instant::now();
        self.record_frame_time(frame_ms);

        let p99 = self.p99_frame_ms();
        self.ensure_wavecaches();
        self.renderer
            .draw_scene_with_caches(&self.scene, &self.wavecaches, p99);
    }

    fn ensure_wavecaches(&mut self) {
        for clip in &self.scene.clips {
            let Some(ref path) = clip.wavecache_path else {
                continue;
            };
            if self.wavecaches.contains_key(path) {
                continue;
            }
            match load_wavecache(Path::new(path)) {
                Ok(cache) => {
                    log::info!("[timeline embed] loaded wavecache {path}");
                    self.wavecaches.insert(path.clone(), Arc::new(cache));
                }
                Err(e) => {
                    log::warn!("[timeline embed] wavecache {path}: {e:?}");
                }
            }
        }
    }

    pub fn stop(self) {
        unsafe {
            let _: () = msg_send![self.metal_view, removeFromSuperview];
        }
    }

    fn apply_frame(&mut self, frame: EmbedFrame) {
        unsafe {
            let ns_rect = frame_to_host_rect(self.webview, self.host_view, &frame);
            let _: () = msg_send![self.metal_view, setFrame: ns_rect];
        }

        let scale = frame.scale.max(1.0);
        let w = frame.width.max(1.0);
        let h = frame.height.max(1.0);
        let pw = (w * scale).round().max(1.0) as u32;
        let ph = (h * scale).round().max(1.0) as u32;
        self.renderer.resize(pw, ph);
        self.renderer.set_logical_size(w as f32, h as f32);
        sync_metal_layer(self.metal_view, &frame);
        self.scene.viewport.viewport_width = frame.width;
        self.scene.viewport.viewport_height = frame.height;
        self.applied_frame = frame;
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

/// Attach a CAMetalLayer before wgpu touches the view (avoids ObjC throws).
unsafe fn setup_metal_layer(view: id, frame: &EmbedFrame) -> Result<(), String> {
    let metal_cls = Class::get("CAMetalLayer").ok_or("CAMetalLayer unavailable")?;
    let layer: id = msg_send![metal_cls, layer];
    if layer.is_null() {
        return Err("failed to create CAMetalLayer".into());
    }
    let _: () = msg_send![view, setWantsLayer: YES];
    let _: () = msg_send![view, setLayer: layer];
    sync_metal_layer(view, frame);
    Ok(())
}

fn sync_metal_layer(view: id, frame: &EmbedFrame) {
    let scale = frame.scale.max(1.0);
    let pw = (frame.width * scale).round().max(1.0);
    let ph = (frame.height * scale).round().max(1.0);
    unsafe {
        let layer: id = msg_send![view, layer];
        if layer.is_null() {
            return;
        }
        let metal_cls = match Class::get("CAMetalLayer") {
            Some(c) => c,
            None => return,
        };
        let is_metal: bool = msg_send![layer, isKindOfClass: metal_cls];
        if !is_metal {
            return;
        }
        let _: () = msg_send![layer, setContentsScale: scale];
        let drawable = NSSize::new(pw, ph);
        let _: () = msg_send![layer, setDrawableSize: drawable];
    }
}

/// Convert webview-local CSS coords → host view AppKit rect.
fn frame_to_host_rect(webview: id, host_view: id, frame: &EmbedFrame) -> NSRect {
    let web_local = frame_to_webview_rect(webview, frame);
    unsafe {
        msg_send![webview, convertRect: web_local toView: host_view]
    }
}

fn frame_to_webview_rect(webview: id, frame: &EmbedFrame) -> NSRect {
    let w = frame.width.max(1.0);
    let h = frame.height.max(1.0);
    let web_height = unsafe {
        let bounds: NSRect = msg_send![webview, bounds];
        bounds.size.height
    };
    NSRect::new(
        NSPoint::new(frame.x, web_height - frame.y - h),
        NSSize::new(w, h),
    )
}
