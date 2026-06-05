import type { OdeonTrack } from "@odeon/shared";
import type { WaveformCache } from "./waveformEngine/types";
import { getCachedWaveform } from "./waveformEngine/cacheLoader";

export function peakLinearToDb(peak: number): number {
  if (peak < 1e-8) return -90;
  return 20 * Math.log10(Math.min(1, Math.abs(peak)));
}

export function formatCursorDb(db: number | null): string {
  if (db === null) return "-- db";
  if (db <= -89.5) return "-∞ db";
  const sign = db >= 0 ? "+" : "";
  return `${sign}${db.toFixed(1)} db`;
}

function peakFromAnalysisArrays(
  localSec: number,
  duration: number,
  peaksL: number[] | null | undefined,
  peaksR: number[] | null | undefined,
  peaksMono: number[] | null | undefined,
): number {
  const arr = peaksL ?? peaksMono;
  if (!arr?.length) return 0;
  const idx = Math.min(
    arr.length - 1,
    Math.max(0, Math.floor((localSec / duration) * arr.length)),
  );
  const l = Math.abs(arr[idx] ?? 0);
  const r = peaksR?.length
    ? Math.abs(peaksR[Math.min(idx, peaksR.length - 1)] ?? 0)
    : l;
  return Math.max(l, r);
}

function peakFromCache(localSec: number, cache: WaveformCache): number {
  const blockSize = cache.block_sizes[0] ?? 64;
  const level = cache.levels[String(blockSize)];
  if (!level?.length || cache.sample_rate <= 0) return 0;

  const sampleIdx = Math.floor(localSec * cache.sample_rate);
  const bucketIdx = Math.min(level.length - 1, Math.max(0, Math.floor(sampleIdx / blockSize)));
  const b = level[bucketIdx];
  return Math.max(Math.abs(b.lx), Math.abs(b.lm), Math.abs(b.rx), Math.abs(b.rm));
}

/** Peak linear amplitude at timeline position for one track (null if cursor outside clip). */
export function peakAtTimelineSec(track: OdeonTrack, timelineSec: number): number | null {
  const clipStart = track.clip_start_seconds ?? 0;
  const duration = track.analysis?.duration_seconds ?? 0;
  if (duration <= 0) return null;

  const localSec = timelineSec - clipStart;
  if (localSec < 0 || localSec >= duration) return null;

  const analysis = track.analysis;
  if (analysis?.waveform_peaks_l?.length || analysis?.waveform_peaks?.length) {
    return peakFromAnalysisArrays(
      localSec,
      duration,
      analysis.waveform_peaks_l,
      analysis.waveform_peaks_r,
      analysis.waveform_peaks,
    );
  }

  if (track.file_path) {
    const cache = getCachedWaveform(track.file_path);
    if (cache) return peakFromCache(localSec, cache);
  }

  return null;
}

/** dBFS at cursor — hovered lane, else selected track, else loudest clip. */
export function dbAtCursor(
  tracks: OdeonTrack[],
  timelineSec: number,
  hoverTrackId: string | null,
  selectedTrackId: string | null,
): number | null {
  const trackId = hoverTrackId ?? selectedTrackId;
  if (trackId) {
    const sel = tracks.find((t) => t.id === trackId);
    if (sel) {
      const peak = peakAtTimelineSec(sel, timelineSec);
      return peak !== null ? peakLinearToDb(peak) : null;
    }
  }

  let best: number | null = null;
  for (const track of tracks) {
    const peak = peakAtTimelineSec(track, timelineSec);
    if (peak === null) continue;
    const db = peakLinearToDb(peak);
    if (best === null || db > best) best = db;
  }
  return best;
}
