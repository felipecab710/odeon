/** Pro Tools-style waveform cache — matches `.odeon.wavecache` from API */

export interface StereoPeakBucket {
  lm: number; // left min  (normalised -1..1)
  lx: number; // left max
  rm: number; // right min
  rx: number; // right max
}

export interface FreqColors {
  bass: Uint8Array; // 0-255 per column, blue  (20-300 Hz)
  mid:  Uint8Array; // 0-255 per column, green (300-3000 Hz)
  high: Uint8Array; // 0-255 per column, orange (3000+ Hz)
}

/** Field offsets within an interleaved OVW3 overview bin (6 floats). */
export const OVERVIEW_FIELDS = 6;
export const OVERVIEW_MIN = 0;
export const OVERVIEW_MAX = 1;
export const OVERVIEW_RMS = 2;
export const OVERVIEW_LOW = 3;
export const OVERVIEW_MID = 4;
export const OVERVIEW_HIGH = 5;

/** Resolution levels available in the OVW3 section (bins per level). */
export const OVERVIEW_LEVELS = [512, 1024, 2048, 4096] as const;

/**
 * Three-band structural overview ('OVW3').
 * Each level is an interleaved Float32Array of binCount × 6 fields:
 *   [minPeak, maxPeak, rms, low, mid, high]
 * Values are robustly normalised (98th percentile) and log-compressed.
 */
export interface WaveformOverview {
  levels: Record<string, Float32Array>;
}

export interface WaveformCache {
  version: number;
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  global_peak: number;
  block_sizes: number[];
  levels: Record<string, StereoPeakBucket[]>;
  source_hash?: string;
  freqColors?: FreqColors;
  overview?: WaveformOverview;
}

export const PYRAMID_BLOCK_SIZES = [64, 256, 1024, 4096, 16384] as const;
