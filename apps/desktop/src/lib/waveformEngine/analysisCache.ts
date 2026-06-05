import type { TrackAnalysis } from "@odeon/shared";
import type { StereoPeakBucket, WaveformCache } from "./types";

/** Build a display-ready cache from analysis peaks already stored in the project. */
export function waveformCacheFromAnalysis(analysis: TrackAnalysis): WaveformCache | null {
  const pl = analysis.waveform_peaks_l ?? analysis.waveform_peaks;
  const pr = analysis.waveform_peaks_r ?? analysis.waveform_peaks;
  if (!pl?.length || !analysis.duration_seconds || !analysis.sample_rate) return null;

  const n = pl.length;
  const totalSamples = analysis.duration_seconds * analysis.sample_rate;
  const blockSize = Math.max(64, Math.ceil(totalSamples / n));

  const peaks: StereoPeakBucket[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lx = pl[i] ?? 0;
    const rx = pr?.[i] ?? lx;
    peaks[i] = { lm: -lx, lx, rm: -rx, rx };
  }

  return {
    version: 1,
    sample_rate: analysis.sample_rate,
    channels: analysis.channels,
    duration_seconds: analysis.duration_seconds,
    global_peak: 1,
    block_sizes: [blockSize],
    levels: { [String(blockSize)]: peaks },
  };
}
