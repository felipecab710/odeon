//! Audacity ZoomInfo / SetTimelineContext coordinate math (Rust port).

use serde::{Deserialize, Serialize};

pub const MIN_PX_PER_SEC: f64 = 0.35;
pub const MAX_PX_PER_SEC: f64 = 256.0;
pub const DEFAULT_PX_PER_SEC: f64 = 3.2;
pub const ZOOM_WHEEL_BASE: f64 = 2.0;
pub const ZOOM_WHEEL_STEPS_DIVISOR: f64 = 4.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TimelineViewport {
    pub pixels_per_second: f64,
    pub scroll_left: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub total_sec: f64,
    pub bpm: f64,
    pub beats_per_bar: u32,
}

impl Default for TimelineViewport {
    fn default() -> Self {
        Self {
            pixels_per_second: DEFAULT_PX_PER_SEC,
            scroll_left: 0.0,
            viewport_width: 1280.0,
            viewport_height: 720.0,
            total_sec: 600.0,
            bpm: 128.0,
            beats_per_bar: 4,
        }
    }
}

pub fn max_px_per_sec_for_viewport(viewport_width: f64) -> f64 {
    const ABLETON_CLIP_EDIT_MIN_SEC: f64 = 10.0;
    let w = viewport_width.max(200.0);
    let clip_edit_cap = w / ABLETON_CLIP_EDIT_MIN_SEC;
    clip_edit_cap
        .min(MAX_PX_PER_SEC)
        .max(MIN_PX_PER_SEC + 0.01)
}

impl TimelineViewport {
    pub fn frame_start_time_sec(&self) -> f64 {
        self.scroll_left / self.safe_pps()
    }

    pub fn frame_end_time_sec(&self) -> f64 {
        (self.scroll_left + self.viewport_width) / self.safe_pps()
    }

    pub fn view_time_range(&self, pad_sec: f64) -> (f64, f64) {
        (
            (self.frame_start_time_sec() - pad_sec).max(0.0),
            self.frame_end_time_sec() + pad_sec,
        )
    }

    pub fn time_to_viewport_x(&self, time_sec: f64) -> f64 {
        time_sec * self.pixels_per_second - self.scroll_left
    }

    pub fn viewport_x_to_time_sec(&self, viewport_x: f64) -> f64 {
        (self.scroll_left + viewport_x) / self.safe_pps()
    }

    pub fn clamp_time_sec(&self, time_sec: f64) -> f64 {
        time_sec.clamp(0.0, self.total_sec)
    }

    /// Anchor-preserving zoom — port of `timelineViewportZoom.ts::zoomAtAnchor`.
    pub fn zoom_at_anchor(
        &self,
        factor: f64,
        anchor_viewport_x: f64,
    ) -> Option<(f64, f64)> {
        if !factor.is_finite() || factor <= 0.0 {
            return None;
        }
        let max_pps = max_px_per_sec_for_viewport(self.viewport_width);
        let new_pps = (self.pixels_per_second * factor).clamp(MIN_PX_PER_SEC, max_pps);
        if (new_pps - self.pixels_per_second).abs() < 1e-9 {
            return None;
        }
        let time_at_anchor =
            (self.scroll_left + anchor_viewport_x) / self.pixels_per_second;
        let new_scroll = (time_at_anchor * new_pps - anchor_viewport_x).max(0.0);
        Some((new_pps, new_scroll))
    }

    pub fn zoom_from_wheel_steps(&self, steps: f64, anchor_viewport_x: f64) -> Option<(f64, f64)> {
        if steps.abs() < 1e-9 {
            return None;
        }
        let factor = (ZOOM_WHEEL_BASE).powf(steps / ZOOM_WHEEL_STEPS_DIVISOR);
        self.zoom_at_anchor(factor, anchor_viewport_x)
    }

    pub fn apply_zoom(&mut self, factor: f64, anchor_viewport_x: f64) {
        if let Some((pps, scroll)) = self.zoom_at_anchor(factor, anchor_viewport_x) {
            self.pixels_per_second = pps;
            self.scroll_left = scroll;
        }
    }

    pub fn apply_wheel_steps(&mut self, steps: f64, anchor_viewport_x: f64) {
        if let Some((pps, scroll)) = self.zoom_from_wheel_steps(steps, anchor_viewport_x) {
            self.pixels_per_second = pps;
            self.scroll_left = scroll;
        }
    }

    pub fn pan_pixels(&mut self, delta_px: f64) {
        self.scroll_left = (self.scroll_left + delta_px).max(0.0);
    }

    fn safe_pps(&self) -> f64 {
        self.pixels_per_second.max(1e-9)
    }
}

pub fn wheel_steps_from_delta_y(delta_y: f64) -> f64 {
    const WHEEL_DELTA_PX: f64 = 120.0;
    -delta_y / WHEEL_DELTA_PX
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn zoom_at_anchor_holds_time_under_cursor() {
        let vp = TimelineViewport {
            pixels_per_second: 10.0,
            scroll_left: 100.0,
            viewport_width: 800.0,
            ..Default::default()
        };
        let anchor = 200.0;
        let time_before = vp.viewport_x_to_time_sec(anchor);
        let (new_pps, new_scroll) = vp.zoom_at_anchor(1.5, anchor).unwrap();
        let vp2 = TimelineViewport {
            pixels_per_second: new_pps,
            scroll_left: new_scroll,
            ..vp
        };
        let time_after = vp2.viewport_x_to_time_sec(anchor);
        assert_relative_eq!(time_before, time_after, epsilon = 1e-6);
    }

    #[test]
    fn zoom_clamps_to_limits() {
        let vp = TimelineViewport {
            pixels_per_second: MAX_PX_PER_SEC,
            ..Default::default()
        };
        assert!(vp.zoom_at_anchor(2.0, 100.0).is_none());
    }
}
