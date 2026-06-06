/**
 * Waveform-driven VU meter simulation for Pioneer booth.
 * Ballistics modeled on Mixxx EngineVuMeter (30 Hz, attack 1.0, decay 0.1).
 */
import type { WaveformCache } from "./waveformEngine/types";
import {
  OVERVIEW_FIELDS,
  OVERVIEW_MAX,
  OVERVIEW_MIN,
  OVERVIEW_RMS,
} from "./waveformEngine/types";
import { getLodPeaks, peakForPixel } from "./waveformEngine/lod";

interface MeterState {
  l: number;
  r: number;
  lastSampleMs: number;
}

const meterStates = new Map<string, MeterState>();

/** Mixxx enginevumeter.cpp */
const VU_UPDATE_HZ = 30;
const ATTACK = 1.0;
const DECAY = 0.1;

function amplitudeToDb(amp: number): number {
  if (amp <= 1e-6) return -90;
  return Math.max(-90, Math.min(6, 20 * Math.log10(amp)));
}

function sampleOverviewAtFrac(
  cache: WaveformCache,
  frac: number,
  phaseSec: number,
): { l: number; r: number } {
  if (!cache.overview?.levels) return { l: 0, r: 0 };

  for (const lvl of [4096, 2048, 1024, 512]) {
    const arr = cache.overview.levels[String(lvl)];
    if (!arr?.length) continue;
    const count = arr.length / OVERVIEW_FIELDS;
    const f = frac * (count - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(count - 1, i0 + 1);
    const t = f - i0;
    const blend = (off: number) => arr[i0 * OVERVIEW_FIELDS + off] * (1 - t)
      + arr[i1 * OVERVIEW_FIELDS + off] * t;
    const rms = Math.max(0, blend(OVERVIEW_RMS));
    const peak = Math.max(
      Math.abs(blend(OVERVIEW_MIN)),
      Math.abs(blend(OVERVIEW_MAX)),
    );
    const mono = rms * 0.45 + peak * 0.55;
    const wobble = 0.06 * Math.sin(phaseSec * 17.3 + frac * 48);
    return {
      l: Math.min(1, mono * (1 + wobble)),
      r: Math.min(1, mono * (1 - wobble * 0.55)),
    };
  }
  return { l: 0, r: 0 };
}

function samplePeaksAtFrac(cache: WaveformCache, frac: number): { l: number; r: number } {
  const dur = Math.max(0.001, cache.duration_seconds || 1);
  const { blockSize, peaks } = getLodPeaks(cache, 180, 1000);
  const totalSamples = Math.max(1, Math.round(dur * (cache.sample_rate || 44100)));
  const x = frac * 1000;
  const p = peakForPixel(peaks, x, 1000, totalSamples, blockSize);
  const norm = cache.global_peak > 1e-9 ? cache.global_peak : 1;
  return {
    l: Math.max(Math.abs(p.lm), Math.abs(p.lx)) / norm,
    r: Math.max(Math.abs(p.rm), Math.abs(p.rx)) / norm,
  };
}

function samplePoint(
  cache: WaveformCache,
  localPosSec: number,
): { l: number; r: number } {
  const dur = Math.max(0.001, cache.duration_seconds || 1);
  const frac = Math.max(0, Math.min(1, localPosSec / dur));

  const overview = sampleOverviewAtFrac(cache, frac, localPosSec);
  if (overview.l > 0 || overview.r > 0) return overview;

  return samplePeaksAtFrac(cache, frac);
}

function sampleAmplitude(cache: WaveformCache, localPosSec: number): { l: number; r: number } {
  const windowSec = 0.08;
  const steps = 7;
  let maxL = 0;
  let maxR = 0;

  for (let i = 0; i < steps; i++) {
    const t = localPosSec - windowSec / 2 + (windowSec * i) / Math.max(1, steps - 1);
    const { l, r } = samplePoint(cache, Math.max(0, t));
    maxL = Math.max(maxL, l);
    maxR = Math.max(maxR, r);
  }

  return { l: maxL, r: maxR };
}

function syntheticAmplitude(localPosSec: number, bpm = 128): { l: number; r: number } {
  const beatHz = bpm / 60;
  const beat = Math.sin(localPosSec * beatHz * Math.PI * 2);
  const hi = Math.abs(Math.sin(localPosSec * 5.7 + 0.4));
  const transient = Math.max(0, Math.sin(localPosSec * beatHz * Math.PI * 8)) ** 3;
  const env = 0.42 + beat * 0.18 + hi * 0.22 + transient * 0.28;
  const flutter = 0.05 * Math.sin(localPosSec * 23.1);
  return {
    l: Math.min(1, Math.max(0.05, env * (1 + flutter))),
    r: Math.min(1, Math.max(0.05, env * (1 - flutter * 0.7))),
  };
}

/** Mixxx EngineVuMeter::doSmooth */
function mixxxSmooth(prevVal: number, target: number): number {
  if (prevVal > target) {
    return prevVal - DECAY * (prevVal - target);
  }
  return prevVal + ATTACK * (target - prevVal);
}

function applyBallistics(
  key: string,
  targetL: number,
  targetR: number,
  nowMs: number,
): { l: number; r: number } {
  const prev = meterStates.get(key) ?? { l: -90, r: -90, lastSampleMs: 0 };
  const sampleInterval = 1000 / VU_UPDATE_HZ;

  let nextL = prev.l;
  let nextR = prev.r;
  if (nowMs - prev.lastSampleMs >= sampleInterval) {
    nextL = mixxxSmooth(prev.l, targetL);
    nextR = mixxxSmooth(prev.r, targetR);
    meterStates.set(key, { l: nextL, r: nextR, lastSampleMs: nowMs });
  } else {
    meterStates.set(key, prev);
  }

  return { l: nextL, r: nextR };
}

export function simulateChannelMeters(opts: {
  entryId: string;
  cache: WaveformCache | null | undefined;
  localPosSec: number;
  faderDb: number;
  isPlaying: boolean;
  engineL?: number;
  engineR?: number;
  enginePeakL?: number;
  enginePeakR?: number;
  bpm?: number;
  nowMs?: number;
}): { meterL: number; meterR: number } {
  const {
    entryId, cache, localPosSec, faderDb, isPlaying,
    engineL, engineR, enginePeakL, enginePeakR, bpm,
    nowMs = performance.now(),
  } = opts;
  const key = entryId;

  if (!isPlaying || faderDb <= -50) {
    const silent = applyBallistics(key, -90, -90, nowMs);
    return { meterL: silent.l, meterR: silent.r };
  }

  const faderGain = Math.pow(10, faderDb / 20);
  let targetL = -90;
  let targetR = -90;

  const liveL = enginePeakL ?? engineL;
  const liveR = enginePeakR ?? engineR;
  const engineLive = (liveL ?? -90) > -50 || (liveR ?? -90) > -50;

  if (engineLive) {
    targetL = liveL ?? -90;
    targetR = liveR ?? -90;
  } else if (cache) {
    const { l, r } = sampleAmplitude(cache, localPosSec);
    targetL = amplitudeToDb(l * faderGain);
    targetR = amplitudeToDb(r * faderGain);
  } else {
    const { l, r } = syntheticAmplitude(localPosSec, bpm);
    targetL = amplitudeToDb(l * faderGain);
    targetR = amplitudeToDb(r * faderGain);
  }

  if (engineLive && cache) {
    const { l, r } = sampleAmplitude(cache, localPosSec);
    const waveL = amplitudeToDb(l * faderGain);
    const waveR = amplitudeToDb(r * faderGain);
    targetL = waveL * 0.25 + targetL * 0.75;
    targetR = waveR * 0.25 + targetR * 0.75;
  }

  const bounced = applyBallistics(key, targetL, targetR, nowMs);
  return { meterL: bounced.l, meterR: bounced.r };
}

export function resetMeterStates(): void {
  meterStates.clear();
}
