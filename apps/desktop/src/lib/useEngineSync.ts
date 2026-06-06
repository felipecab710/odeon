/**
 * useEngineSync — keeps the native odeon-engine in sync with the project.
 *
 * Flow on project open or track change:
 *  1. createProject (once per project ID)
 *  2. For each track: createTrack + addClip + push initial mix state
 *  3. Remove tracks that were deleted from the project
 *  4. On clip_start_seconds change: moveClip to new position
 *  5. Emit notifyTracksReady after all tracks synced (enables Play button)
 */
import { useEffect, useRef } from "react";
import { engineClient } from "../lib/engineClient";
import type { OdeonProject } from "@odeon/shared";

interface SyncedTrack {
  clipStartSeconds: number;
}

export function useEngineSync(project: OdeonProject | null) {
  const syncedProjectId = useRef<string | null>(null);
  const syncedTracks = useRef<Map<string, SyncedTrack>>(new Map());

  useEffect(() => {
    if (!project) return;

    const sync = async () => {
      // Recreate engine project if session changed
      if (syncedProjectId.current !== project.id) {
        try {
          await engineClient.createProject(project.id);
          syncedProjectId.current = project.id;
          syncedTracks.current = new Map();
        } catch (e) {
          console.warn("[engineSync] createProject failed:", e);
          return;
        }
      }

      // Remove tracks that were deleted
      const projectTrackIds = new Set(project.tracks.map((t) => t.id));
      for (const [id] of syncedTracks.current) {
        if (!projectTrackIds.has(id)) {
          engineClient.removeTrack(id).catch(() => {});
          syncedTracks.current.delete(id);
        }
      }

      let anyNew = false;

      for (const track of project.tracks) {
        if (!track.file_path) continue;
        const existing = syncedTracks.current.get(track.id);

        if (!existing) {
          // New track — create + add clip + push initial mix state
          try {
            await engineClient.createTrack(track.id, track.name, track.role, track.stem_type);
            await engineClient.addClip(track.id, track.file_path, track.clip_start_seconds ?? 0);

            // Push initial mix state so engine reflects project values on first sync
            await Promise.allSettled([
              engineClient.setTrackVolume(track.id, track.volume_db ?? 0),
              engineClient.setTrackPan(track.id, track.pan ?? 0),
              track.muted ? engineClient.muteTrack(track.id, true) : Promise.resolve(),
              track.soloed ? engineClient.soloTrack(track.id, true) : Promise.resolve(),
            ]);

            syncedTracks.current.set(track.id, {
              clipStartSeconds: track.clip_start_seconds ?? 0,
            });
            anyNew = true;
          } catch (e) {
            console.warn(`[engineSync] failed to sync track ${track.id}:`, e);
          }
        } else {
          // Existing track — check for clip position change
          const newStart = track.clip_start_seconds ?? 0;
          if (Math.abs(newStart - existing.clipStartSeconds) > 0.001) {
            engineClient.moveClip(track.id, track.id, newStart).catch(() => {});
            existing.clipStartSeconds = newStart;
          }
        }
      }

      // Notify engine that all pending tracks are loaded so it can emit tracksReady
      if (anyNew) {
        engineClient.notifyTracksReady().catch(() => {});
      }
    };

    sync();
  }, [project?.id, project?.tracks]);
}
