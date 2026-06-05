/**
 * useWebAudioSync — loads project tracks into the Web Audio engine
 * whenever the track list changes.
 *
 * Only loads tracks that aren't already buffered. Works alongside
 * useEngineSync: if the C++ engine is running it owns playback; otherwise
 * the Web Audio engine takes over transparently.
 */
import { useEffect, useRef } from "react";
import type { OdeonProject } from "@odeon/shared";
import { webAudioEngine } from "./webAudioEngine";

export function useWebAudioSync(project: OdeonProject | null) {
  const projectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;

    // If the project changed, clear all previously buffered audio
    if (projectIdRef.current && projectIdRef.current !== project.id) {
      webAudioEngine.clearTracks();
    }
    projectIdRef.current = project.id;

    for (const track of project.tracks) {
      if (!track.file_path) continue;
      if (webAudioEngine.hasTrack(track.id)) continue;

      // Fire-and-forget; engine reports readiness via onReadyChange callback
      webAudioEngine.loadTrack(track.id, track.file_path).catch((e) =>
        console.warn("[webAudioSync] load failed for", track.id, e)
      );
    }
  }, [project?.id, project?.tracks?.length]);
}
