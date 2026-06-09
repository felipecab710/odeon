/**
 * Syncs set arrangement lanes to the native odeon-engine for preview playback.
 * DAW model: one session, one route per lane, clips at timeline positions.
 * Incremental sync — no full session rebuild on layout tweaks.
 */
import { useEffect, useRef, useState } from "react";
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";
import { useTransportStore } from "../stores/transportStore";
import { SET_PROJECT_ID, setTrackId } from "./routeIds";
import { clearSetEngineMixPushCache } from "./boothSimulation";
import { resetSelectEngineSession } from "./useSelectEngineSync";
import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";

interface SyncedLane {
  startSec: number;
  clipId: string;
  filePath: string;
}

function clipIdFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "");
}

let setProjectReady = false;
let setEngineSessionEpoch = 0;
const resetListeners = new Set<() => void>();

export function resetSetEngineSession(): void {
  setProjectReady = false;
  clearSetEngineMixPushCache();
  setEngineSessionEpoch += 1;
  resetListeners.forEach(l => l());
}

export function useSetEngineSync(lanes: LaneLayout[]) {
  const synced = useRef<Map<string, SyncedLane>>(new Map());
  const syncGen = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [resetEpoch, setResetEpoch] = useState(setEngineSessionEpoch);

  useEffect(() => {
    const bump = () => setResetEpoch(setEngineSessionEpoch);
    resetListeners.add(bump);
    return () => { resetListeners.delete(bump); };
  }, []);

  const sessionKey = lanes.map(l => `${l.card.entryId}:${l.entry.file_path ?? ""}`).join("|");
  const positionKey = lanes.map(l => `${l.card.entryId}:${Math.round(l.startSec * 10)}`).join("|");

  useEffect(() => {
    if (lanes.length === 0) {
      setSyncing(false);
      setSyncError(null);
      useTransportStore.getState().setEngineTracksReady(false);
      return;
    }

    const gen = ++syncGen.current;

    const sync = async () => {
      setSyncing(true);
      setSyncError(null);
      useTransportStore.getState().setEngineTracksReady(false);

      const errors: string[] = [];

      try {
        if (!setProjectReady) {
          synced.current = new Map();
          await unwrapEngineResult(await engineClient.createProject(SET_PROJECT_ID));
          resetSelectEngineSession();
          setProjectReady = true;
        }
        if (gen !== syncGen.current) return;

        const laneIds = new Set(lanes.map(l => l.card.entryId));
        for (const [entryId, meta] of synced.current) {
          if (!laneIds.has(entryId)) {
            const trackId = setTrackId(entryId);
            await engineClient.removeTrack(trackId).catch(() => {});
            synced.current.delete(entryId);
          }
        }

        let anyNew = false;

        for (const lane of lanes) {
          const entryId = lane.card.entryId;
          const trackId = setTrackId(entryId);
          const fp = lane.entry.file_path;
          if (!fp) {
            errors.push(`No file path for ${lane.entry.title ?? entryId}`);
            continue;
          }

          const title = lane.entry.title || lane.entry.file_name;
          const clipId = clipIdFromPath(fp);
          const existing = synced.current.get(entryId);

          if (!existing || existing.filePath !== fp) {
            if (existing) {
              await engineClient.removeTrack(trackId).catch(() => {});
            }
            try {
              await unwrapEngineResult(
                await engineClient.createTrack(trackId, title, "user", "full_mix"),
              );
              await unwrapEngineResult(
                await engineClient.addClip(trackId, fp, lane.startSec),
              );
              useEngineStore.getState().initTrack(trackId, 0, 0);
              await unwrapEngineResult(await engineClient.setTrackVolume(trackId, 0));
              synced.current.set(entryId, { startSec: lane.startSec, clipId, filePath: fp });
              anyNew = true;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              errors.push(`${title}: ${msg}`);
              console.warn(`[setEngineSync] failed lane ${entryId}:`, e);
            }
          } else if (Math.abs(existing.startSec - lane.startSec) > 0.05) {
            try {
              await unwrapEngineResult(
                await engineClient.moveClip(trackId, existing.clipId, lane.startSec),
              );
              existing.startSec = lane.startSec;
            } catch (e) {
              console.warn(`[setEngineSync] moveClip failed ${entryId}:`, e);
            }
          }

          if (gen !== syncGen.current) return;
        }

        if (synced.current.size === 0) {
          setSyncError(errors[0] ?? "No tracks loaded into engine");
          return;
        }

        if (anyNew) {
          await unwrapEngineResult(await engineClient.notifyTracksReady());
        }

        if (gen === syncGen.current) {
          useTransportStore.getState().setEngineTracksReady(true);
          setSyncError(errors.length > 0 ? `${errors.length} track(s) failed to load` : null);
        }
      } catch (e) {
        if (gen === syncGen.current) {
          const msg = e instanceof Error ? e.message : String(e);
          setSyncError(msg.includes("Engine not running") ? "Audio engine not running" : msg);
          console.warn("[setEngineSync] sync failed:", e);
        }
      } finally {
        if (gen === syncGen.current) {
          setSyncing(false);
        }
      }
    };

    void sync();
    return () => { syncGen.current++; };
  }, [sessionKey, resetEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast clip reposition when overlap layout shifts (no debounce — DAW responsiveness).
  useEffect(() => {
    if (lanes.length === 0 || !setProjectReady) return;

    for (const lane of lanes) {
      const entryId = lane.card.entryId;
      const existing = synced.current.get(entryId);
      if (!existing) continue;
      if (Math.abs(existing.startSec - lane.startSec) <= 0.05) continue;

      const trackId = setTrackId(entryId);
      void engineClient.moveClip(trackId, existing.clipId, lane.startSec)
        .then(res => unwrapEngineResult(res))
        .then(() => { existing.startSec = lane.startSec; })
        .catch((e: unknown) => console.warn(`[setEngineSync] moveClip failed ${entryId}:`, e));
    }
  }, [positionKey, lanes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { syncing, syncError, trackCount: synced.current.size };
}
