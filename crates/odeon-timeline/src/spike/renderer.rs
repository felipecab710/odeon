//! wgpu renderer — one pass: background, grid, clip, waveform, playhead, HUD.

use std::sync::Arc;

use wgpu::SurfaceTargetUnsafe;
use winit::window::Window;

use crate::grid::{collect_grid_for_viewport, GridKind, GridLine};
use crate::scene::{TimelineClip, TimelineLaneMetrics, TimelineScene};
use crate::spike::{grid_line_color, AppKitViewSurface, DemoClip, BEAT_RULER_H, CLIP_HEADER_H, TIME_RULER_H};
use crate::viewport::TimelineViewport;

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    pos: [f32; 2],
    color: [f32; 4],
}

pub struct GpuRenderer {
    _surface_owner: SurfaceOwner,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    fill_pipeline: wgpu::RenderPipeline,
    fill_vertex_buffer: wgpu::Buffer,
    line_vertex_buffer: wgpu::Buffer,
    vertex_capacity: usize,
    width: u32,
    height: u32,
    logical_width: f32,
    logical_height: f32,
}

enum SurfaceOwner {
    Winit(Arc<Window>),
    AppKit(Arc<AppKitViewSurface>),
}

impl GpuRenderer {
    pub async fn new(window: Arc<Window>) -> Self {
        let size = window.inner_size();
        Self::from_surface_target(
            SurfaceOwner::Winit(window),
            size.width.max(1),
            size.height.max(1),
        )
        .await
    }

    pub async fn new_from_appkit_view(view: *mut std::ffi::c_void, width: u32, height: u32) -> Self {
        let owner = Arc::new(
            AppKitViewSurface::new(view).expect("valid NSView for timeline embed"),
        );
        Self::from_surface_target(SurfaceOwner::AppKit(owner), width.max(1), height.max(1)).await
    }

