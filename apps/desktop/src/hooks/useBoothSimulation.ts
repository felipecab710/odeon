/**
 * Runs booth simulation loop — syncs transport → boothStore → engine.
 */
import { useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../stores/setBuilderStore";
import { useTransportStore } from "../stores/transportStore";
import { useBoothStore } from "../stores/boothStore";
import { computeBoothSnapshot, pushBoothToEngine } from "../lib/boothSimulation";
import { useDjEngineSync } from "../lib/useDjEngineSync";
import { VisualPlayPosition } from "../lib/visualPlayPosition";
import { computeSetLayout } from "../components/setbuilder/setTimelineLayout";
import { apiClient, type TransitionPlanData } from "../lib/apiClient";

export function useBoothSimulation(
  enabled: boolean,
  sorted: SetCard[],
  entryMap: Map<string, CatalogEntry>,
) {
  const layout = computeSetLayout(sorted, entryMap);
  const { syncing, syncError } = useDjEngineSync(layout.lanes, enabled);
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const canDriveEngine = engineTracksReady && !syncing;

  const [transitionPlans, setTransitionPlans] = useState<Record<number, TransitionPlanData | null>>({});
  const rafRef = useRef(0);
  const prevSnapRef = useRef<ReturnType<typeof computeBoothSnapshot> | null>(null);
  const visualPosRef = useRef(new VisualPlayPosition());

  const transKey = layout.transitions
    .map(t => `${t.fromEntryId}:${t.toEntryId}`)
    .join("|");

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
      useBoothStore.getState().reset();
      return;
    }

    const tick = () => {
      const { positionSeconds, isPlaying } = useTransportStore.getState();
      visualPosRef.current.sync(positionSeconds, isPlaying);
      const smoothPlayhead = visualPosRef.current.interpolate();
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
      });

      useBoothStore.getState().setSnapshot(snapshot);
      if (canDriveEngine) {
        pushBoothToEngine(snapshot);
      }
      prevSnapRef.current = snapshot;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, sorted, entryMap, transitionPlans, canDriveEngine]);

  return { syncing, syncError };
}
