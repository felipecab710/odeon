//! `.odeon.wavecache` v2 parser — peak pyramids for GPU waveform draw.

use std::collections::HashMap;
use std::path::Path;

const MAGIC: u32 = 0x4F44_5743; // 'ODWC' big-endian on wire
const VERSION: u32 = 2;

#[derive(Debug, Clone)]
pub struct WaveformCache {
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_sec: f64,
    pub global_peak: f32,
    pub block_sizes: Vec<u32>,
    pub total_samples: u64,
    /// block_size → interleaved [lm, lx, rm, rx] per bucket
    pub levels: HashMap<u32, Vec<[f32; 4]>>,
}

#[derive(Debug)]
pub enum WavecacheError {
    Io(String),
    Format(String),
}

pub fn load_wavecache(path: &Path) -> Result<WaveformCache, WavecacheError> {
    let bytes = std::fs::read(path).map_err(|e| WavecacheError::Io(e.to_string()))?;
    parse_v2(&bytes).ok_or_else(|| WavecacheError::Format("not a v2 wavecache".into()))
}

fn parse_v2(buf: &[u8]) -> Option<WaveformCache> {
    if buf.len() < 12 {
        return None;
    }
    let magic = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if magic != MAGIC {
        return None;
    }
    let version = u32::from_le_bytes(buf[4..8].try_into().ok()?);
    if version != VERSION {
        return None;
    }
    let meta_len = u32::from_le_bytes(buf[8..12].try_into().ok()?) as usize;
    if buf.len() < 12 + meta_len {
        return None;
    }

    #[derive(serde::Deserialize)]
    struct Meta {
        sample_rate: u32,
        channels: u32,
        duration_seconds: f64,
        global_peak: f32,
        block_sizes: Vec<u32>,
        total_samples: u64,
    }

    let meta: Meta = serde_json::from_slice(&buf[12..12 + meta_len]).ok()?;
    let mut offset = 12 + meta_len;
    let mut levels = HashMap::new();

    for &block_size in &meta.block_sizes {
        let n_buckets = ((meta.total_samples + block_size as u64 - 1) / block_size as u64) as usize;
        let floats_needed = n_buckets * 4;
        let bytes_needed = floats_needed * 4;
        if offset + bytes_needed > buf.len() {
            break;
        }
        let mut buckets = Vec::with_capacity(n_buckets);
        for i in 0..n_buckets {
            let base = offset + i * 16;
            buckets.push([
                f32::from_le_bytes(buf[base..base + 4].try_into().unwrap()),
                f32::from_le_bytes(buf[base + 4..base + 8].try_into().unwrap()),
                f32::from_le_bytes(buf[base + 8..base + 12].try_into().unwrap()),
                f32::from_le_bytes(buf[base + 12..base + 16].try_into().unwrap()),
            ]);
        }
        levels.insert(block_size, buckets);
        offset += bytes_needed;
    }

    Some(WaveformCache {
        sample_rate: meta.sample_rate,
        channels: meta.channels,
        duration_sec: meta.duration_seconds,
        global_peak: meta.global_peak.max(1e-9),
        block_sizes: meta.block_sizes,
        total_samples: meta.total_samples,
        levels,
    })
}

pub fn select_block_size(cache: &WaveformCache, pixels_per_second: f64) -> u32 {
    let spp = cache.sample_rate as f64 / pixels_per_second.max(1e-9);
    let mut chosen = cache.block_sizes.first().copied().unwrap_or(64);
    for &bs in &cache.block_sizes {
        if (bs as f64) <= spp {
            chosen = bs;
        } else {
            break;
        }
    }
    chosen
}

/// Column peaks for drawing: `(x_px_in_clip, min_norm, max_norm)`.
pub fn clip_peak_columns(
    cache: &WaveformCache,
    file_start_sec: f64,
    file_end_sec: f64,
    pixels_per_second: f64,
    max_columns: usize,
) -> Vec<(f32, f32, f32)> {
    let block = select_block_size(cache, pixels_per_second);
    let Some(buckets) = cache.levels.get(&block) else {
        return Vec::new();
    };
    if buckets.is_empty() || pixels_per_second <= 0.0 {
        return Vec::new();
    }

    let block_sec = block as f64 / cache.sample_rate as f64;
    let clip_dur = (file_end_sec - file_start_sec).max(0.0);
    if clip_dur <= 0.0 {
        return Vec::new();
    }

    let width_px = clip_dur * pixels_per_second;
    let columns = (width_px.max(2.0) as usize).clamp(2, max_columns);

    let mut out = Vec::with_capacity(columns);
    for i in 0..columns {
        let t0 = file_start_sec + clip_dur * (i as f64 / columns as f64);
        let t1 = file_start_sec + clip_dur * ((i + 1) as f64 / columns as f64);
        let b0 = (t0 / block_sec).floor().max(0.0) as usize;
        let b1 = ((t1 / block_sec).ceil() as usize).min(buckets.len());
        if b0 >= buckets.len() {
            continue;
        }
        let mut mn = 1.0f32;
        let mut mx = -1.0f32;
        for b in b0..b1.max(b0 + 1).min(buckets.len()) {
            let [lm, lx, rm, rx] = buckets[b];
            mn = mn.min(lm).min(rm);
            mx = mx.max(lx).max(rx);
        }
        if mx < mn {
            continue;
        }
        let x = (i as f32 / columns as f32) * width_px as f32;
        // Peaks are already normalized to [-1, 1] in the wavecache file.
        out.push((x, mn, mx));
    }
    out
}