    async fn from_surface_target(owner: SurfaceOwner, width: u32, height: u32) -> Self {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let surface = match &owner {
            SurfaceOwner::Winit(window) => instance
                .create_surface(wgpu::SurfaceTarget::from(window.clone()))
                .expect("surface"),
            SurfaceOwner::AppKit(view) => unsafe {
                let target = SurfaceTargetUnsafe::from_window(&**view)
                    .expect("appkit surface target");
                instance
                    .create_surface_unsafe(target)
                    .expect("appkit surface")
            },
        };

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .expect("adapter");

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("odeon-timeline"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("device");

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);

        let mut alpha_mode = caps
            .alpha_modes
            .iter()
            .copied()
            .find(|m| *m == wgpu::CompositeAlphaMode::Opaque)
            .unwrap_or(caps.alpha_modes[0]);
        if matches!(&owner, SurfaceOwner::AppKit(_)) {
            alpha_mode = caps
                .alpha_modes
                .iter()
                .copied()
                .find(|m| *m == wgpu::CompositeAlphaMode::PreMultiplied)
                .unwrap_or(alpha_mode);
        }

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1),
            height: height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("colored_vert"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4],
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("line_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[vertex_layout.clone()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let fill_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("tri_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[vertex_layout],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let vertex_capacity = 32_768;
        let buf_size = (vertex_capacity * std::mem::size_of::<Vertex>()) as u64;
        let fill_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("fill_vertices"),
            size: buf_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let line_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("line_vertices"),
            size: buf_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            _surface_owner: owner,
            surface,
            device,
            queue,
            config,
            pipeline,
            fill_pipeline,
            fill_vertex_buffer,
            line_vertex_buffer,
            vertex_capacity,
            width,
            height,
            logical_width: width as f32,
            logical_height: height as f32,
        }
    }

    /// Set the logical layout size (CSS points). The surface may be larger on Retina.
    pub fn set_logical_size(&mut self, width: f32, height: f32) {
        self.logical_width = width.max(1.0);
        self.logical_height = height.max(1.0);
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width > 0 && height > 0 {
            self.width = width;
            self.height = height;
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    pub fn draw_scene(
        &mut self,
        scene: &TimelineScene,
        p99_ms: f64,
    ) {
        self.draw_scene_with_caches(scene, &std::collections::HashMap::new(), p99_ms);
    }

    #[cfg(feature = "wavecache")]
    pub fn draw_scene_with_caches(
        &mut self,
        scene: &TimelineScene,
        wavecaches: &std::collections::HashMap<String, std::sync::Arc<crate::wavecache::WaveformCache>>,
        p99_ms: f64,
    ) {
        let grid = collect_grid_for_viewport(&scene.viewport);
        self.draw_internal(scene, &grid, p99_ms, Some(wavecaches));
    }

    #[cfg(not(feature = "wavecache"))]
    pub fn draw_scene_with_caches(
        &mut self,
        scene: &TimelineScene,
        _wavecaches: &std::collections::HashMap<String, std::sync::Arc<()>>,
        p99_ms: f64,
    ) {
        let grid = collect_grid_for_viewport(&scene.viewport);
        self.draw_internal(scene, &grid, p99_ms, None);
    }

    pub fn draw(
        &mut self,
        vp: &TimelineViewport,
        grid: &[GridLine],
        clip: DemoClip,
        playhead_sec: f64,
        lane_top: f32,
        lane_bottom: f32,
        p99_ms: f64,
    ) {
        let scene = TimelineScene {
            viewport: *vp,
            clips: vec![TimelineClip {
                start_sec: clip.start_sec,
                duration_sec: clip.duration_sec,
                lane_index: 0,
                lane_count: 1,
                color: clip.color,
                wave_color: [0.08, 0.08, 0.08, 1.0],
                wavecache_path: None,
                label: String::new(),
                badge: String::new(),
                label_color: [0.97, 0.97, 0.97, 1.0],
            }],
            playhead_sec,
            cursor_sec: None,
            selected_lane_index: None,
            lane_metrics: vec![TimelineLaneMetrics {
                y: lane_top,
                height: (lane_bottom - lane_top).max(1.0),
            }],
            locators: Vec::new(),
            dom_rulers: false,
        };
        self.draw_internal(&scene, grid, p99_ms, None);
    }

    fn draw_internal(
        &mut self,
        scene: &TimelineScene,
        grid: &[GridLine],
        p99_ms: f64,
        #[cfg(feature = "wavecache")] wavecaches: Option<
            &std::collections::HashMap<String, std::sync::Arc<crate::wavecache::WaveformCache>>,
        >,
        #[cfg(not(feature = "wavecache"))] _wavecaches: Option<
            &std::collections::HashMap<String, std::sync::Arc<()>>,
        >,
    ) {
        let vp = &scene.viewport;
        let clips = &scene.clips;
        let playhead_sec = scene.playhead_sec;
        let w = self.logical_width;
        let h = self.logical_height;
        if w < 1.0 || h < 1.0 {
            return;
        }

        let mut tris: Vec<Vertex> = Vec::new();
        let mut lines: Vec<Vertex> = Vec::new();

        let dom_rulers = scene.dom_rulers;
        let lane_area_top = if dom_rulers { 0.0 } else { BEAT_RULER_H };
        let lane_area_bottom = if dom_rulers { h } else { h - TIME_RULER_H };
        let lane_area_h = (lane_area_bottom - lane_area_top).max(1.0);

        if dom_rulers {
            for (i, m) in scene.lane_metrics.iter().enumerate() {
                let bg = if i % 2 == 1 {
                    [0.11, 0.11, 0.11, 1.0]
                } else {
                    [0.165, 0.165, 0.165, 1.0]
                };
                push_rect_tris(&mut tris, 0.0, m.y, w, m.y + m.height, bg, w, h);
            }
        } else {
            push_rect_tris(&mut tris, 0.0, 0.0, w, h, [0.06, 0.06, 0.06, 1.0], w, h);
            push_rect_tris(&mut tris, 0.0, 0.0, w, BEAT_RULER_H, [0.04, 0.04, 0.04, 1.0], w, h);
            push_rect_tris(
                &mut tris,
                0.0,
                lane_area_top,
                w,
                lane_area_bottom,
                [0.165, 0.165, 0.165, 1.0],
                w,
                h,
            );
            for (i, m) in scene.lane_metrics.iter().enumerate() {
                if i % 2 != 1 {
                    continue;
                }
                push_rect_tris(
                    &mut tris,
                    0.0,
                    m.y,
                    w,
                    m.y + m.height,
                    [0.11, 0.11, 0.11, 1.0],
                    w,
                    h,
                );
            }
        }
        if !dom_rulers {
            push_rect_tris(
                &mut tris,
                0.0,
                h - TIME_RULER_H,
                w,
                h,
                [0.04, 0.04, 0.04, 1.0],
                w,
                h,
            );
        }

        for line in grid {
            let x = vp.time_to_viewport_x(line.time_sec) as f32;
            if x < -2.0 || x > w + 2.0 {
                continue;
            }
            let color = grid_line_color(line.kind);
            push_vline(&mut lines, x, lane_area_top, lane_area_bottom, w, h, color);
            if !dom_rulers {
                if line.kind == GridKind::Bar {
                    push_vline(&mut lines, x, 0.0, BEAT_RULER_H, w, h, [0.55, 0.55, 0.55, 0.85]);
                    push_hline(&mut lines, x - 6.0, x + 6.0, BEAT_RULER_H - 1.0, w, h, [0.7, 0.7, 0.7, 0.9]);
                } else if line.kind == GridKind::Beat {
                    push_vline(&mut lines, x, BEAT_RULER_H - 6.0, BEAT_RULER_H, w, h, [0.35, 0.35, 0.35, 0.7]);
                }
            }
        }

        for loc in &scene.locators {
            let x = vp.time_to_viewport_x(loc.time_sec) as f32;
            if x < -2.0 || x > w + 2.0 {
                continue;
            }
            push_vline(
                &mut lines,
                x,
                0.0,
                lane_area_bottom,
                w,
                h,
                [0.95, 0.55, 0.15, 0.75],
            );
        }

        if !dom_rulers {
            push_time_ruler_ticks(&mut lines, vp, w, h);
        }

        for clip in clips {
            let (lane_top, lane_bottom) = lane_bounds(
                clip.lane_index,
                clip.lane_count,
                &scene.lane_metrics,
                lane_area_top,
                lane_area_h,
            );

            let x0 = vp.time_to_viewport_x(clip.start_sec) as f32;
            let x1 = vp.time_to_viewport_x(clip.start_sec + clip.duration_sec) as f32;
            if x1 > 0.0 && x0 < w {
                let pad = 4.0;
                let inner_top = lane_top + pad;
                let inner_bottom = lane_bottom - pad;
                let header_bottom = (inner_top + CLIP_HEADER_H).min(inner_bottom);
                let body_top = header_bottom;
                let base = [clip.color[0], clip.color[1], clip.color[2], 1.0];
                let wave_color = clip.wave_color;

                // Ableton-style vertical clip gradient (matches DOM arrangementClipBackground).
                push_arrangement_clip_gradient(
                    &mut tris,
                    x0,
                    inner_top,
                    x1,
                    inner_bottom,
                    base,
                    w,
                    h,
                );
                if header_bottom > inner_top + 0.5 {
                    push_header_shimmer(
                        &mut tris,
                        x0,
                        inner_top,
                        x1,
                        header_bottom,
                        base,
                        w,
                        h,
                    );
                }

                let border = [0.0, 0.0, 0.0, 0.45];
                push_hline(&mut lines, x0, x1, inner_top, w, h, border);
                push_hline(&mut lines, x0, x1, inner_bottom, w, h, border);
                push_vline(&mut lines, x0, inner_top, inner_bottom, w, h, border);
                push_vline(&mut lines, x1, inner_top, inner_bottom, w, h, border);
                push_hline(&mut lines, x0, x1, header_bottom, w, h, [0.0, 0.0, 0.0, 0.25]);

                let text_scale = 1.0;
                let text_y = inner_top + 4.0;
                let label_color = clip.label_color;
                let mut text_x = x0 + 7.0;
                if !clip.badge.is_empty() {
                    let badge_w = clip.badge.len() as f32 * 6.0 * text_scale + 6.0;
                    push_rect_tris(
                        &mut tris,
                        text_x - 2.0,
                        inner_top + 2.0,
                        text_x + badge_w,
                        inner_top + 14.0,
                        [0.0, 0.0, 0.0, 0.22],
                        w,
                        h,
                    );
                    crate::bitmap_font::push_text(
                        &mut tris,
                        text_x,
                        text_y,
                        text_scale,
                        label_color,
                        w,
                        h,
                        &clip.badge,
                        badge_w,
                        |tris, x0, y0, x1, y1, color, cw, ch| {
                            push_rect_tris(tris, x0, y0, x1, y1, color, cw, ch);
                        },
                    );
                    text_x += badge_w + 4.0;
                }
                if !clip.label.is_empty() {
                    let title_w = (x1 - text_x - 8.0).max(0.0);
                    if title_w > 6.0 {
                        crate::bitmap_font::push_text(
                            &mut tris,
                            text_x,
                            text_y,
                            text_scale,
                            label_color,
                            w,
                            h,
                            &clip.label,
                            title_w,
                            |tris, x0, y0, x1, y1, color, cw, ch| {
                                push_rect_tris(tris, x0, y0, x1, y1, color, cw, ch);
                            },
                        );
                    }
                }

                let grip = [1.0, 1.0, 1.0, 0.28];
                for i in 0..3i32 {
                    let gx = x0 + 3.0 + i as f32 * 2.0;
                    push_vline(&mut lines, gx, inner_top + 5.0, inner_bottom - 5.0, w, h, grip);
                    let gx_r = x1 - 8.0 + i as f32 * 2.0;
                    push_vline(&mut lines, gx_r, inner_top + 5.0, inner_bottom - 5.0, w, h, grip);
                }

                let wave_top = body_top + 2.0;
                let wave_bottom = inner_bottom - 2.0;
                let mut drew = false;
                #[cfg(feature = "wavecache")]
                if let (Some(caches), Some(ref path)) = (wavecaches, &clip.wavecache_path) {
                    if let Some(cache) = caches.get(path) {
                        push_waveform_cached(
                            &mut tris,
                            &mut lines,
                            x0,
                            clip.start_sec,
                            clip.duration_sec,
                            vp.pixels_per_second,
                            cache,
                            wave_top,
                            wave_bottom,
                            w,
                            h,
                            wave_color,
                        );
                        drew = true;
                    }
                }
                if !drew {
                    push_waveform(
                        &mut tris,
                        &mut lines,
                        vp,
                        clip.start_sec,
                        clip.duration_sec,
                        wave_top,
                        wave_bottom,
                        w,
                        h,
                        wave_color,
                    );
                }
            }
        }

        if let Some(idx) = scene.selected_lane_index {
            if let Some(m) = scene.lane_metrics.get(idx as usize) {
                let sel_color = [1.0, 1.0, 1.0, 0.22];
                push_hline(&mut lines, 0.0, w, m.y + 1.0, w, h, sel_color);
                push_hline(&mut lines, 0.0, w, m.y + m.height - 1.0, w, h, sel_color);
            }
        }

        if let Some(cursor_sec) = scene.cursor_sec {
            let cx = vp.time_to_viewport_x(cursor_sec) as f32;
            if cx >= 0.0 && cx <= w {
                push_vline(
                    &mut lines,
                    cx,
                    lane_area_top,
                    lane_area_bottom,
                    w,
                    h,
                    [0.75, 0.75, 0.75, 0.45],
                );
            }
        }

        let phx = vp.time_to_viewport_x(playhead_sec) as f32;
        if phx >= 0.0 && phx <= w {
            push_vline(
                &mut lines,
                phx,
                0.0,
                h,
                w,
                h,
                [0.36, 0.78, 0.91, 0.95],
            );
        }

        let hud_color = if p99_ms < 8.3 {
            [0.2, 0.8, 0.4, 0.9]
        } else {
            [0.9, 0.3, 0.2, 0.9]
        };
        push_rect_tris(&mut tris, w - 72.0, 4.0, w - 4.0, 12.0, hud_color, w, h);

        let frame = match self.surface.get_current_texture() {
            Ok(f) => f,
            Err(wgpu::SurfaceError::Lost) => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                log::error!("wgpu out of memory");
                return;
            }
            Err(e) => {
                log::warn!("surface error: {e:?}");
                return;
            }
        };

        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });

        let clear = if dom_rulers {
            wgpu::Color { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }
        } else {
            wgpu::Color { r: 0.06, g: 0.06, b: 0.06, a: 1.0 }
        };

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });

            if !tris.is_empty() {
                let count = (tris.len() / 3 * 3).min(self.vertex_capacity);
                if count >= 3 {
                    self.queue.write_buffer(
                        &self.fill_vertex_buffer,
                        0,
                        bytemuck::cast_slice(&tris[..count]),
                    );
                    pass.set_pipeline(&self.fill_pipeline);
                    pass.set_vertex_buffer(0, self.fill_vertex_buffer.slice(..));
                    pass.draw(0..count as u32, 0..1);
                }
            }

            if !lines.is_empty() {
                let count = (lines.len() / 2 * 2).min(self.vertex_capacity);
                if count >= 2 {
                    self.queue.write_buffer(
                        &self.line_vertex_buffer,
                        0,
                        bytemuck::cast_slice(&lines[..count]),
                    );
                    pass.set_pipeline(&self.pipeline);
                    pass.set_vertex_buffer(0, self.line_vertex_buffer.slice(..));
                    pass.draw(0..count as u32, 0..1);
                }
            }
        }

        self.queue.submit(Some(encoder.finish()));
        frame.present();
    }
}

