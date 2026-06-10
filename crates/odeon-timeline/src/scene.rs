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
pub struct TimelineDeckStrip {
    pub lane_index: u32,
    pub color: [f32; 4],
    #[serde(default)]
    pub deck_label: String,
    /// Track title (truncated in strip).
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub selected: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub cue: bool,
    #[serde(default)]
    pub show_automation: bool,
    #[serde(default)]
    pub automation_expanded: bool,
    /// Fader travel 0 = bottom (∞), 1 = top (+12 dB).
    #[serde(default = "default_fader_pos")]
    pub fader_pos: f32,
}

fn default_fader_pos() -> f32 {
    0.34
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineAutomationPoint {
    pub time_sec: f64,
    pub value_norm: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineAutomationLane {
    pub lane_index: u32,
    pub color: [f32; 4],
    #[serde(default)]
    pub visible: bool,
    /// Active parameter label (e.g. "Track Volume").
    #[serde(default)]
    pub param_label: String,
    /// Breakpoints for the active automation lane.
    #[serde(default)]
    pub keyframes: Vec<TimelineAutomationPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTransition {
    pub start_sec: f64,
    pub end_sec: f64,
    pub from_lane_index: u32,
    pub to_lane_index: u32,
    #[serde(default)]
    pub selected: bool,
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
    /// Left deck-strip column width (pixels). Timeline content starts after this.
    #[serde(default)]
    pub lane_strip_width: f32,
    /// Per-deck strip chrome drawn in the left column (same lane_metrics Y positions).
    #[serde(default)]
    pub deck_strips: Vec<TimelineDeckStrip>,
    #[serde(default)]
    pub automation_lanes: Vec<TimelineAutomationLane>,
    #[serde(default)]
    pub transitions: Vec<TimelineTransition>,
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
            lane_strip_width: 0.0,
            deck_strips: Vec::new(),
            automation_lanes: Vec::new(),
            transitions: Vec::new(),
        }
    }
}
