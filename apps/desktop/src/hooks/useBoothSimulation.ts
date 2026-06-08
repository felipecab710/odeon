/**
 * Runs booth simulation loop — syncs transport → boothStore → engine.
 */
import { useEffect, useRef, useState } from "react";
import type { CatalogEntry, CatalogMarker } from "@odeon/shared";
import type { SetCard } from "../stores/setBuilderStore";
import { useTransportStore } from "../stores/transportStore";
import { useBoothStore } from "../stores/boothStore";
import {
  computeBoothSnapshot,
  findActiveTransition,
  pushBoothToEngine,
} from "../lib/boothSimulation";
import { useDjEngineSync } from "../lib/useDjEngineSync";
import { VisualPlayPosition } from "../lib/visualPlayPosition";
import { computeSetLayout } from "../components/setbuilder/setTimelineLayout";
import { apiClient, type TransitionPlanData } from "../lib/apiClient";
import { loadWaveformCache } from "../lib/waveformEngine/cacheLoader";
import type { WaveformCache } from "../lib/waveformEngine/types";
import { resetMeterStates } from "../lib/boothMeterSim";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { useStudioAutomationStore } from "../stores/studioAutomationStore";
import { useStudioLaneStore } from "../stores/studioLaneStore";

export function useBoothSimulation(
  enabled: boolean,
  sorted: SetCard[],
  entryMap: Map<string, CatalogEntry>,
  options?: {
    driveEngine?: boolean;
    engineRoute?: "set" | "dj";
    previewPlayheadSec?: number | null;
  },
) {
  const driveEngine = options?.driveEngine ?? true;
  const engineRoute = options?.engineRoute ?? "dj";
  const previewPlayheadSec = options?.previewPlayheadSec ?? null;
  const layout = computeSetLayout(sorted, entryMap);
  const { syncing, syncError } = useDjEngineSync(
    layout.lanes,
    enabled && driveEngine && engineRoute === "dj",
  );
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const canDriveEngine = engineTracksReady && !syncing;

  const [transitionPlans, setTransitionPlans] = useState<Record<number, TransitionPlanData | null>>({});
  const rafRef = useRef(0);
  const prevSnapRef = useRef<ReturnType<typeof computeBoothSnapshot> | null>(null);
  const prevSnapKeyRef = useRef("");
  const visualPosRef = useRef(new VisualPlayPosition());
  const waveCachesRef = useRef<Record<string, WaveformCache | null>>({});
  const entryMarkersRef = useRef<Record<string, CatalogMarker[]>>({});

  const transKey = layout.transitions
    .map(t => `${t.fromEntryId}:${t.toEntryId}`)
    .join("|");

  const entryKey = sorted.map(c => c.entryId).join(",");

  useEffect(() => {
    if (!enabled) return;
    for (const card of sorted) {
      const entry = entryMap.get(card.entryId);
      if (!entry?.file_path || card.entryId in waveCachesRef.current) continue;
      waveCachesRef.current[card.entryId] = null;
      loadWaveformCache(entry.file_path)
        .then(c => { waveCachesRef.current[card.entryId] = c; })
        .catch(() => { waveCachesRef.current[card.entryId] = null; });
    }
  }, [enabled, entryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    for (const card of sorted) {
      if (card.entryId in entryMarkersRef.current) continue;
      entryMarkersRef.current[card.entryId] = [];
      apiClient.select.listMarkers(card.entryId)
        .then(m => { entryMarkersRef.current[card.entryId] = m; })
        .catch(() => { entryMarkersRef.current[card.entryId] = []; });
    }
  }, [enabled, entryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    for (const t of layout.transitions) {
      apiClient.select.planTransition(t.fromEntryId, t.toEntryId)
        .then(p => setTransitionPlans(prev => ({ ...prev, [t.index]: p })))
        .catch(() => setTransitionPlans(prev => ({ ...prev, [t.index]: null })));
    }
  }, [enabled, transKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || sorted.length < 2) {
      resetMeterStates();
      useStudioDeckStore.getState().reset();
      useStudioAutomationStore.getState().reset();
      useStudioLaneStore.getState().reset();
      useBoothStore.getState().reset();
      return;
    }

    const tick = () => {
      const { positionSeconds, isPlaying } = useTransportStore.getState();
      const usePreview = previewPlayheadSec != null && !isPlaying;
      const rawPlayhead = usePreview ? previewPlayheadSec : positionSeconds;
      visualPosRef.current.sync(rawPlayhead, isPlaying && !usePreview);
      const smoothPlayhead = usePreview ? previewPlayheadSec! : visualPosRef.current.interpolate();
      const booth = useBoothStore.getState();
      const snapshot = computeBoothSnapshot({
        sorted,
        entryMap,
        playheadSec: smoothPlayhead,
        isPlaying,
        prevSnapshot: prevSnapRef.current,
        mode: booth.mode,
        transitionPlans,
        interactiveChannels: booth.interactiveChannels,
        engineRoute,
        waveCaches: waveCachesRef.current,
        entryMarkers: entryMarkersRef.current,
        laneMixes: useStudioDeckStore.getState().mixes,
        nowMs: performance.now(),
      });

      const snapKey = [
        smoothPlayhead.toFixed(2),
        isPlaying ? 1 : 0,
        booth.mode,
        snapshot.currentTransitionIndex ?? -1,
        snapshot.channels.map(c => c.faderDb.toFixed(0)).join(","),
      ].join("|");
      if (snapKey !== prevSnapKeyRef.current) {
        prevSnapKeyRef.current = snapKey;
        useBoothStore.getState().setSnapshot(snapshot);
      }
      if (driveEngine && canDriveEngine) {
        // Engine uses transport playhead; booth visuals use smoothed interpolation.
        const enginePlayhead = usePreview ? previewPlayheadSec! : positionSeconds;
        pushBoothToEngine(
          snapshot,
          engineRoute,
          engineRoute === "set"
            ? {
                lanes: layout.lanes,
                mixes: useStudioDeckStore.getState().mixes,
                playheadSec: enginePlayhead,
                isPlaying,
                mode: booth.mode,
                activeTrans: findActiveTransition(layout.transitions, enginePlayhead),
              }
            : undefined,
        );
      }
      prevSnapRef.current = snapshot;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, sorted, entryMap, transitionPlans, canDriveEngine, driveEngine, engineRoute, previewPlayheadSec]);

  return { syncing, syncError };
}