fn px_to_clip(x: f32, y: f32, w: f32, h: f32) -> [f32; 2] {
    [(x / w) * 2.0 - 1.0, 1.0 - (y / h) * 2.0]
}

fn push_vline(
    out: &mut Vec<Vertex>,
    x: f32,
    y0: f32,
    y1: f32,
    w: f32,
    h: f32,
    color: [f32; 4],
) {
    if x < 0.0 || x > w {
        return;
    }
    let y_lo = y0.min(y1).max(0.0).min(h);
    let y_hi = y0.max(y1).max(0.0).min(h);
    if y_hi <= y_lo {
        return;
    }
    out.push(Vertex {
        pos: px_to_clip(x, y_lo, w, h),
        color,
    });
    out.push(Vertex {
        pos: px_to_clip(x, y_hi, w, h),
        color,
    });
}

fn push_rect_tris(
    out: &mut Vec<Vertex>,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    color: [f32; 4],
    w: f32,
    h: f32,
) {
    let x_lo = x0.min(x1).max(0.0).min(w);
    let x_hi = x0.max(x1).max(0.0).min(w);
    let y_lo = y0.min(y1).max(0.0).min(h);
    let y_hi = y0.max(y1).max(0.0).min(h);
    if x_hi <= x_lo + 0.5 || y_hi <= y_lo + 0.5 {
        return;
    }
    let tl = px_to_clip(x_lo, y_lo, w, h);
    let tr = px_to_clip(x_hi, y_lo, w, h);
    let bl = px_to_clip(x_lo, y_hi, w, h);
    let br = px_to_clip(x_hi, y_hi, w, h);
    out.push(Vertex { pos: tl, color });
    out.push(Vertex { pos: tr, color });
    out.push(Vertex { pos: bl, color });
    out.push(Vertex { pos: tr, color });
    out.push(Vertex { pos: br, color });
    out.push(Vertex { pos: bl, color });
}

