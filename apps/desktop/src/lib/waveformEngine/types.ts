/** Pro Tools-style waveform cache — matches `.odeon.wavecache` from API */

export interface StereoPeakBucket {
  lm: number; // left min  (normalised -1..1)
  lx: number; // left max
  rm: number; // right min
  rx: number; // right max
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
}

export const PYRAMID_BLOCK_SIZES = [64, 256, 1024, 4096, 16384] as const;
