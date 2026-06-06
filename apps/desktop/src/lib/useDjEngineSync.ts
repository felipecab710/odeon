/**
 * Syncs set arrangement to true 4-deck DJ players in odeon-engine.
 * Replaces timeline-clip sync (useSetEngineSync) for Booth preview.
 *
 * Each lane maps to deck:0..3 with clips positioned on the set timeline.
 */
import { useEffect, useRef, useState } from "react";
import { MAX_DECKS } from "@odeon/shared";
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";
import { useTransportStore } from "../stores/transportStore";
import { deckTrackId } from "./deckMixEngine";
import type { LaneLayout } from "../components/setbuilder/setTimelineLayout";

interface SyncedDeck {
  entryId: string;
  filePath: string;
  timelineStart: number;
}

export function useDjEngineSync(lanes: LaneLayout[], enabled: boolean) {
  const synced = useRef<Map<number, SyncedDeck>>(new Map());
  const syncGen = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const deckLanes = lanes.slice(0, MAX_DECKS);
  const sessionKey = deckLanes
    .map(l => `${l.card.entryId}:${l.entry.file_path ?? ""}`)
    .join("|");
  const positionKey = deckLanes
    .map(l => `${l.card.entryId}:${Math.round(l.startSec)}`)
    .join("|");

  useEffect(() => {
    if (!enabled || deckLanes.length === 0) {
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
        await unwrapEngineResult(
          await engineClient.createDjSession(Math.min(deckLanes.length, MAX_DECKS)),
        );
        if (gen !== syncGen.current) return;

        synced.current = new Map();

        for (let deckIndex = 0; deckIndex < deckLanes.length; deckIndex++) {
          const lane = deckLanes[deckIndex];
          const fp = lane.entry.file_path;
          if (!fp) {
            errors.push(`No file path for ${lane.entry.title ?? lane.card.entryId}`);
            continue;
          }

          const title = lane.entry.title || lane.entry.file_name;
          const trackId = deckTrackId(deckIndex);

          try {
            await unwrapEngineResult(
              await engineClient.loadDeck(deckIndex, fp, title, lane.startSec),
            );
            useEngineStore.getState().initTrack(trackId, 0, 0);
            await unwrapEngineResult(
              await engineClient.setTrackVolume(trackId, 0),
            );
            synced.current.set(deckIndex, {
              entryId: lane.card.entryId,
              filePath: fp,
              timelineStart: lane.startSec,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${title}: ${msg}`);
            console.warn(`[djEngineSync] failed deck ${deckIndex}:`, e);
          }

          if (gen !== syncGen.current) return;
        }

        if (synced.current.size === 0) {
          setSyncError(errors[0] ?? "No decks loaded into engine");
          return;
        }

        await unwrapEngineResult(await engineClient.notifyTracksReady());
        if (gen === syncGen.current) {
          useTransportStore.getState().setEngineTracksReady(true);
          setSyncError(
            errors.length > 0 ? `${errors.length} deck(s) failed to load` : null,
          );
        }
      } catch (e) {
        if (gen === syncGen.current) {
          const msg = e instanceof Error ? e.message : String(e);
          setSyncError(
            msg.includes("Engine not running") ? "Audio engine not running" : msg,
          );
          console.warn("[djEngineSync] sync failed:", e);
        }
      } finally {
        if (gen === syncGen.current) {
          setSyncing(false);
        }
      }
    };

    void sync();
    return () => { syncGen.current++; };
  }, [enabled, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced timeline reposition when overlap layout shifts.
  useEffect(() => {
    if (!enabled || deckLanes.length === 0) return;

    const timer = setTimeout(() => {
      deckLanes.forEach((lane, deckIndex) => {
        const existing = synced.current.get(deckIndex);
        if (!existing) return;
        if (Math.abs(existing.timelineStart - lane.startSec) <= 0.5) return;

        void engineClient.deckSeek(deckIndex, lane.startSec)
          .then(res => unwrapEngineResult(res))
          .then(() => { existing.timelineStart = lane.startSec; })
          .catch((e: unknown) =>
            console.warn(`[djEngineSync] deckSeek failed ${deckIndex}:`, e),
          );
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [enabled, positionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { syncing, syncError, deckCount: synced.current.size };
}