fn lane_bounds(
    lane_index: u32,
    lane_count: u32,
    metrics: &[TimelineLaneMetrics],
    area_top: f32,
    area_h: f32,
) -> (f32, f32) {
    if let Some(m) = metrics.get(lane_index as usize) {
        return (m.y, m.y + m.height);
    }
    let lanes = lane_count.max(1) as f32;
    let lane_h = area_h / lanes;
    let top = area_top + lane_h * lane_index as f32;
    (top, top + lane_h)
}

fn push_hline(
    out: &mut Vec<Vertex>,
    x0: f32,
    x1: f32,
    y: f32,
    w: f32,
    h: f32,
    color: [f32; 4],
) {
    let y = y.max(0.0).min(h);
    let x_lo = x0.min(x1).max(0.0).min(w);
    let x_hi = x0.max(x1).max(0.0).min(w);
    if x_hi <= x_lo {
        return;
    }
    let p0 = px_to_clip(x_lo, y, w, h);
    let p1 = px_to_clip(x_hi, y, w, h);
    out.push(Vertex { pos: p0, color });
    out.push(Vertex { pos: p1, color });
}

fn shade_color(color: [f32; 4], factor: f32) -> [f32; 4] {
    [
        (color[0] * factor).min(1.0),
        (color[1] * factor).min(1.0),
        (color[2] * factor).min(1.0),
        color[3],
    ]
}

