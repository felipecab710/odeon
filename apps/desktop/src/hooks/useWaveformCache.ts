import { useEffect, useState } from "react";
import type { TrackAnalysis } from "@odeon/shared";
import {
  getCachedWaveform,
  isFullWaveformCache,
  loadWaveformCache,
  seedWaveformCache,
  waveformCacheFromAnalysis,
  type WaveformCache,
} from "../lib/waveformEngine";

export function useWaveformCache(
  audioPath: string | undefined | null,
  analysis?: TrackAnalysis | null,
) {
  const [cache, setCache] = useState<WaveformCache | null>(() => {
    if (!audioPath) return null;
    const mem = getCachedWaveform(audioPath);
    if (mem) return mem;
    return analysis ? waveformCacheFromAnalysis(analysis) : null;
  });

  useEffect(() => {
    if (!audioPath) {
      setCache(null);
      return;
    }

    const mem = getCachedWaveform(audioPath);
    if (mem && isFullWaveformCache(mem)) {
      setCache(mem);
      return;
    }

    if (analysis) {
      const instant = waveformCacheFromAnalysis(analysis);
      if (instant) {
        seedWaveformCache(audioPath, instant);
        setCache(instant);
      }
    } else if (mem) {
      setCache(mem);
    }

    let cancelled = false;
    loadWaveformCache(audioPath)
      .then((data) => {
        if (!cancelled && data) setCache(data);
      });

    return () => {
      cancelled = true;
    };
  }, [audioPath, analysis]);

  return { cache, loading: false };
}
