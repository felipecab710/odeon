/**
 * Syncs set arrangement lanes to the native odeon-engine for preview playback.
 * Mirrors useEngineSync — one engine project per set preview session.
 */
import { useEffect, useRef, useState } from "react";
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";
import { useTransportStore } from "../stores/transportStore";
import { SET_PROJECT_ID, setTrackId } from "./deckMixEngine";
import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";

interface SyncedLane {
  startSec: number;
  clipId: string;
}

function clipIdFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "");
}

export function useSetEngineSync(lanes: LaneLayout[]) {
  const synced = useRef<Map<string, SyncedLane>>(new Map());
  const syncGen = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Track identity only — BPM/duration metadata must NOT trigger full reload.
  const sessionKey = lanes.map(l => `${l.card.entryId}:${l.entry.file_path ?? ""}`).join("|");
  // Rounded to whole seconds so minor layout float noise doesn't retrigger moves.
  const positionKey = lanes.map(l => `${l.card.entryId}:${Math.round(l.startSec)}`).join("|");

  // Full engine reload when tracks are added, removed, or paths change.
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
        await unwrapEngineResult(await engineClient.createProject(SET_PROJECT_ID));
        if (gen !== syncGen.current) return;

        synced.current = new Map();

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

          try {
            await unwrapEngineResult(
              await engineClient.createTrack(trackId, title, "user", "full_mix"),
            );
            await unwrapEngineResult(
              await engineClient.addClip(trackId, fp, lane.startSec),
            );
            useEngineStore.getState().initTrack(trackId, 0, 0);
            await unwrapEngineResult(await engineClient.setTrackVolume(trackId, 0));
            synced.current.set(entryId, { startSec: lane.startSec, clipId });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${title}: ${msg}`);
            console.warn(`[setEngineSync] failed lane ${entryId}:`, e);
          }

          if (gen !== syncGen.current) return;
        }

        if (synced.current.size === 0) {
          setSyncError(errors[0] ?? "No tracks loaded into engine");
          return;
        }

        await unwrapEngineResult(await engineClient.notifyTracksReady());
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
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced clip reposition when overlap layout shifts (e.g. duration refined).
  useEffect(() => {
    if (lanes.length === 0) return;

    const timer = setTimeout(() => {
      for (const lane of lanes) {
        const entryId = lane.card.entryId;
        const existing = synced.current.get(entryId);
        if (!existing) continue;
        if (Math.abs(existing.startSec - lane.startSec) <= 0.5) continue;

        const trackId = setTrackId(entryId);
        void engineClient.moveClip(trackId, existing.clipId, lane.startSec)
          .then(res => unwrapEngineResult(res))
          .then(() => { existing.startSec = lane.startSec; })
          .catch((e: unknown) => console.warn(`[setEngineSync] moveClip failed ${entryId}:`, e));
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [positionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { syncing, syncError, trackCount: synced.current.size };
}