/// JS shadeHex — multiply RGB by (1 + amount).
fn shade_color_amount(color: [f32; 4], amount: f32) -> [f32; 4] {
    shade_color(color, 1.0 + amount)
}

fn lerp_color(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

fn sample_clip_gradient(base: [f32; 4], t: f32) -> [f32; 4] {
    let top = shade_color_amount(base, 0.06);
    let bot = shade_color_amount(base, -0.1);
    if t <= 0.55 {
        lerp_color(top, base, t / 0.55)
    } else {
        lerp_color(base, bot, (t - 0.55) / 0.45)
    }
}

fn push_arrangement_clip_gradient(
    tris: &mut Vec<Vertex>,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    base: [f32; 4],
    w: f32,
    h: f32,
) {
    const BANDS: usize = 10;
    let band_h = (y1 - y0) / BANDS as f32;
    for band in 0..BANDS {
        let t = (band as f32 + 0.5) / BANDS as f32;
        let cy0 = y0 + band as f32 * band_h;
        let cy1 = cy0 + band_h;
        push_rect_tris(tris, x0, cy0, x1, cy1, sample_clip_gradient(base, t), w, h);
    }
}

fn push_header_shimmer(
    tris: &mut Vec<Vertex>,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    base: [f32; 4],
    w: f32,
    h: f32,
) {
    const BANDS: usize = 4;
    let top = shade_color_amount(base, -0.08);
    let clip_top = shade_color_amount(base, 0.06);
    let band_h = (y1 - y0) / BANDS as f32;
    for band in 0..BANDS {
        let t = band as f32 / (BANDS - 1).max(1) as f32;
        let cy0 = y0 + band as f32 * band_h;
        let cy1 = cy0 + band_h;
        push_rect_tris(tris, x0, cy0, x1, cy1, lerp_color(top, clip_top, t), w, h);
    }
}

fn push_time_ruler_ticks(out: &mut Vec<Vertex>, vp: &TimelineViewport, w: f32, h: f32) {
    let y = h - TIME_RULER_H;
    let pps = vp.pixels_per_second.max(1e-9);
    let interval = if pps * 60.0 >= 80.0 {
        60.0
    } else if pps * 30.0 >= 60.0 {
        30.0
    } else if pps * 10.0 >= 40.0 {
        10.0
    } else {
        5.0
    };
    let (start, end) = vp.view_time_range(0.0);
    let mut t = (start / interval).floor() * interval;
    while t <= end {
        let x = vp.time_to_viewport_x(t) as f32;
        if x >= 0.0 && x <= w {
            push_vline(out, x, y, y + TIME_RULER_H, w, h, [0.45, 0.45, 0.45, 0.8]);
            push_hline(out, x - 4.0, x + 4.0, y + TIME_RULER_H - 2.0, w, h, [0.55, 0.55, 0.55, 0.9]);
        }
        t += interval;
    }
}

fn push_waveform_column(
    tris: &mut Vec<Vertex>,
    x0: f32,
    x1: f32,
    y_top: f32,
    y_bot: f32,
    w: f32,
    h: f32,
    color: [f32; 4],
) {
    if x1 <= x0 {
        return;
    }
    let y_lo = y_top.min(y_bot).max(0.0).min(h);
    let y_hi = y_top.max(y_bot).max(0.0).min(h);
    if y_hi <= y_lo + 0.5 {
        return;
    }
    let fill = [color[0], color[1], color[2], color[3].min(0.92)];
    push_rect_tris(tris, x0, y_lo, x1, y_hi, fill, w, h);
}

const WAVEFORM_GAIN: f32 = 1.85;
const STEREO_HALF_FRAC: f32 = 0.44;

fn push_waveform(
    tris: &mut Vec<Vertex>,
    out: &mut Vec<Vertex>,
    vp: &TimelineViewport,
    start_sec: f64,
    duration_sec: f64,
    top: f32,
    bottom: f32,
    w: f32,
    h: f32,
    color: [f32; 4],
) {
    let mid = (top + bottom) * 0.5;
    let half = (bottom - top) * 0.45;
    let x0 = vp.time_to_viewport_x(start_sec) as f32;
    let x1 = vp.time_to_viewport_x(start_sec + duration_sec) as f32;
    if x1 <= x0 {
        return;
    }

    let samples = ((x1 - x0).max(2.0) as usize).min(512);
    let mut prev: Option<(f32, f32, f32)> = None;

    for i in 0..samples {
        let t = i as f64 / (samples - 1).max(1) as f64;
        let time = start_sec + duration_sec * t;
        let x = vp.time_to_viewport_x(time) as f32;
        if x < -4.0 || x > w + 4.0 {
            prev = None;
            continue;
        }
        let phase = (time * 3.7).sin() * 0.6 + (time * 11.3).sin() * 0.25;
        let peak = (phase.abs() * 0.7 + 0.15).min(1.0) as f32 * WAVEFORM_GAIN;
        let y_top = mid - peak.min(1.0) * half;
        let y_bot = mid + peak.min(1.0) * half;
        if let Some((px, py_top, py_bot)) = prev {
            push_waveform_column(tris, px, x, py_top, py_bot, w, h, color);
            out.push(Vertex { pos: px_to_clip(px, py_top, w, h), color });
            out.push(Vertex { pos: px_to_clip(x, y_top, w, h), color });
        }
        prev = Some((x, y_top, y_bot));
    }
}

#[cfg(feature = "wavecache")]
fn push_waveform_cached(
    tris: &mut Vec<Vertex>,
    out: &mut Vec<Vertex>,
    clip_x0: f32,
    _clip_start_sec: f64,
    clip_duration_sec: f64,
    pixels_per_second: f64,
    cache: &crate::wavecache::WaveformCache,
    top: f32,
    bottom: f32,
    w: f32,
    h: f32,
    color: [f32; 4],
) {
    let wave_h = bottom - top;
    let mid = top + wave_h * 0.5;
    let half_h = (wave_h * 0.25) * STEREO_HALF_FRAC;
    let left_center = top + wave_h * 0.25;
    let right_center = top + wave_h * 0.75;
    let clip_w_px = (clip_duration_sec * pixels_per_second).max(2.0) as f32;
    let columns = crate::wavecache::clip_stereo_peak_columns(
        cache,
        0.0,
        clip_duration_sec.min(cache.duration_sec),
        pixels_per_second,
        (clip_w_px.max(2.0) as usize).min(4096),
    );
    if columns.is_empty() {
        return;
    }
    let col_w = (clip_w_px / columns.len() as f32).max(1.0);
    let fill = [color[0], color[1], color[2], color[3].min(0.95)];
    let outline = shade_color(color, 0.72);

    for (local_x, lm, lx, rm, rx) in columns {
        let x0 = clip_x0 + local_x;
        if x0 > w + 4.0 {
            continue;
        }
        let x1 = (x0 + col_w).min(w);
        if x1 <= x0 {
            continue;
        }
        let l_top = left_center - (lx * WAVEFORM_GAIN).clamp(-1.0, 1.0) * half_h;
        let l_bot = left_center - (lm * WAVEFORM_GAIN).clamp(-1.0, 1.0) * half_h;
        let r_top = right_center - (rx * WAVEFORM_GAIN).clamp(-1.0, 1.0) * half_h;
        let r_bot = right_center - (rm * WAVEFORM_GAIN).clamp(-1.0, 1.0) * half_h;
        push_rect_tris(tris, x0, l_top.min(l_bot), x1, l_top.max(l_bot), fill, w, h);
        push_rect_tris(tris, x0, r_top.min(r_bot), x1, r_top.max(r_bot), fill, w, h);
        let edge_y = l_top.min(r_top);
        push_hline(out, x0, x1, edge_y, w, h, outline);
    }

    push_hline(
        out,
        clip_x0.max(0.0),
        (clip_x0 + clip_w_px).min(w),
        mid,
        w,
        h,
        [0.0, 0.0, 0.0, 0.22],
    );
}
