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
}

export const PYRAMID_BLOCK_SIZES = [64, 256, 1024, 4096, 16384] as const;
