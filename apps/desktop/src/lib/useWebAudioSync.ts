/**
 * useWebAudioSync — loads project tracks into the Web Audio engine
 * whenever the track list changes.
 *
 * Audio decode is deferred so waveform paint wins the main thread on open.
 */
import { useEffect, useRef } from "react";
import type { OdeonProject } from "@odeon/shared";
import { webAudioEngine } from "./webAudioEngine";

const LOAD_STAGGER_MS = 16;

function scheduleIdle(fn: () => void): number {
  if (typeof requestIdleCallback !== "undefined") {
    return requestIdleCallback(fn, { timeout: 2000 });
  }
  return window.setTimeout(fn, 50);
}

function cancelScheduled(id: number) {
  if (typeof cancelIdleCallback !== "undefined") {
    cancelIdleCallback(id);
  } else {
    clearTimeout(id);
  }
}

export function useWebAudioSync(project: OdeonProject | null) {
  const projectIdRef = useRef<string | null>(null);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const scheduleRef = useRef<number | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    if (!project) return;

    if (projectIdRef.current && projectIdRef.current !== project.id) {
      webAudioEngine.clearTracks();
      loadedIdsRef.current = new Set();
    }
    projectIdRef.current = project.id;

    const projectIds = new Set(project.tracks.map((t) => t.id));
    for (const id of loadedIdsRef.current) {
      if (!projectIds.has(id)) {
        webAudioEngine.removeTrack(id);
        loadedIdsRef.current.delete(id);
      }
    }

    for (const track of project.tracks) {
      webAudioEngine.setClipStart(track.id, track.clip_start_seconds ?? 0);
    }

    const toLoad = project.tracks.filter(
      (t) => t.file_path && !webAudioEngine.hasTrack(t.id),
    );
    if (!toLoad.length) return;

    const gen = ++genRef.current;
    if (scheduleRef.current !== null) cancelScheduled(scheduleRef.current);

    scheduleRef.current = scheduleIdle(() => {
      scheduleRef.current = null;
      if (gen !== genRef.current) return;

      let i = 0;
      const loadNext = () => {
        if (gen !== genRef.current || i >= toLoad.length) return;
        const track = toLoad[i++];
        webAudioEngine.loadTrack(track.id, track.file_path!)
          .then(() => { loadedIdsRef.current.add(track.id); })
          .catch((e) => console.warn("[webAudioSync] load failed for", track.id, e))
          .finally(() => { window.setTimeout(loadNext, LOAD_STAGGER_MS); });
      };
      loadNext();
    });

    return () => {
      genRef.current++;
      if (scheduleRef.current !== null) {
        cancelScheduled(scheduleRef.current);
        scheduleRef.current = null;
      }
    };
  }, [project?.id, project?.tracks]);
}
