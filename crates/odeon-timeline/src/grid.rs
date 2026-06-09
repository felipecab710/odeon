//! Beat grid — port of `setBeatGrid.ts` (shared ruler + vertical line times).

use crate::viewport::TimelineViewport;

pub const BEAT_GRID_EPS: f64 = 1e-3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum GridKind {
    Bar = 0,
    SubBar = 1,
    Beat = 2,
    Half = 3,
    Quarter = 4,
}

#[derive(Debug, Clone)]
pub struct GridLevel {
    pub kind: GridKind,
    pub interval_sec: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct GridLine {
    pub time_sec: f64,
    pub kind: GridKind,
}

pub fn beat_duration_sec(bpm: f64) -> f64 {
    60.0 / bpm.max(1.0)
}

pub fn bar_duration_sec(bpm: f64, beats_per_bar: u32) -> f64 {
    beat_duration_sec(bpm) * f64::from(beats_per_bar)
}

fn grid_bar_multiple(bpm: f64, pps: f64, target_px: f64) -> u32 {
    let bar = bar_duration_sec(bpm, 4);
    for mult in [1u32, 2, 4, 8, 16, 32, 64] {
        if bar * f64::from(mult) * pps >= target_px {
            return mult;
        }
    }
    64
}

pub fn build_beat_grid_levels(bpm: f64, pps: f64, beats_per_bar: u32) -> Vec<GridLevel> {
    let beat = beat_duration_sec(bpm);
    let bar = bar_duration_sec(bpm, beats_per_bar);
    let bar_px = bar * pps;
    let bar_mult = grid_bar_multiple(bpm, pps, 56.0);

    let mut levels = vec![GridLevel {
        kind: GridKind::Bar,
        interval_sec: bar * f64::from(bar_mult),
    }];

    if bar_mult > 1 && bar_px >= 14.0 {
        levels.push(GridLevel {
            kind: GridKind::SubBar,
            interval_sec: bar,
        });
    }
    if bar_px >= 20.0 {
        levels.push(GridLevel {
            kind: GridKind::Beat,
            interval_sec: beat,
        });
    }
    if bar_px >= 44.0 && beat / 2.0 * pps >= 10.0 {
        levels.push(GridLevel {
            kind: GridKind::Half,
            interval_sec: beat / 2.0,
        });
    }
    if bar_px >= 72.0 && beat / 4.0 * pps >= 8.0 {
        levels.push(GridLevel {
            kind: GridKind::Quarter,
            interval_sec: beat / 4.0,
        });
    }

    levels
}

fn iter_grid_times(start_sec: f64, end_sec: f64, interval_sec: f64) -> Vec<f64> {
    if interval_sec <= 0.0 {
        return Vec::new();
    }
    let first = ((start_sec - BEAT_GRID_EPS) / interval_sec).ceil() as i64;
    let last = ((end_sec + BEAT_GRID_EPS) / interval_sec).floor() as i64;
    (first..=last)
        .map(|i| (i as f64 * interval_sec * 1e6).round() / 1e6)
        .collect()
}

pub fn collect_grid_lines(
    total_sec: f64,
    levels: &[GridLevel],
    view_start: f64,
    view_end: f64,
) -> Vec<GridLine> {
    let start = view_start.max(0.0);
    let end = view_end.min(total_sec);

    let mut lines = Vec::new();
    for level in levels {
        for t in iter_grid_times(start, end, level.interval_sec) {
            lines.push(GridLine {
                time_sec: t,
                kind: level.kind,
            });
        }
    }

    lines.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.kind.cmp(&b.kind))
    });

    let mut deduped: Vec<GridLine> = Vec::new();
    for line in lines {
        if let Some(prev) = deduped.last_mut() {
            if (prev.time_sec - line.time_sec).abs() < BEAT_GRID_EPS {
                if line.kind < prev.kind {
                    *prev = line;
                }
                continue;
            }
        }
        deduped.push(line);
    }
    deduped
}

pub fn collect_grid_for_viewport(vp: &TimelineViewport) -> Vec<GridLine> {
    let levels = build_beat_grid_levels(vp.bpm, vp.pixels_per_second, vp.beats_per_bar);
    let (start, end) = vp.view_time_range(2.0);
    collect_grid_lines(vp.total_sec, &levels, start, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_lines_are_sorted_and_deduped() {
        let levels = build_beat_grid_levels(128.0, 20.0, 4);
        let lines = collect_grid_lines(120.0, &levels, 0.0, 30.0);
        assert!(!lines.is_empty());
        for w in lines.windows(2) {
            assert!(w[0].time_sec <= w[1].time_sec);
        }
    }
}
