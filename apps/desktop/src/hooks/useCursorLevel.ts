import { useEffect, useState } from "react";
import type { OdeonTrack } from "@odeon/shared";
import { dbAtCursor } from "../lib/cursorLevel";
import { loadWaveformCache } from "../lib/waveformEngine/cacheLoader";

/** dBFS at the edit cursor for the hovered lane (or selected / loudest clip). */
export function useCursorLevel(
  tracks: OdeonTrack[],
  timelineSec: number,
  hoverTrackId: string | null,
  selectedTrackId: string | null,
): number | null {
  const [db, setDb] = useState<number | null>(() =>
    dbAtCursor(tracks, timelineSec, hoverTrackId, selectedTrackId),
  );

  useEffect(() => {
    let cancelled = false;

    const recompute = () => {
      if (!cancelled) setDb(dbAtCursor(tracks, timelineSec, hoverTrackId, selectedTrackId));
    };

    recompute();

    const needsCache = tracks.some(
      (t) =>
        t.file_path &&
        !t.analysis?.waveform_peaks?.length &&
        !t.analysis?.waveform_peaks_l?.length,
    );

    if (needsCache) {
      void Promise.all(
        tracks.filter((t) => t.file_path).map((t) => loadWaveformCache(t.file_path!)),
      ).then(recompute);
    }

    return () => { cancelled = true; };
  }, [tracks, timelineSec, hoverTrackId, selectedTrackId]);

  return db;
}
