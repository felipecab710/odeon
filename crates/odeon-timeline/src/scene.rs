//! Timeline scene description shared between embed host and renderer.

use serde::{Deserialize, Serialize};

use crate::viewport::TimelineViewport;

fn default_wave_color() -> [f32; 4] {
    [0.08, 0.08, 0.08, 1.0]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineLocator {
    pub time_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineLaneMetrics {
    pub y: f32,
    pub height: f32,
    /// Wave band height from lane top (header + waveform) — remainder is automation.
    #[serde(default)]
    pub wave_height: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineClip {
    pub start_sec: f64,
    pub duration_sec: f64,
    pub lane_index: u32,
    pub lane_count: u32,
    pub color: [f32; 4],
    /// Waveform fill — dark grey on clip body (DOM uses #141414).
    #[serde(default = "default_wave_color")]
    pub wave_color: [f32; 4],
    /// Path to `.odeon.wavecache` sidecar (optional).
    #[serde(default)]
    pub wavecache_path: Option<String>,
    /// Clip title (truncated in renderer).
    #[serde(default)]
    pub label: String,
    /// Short badge e.g. Camelot key.
    #[serde(default)]
    pub badge: String,
    /// Label text colour (RGBA 0–1).
    #[serde(default = "default_label_color")]
    pub label_color: [f32; 4],
}

fn default_label_color() -> [f32; 4] {
    [0.97, 0.97, 0.97, 1.0]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineScene {
    pub viewport: TimelineViewport,
    pub clips: Vec<TimelineClip>,
    pub playhead_sec: f64,
    /// Edit cursor (hover) — optional dashed line.
    #[serde(default)]
    pub cursor_sec: Option<f64>,
    /// Selected lane highlight.
    #[serde(default)]
    pub selected_lane_index: Option<u32>,
    /// Per-lane layout in viewport coordinates (includes beat ruler offset).
    #[serde(default)]
    pub lane_metrics: Vec<TimelineLaneMetrics>,
    /// Arrangement locators (vertical markers).
    #[serde(default)]
    pub locators: Vec<TimelineLocator>,
    /// When true, beat/time rulers are drawn by DOM — GPU paints lane area only.
    #[serde(default)]
    pub dom_rulers: bool,
}

impl Default for TimelineScene {
    fn default() -> Self {
        Self {
            viewport: TimelineViewport::default(),
            clips: Vec::new(),
            playhead_sec: 0.0,
            cursor_sec: None,
            selected_lane_index: None,
            lane_metrics: Vec::new(),
            locators: Vec::new(),
            dom_rulers: false,
        }
    }
}
