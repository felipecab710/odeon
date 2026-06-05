/**
 * useEngineSync — whenever the project's track list changes,
 * ensures the native engine has an up-to-date project + track set.
 *
 * Flow:
 *   1. createProject on the engine with the project ID
 *   2. For each track with a file, createTrack + addClip
 *   3. If track exists in engine already (tracked via ref), skip
 */
import { useEffect, useRef } from "react";
import { engineClient } from "../lib/engineClient";
import type { OdeonProject } from "@odeon/shared";

export function useEngineSync(project: OdeonProject | null) {
  const syncedProjectId = useRef<string | null>(null);
  const syncedTrackIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!project) return;

    const sync = async () => {
      // If project changed, recreate engine project
      if (syncedProjectId.current !== project.id) {
        try {
          await engineClient.createProject(project.id);
          syncedProjectId.current = project.id;
          syncedTrackIds.current = new Set();
        } catch (e) {
          console.warn("[engineSync] createProject failed:", e);
          return;
        }
      }

      const projectIds = new Set(project.tracks.map((t) => t.id));
      for (const id of syncedTrackIds.current) {
        if (!projectIds.has(id)) {
          engineClient.removeTrack(id).catch(() => {});
          syncedTrackIds.current.delete(id);
        }
      }

      // Sync new tracks
      for (const track of project.tracks) {
        if (syncedTrackIds.current.has(track.id)) continue;
        if (!track.file_path) continue;

        try {
          await engineClient.createTrack(track.id, track.name, track.role, track.stem_type);
          await engineClient.addClip(track.id, track.file_path, track.clip_start_seconds ?? 0);
          syncedTrackIds.current.add(track.id);
        } catch (e) {
          console.warn(`[engineSync] failed to sync track ${track.id}:`, e);
        }
      }
    };

    sync();
  }, [project?.id, project?.tracks]);
}
