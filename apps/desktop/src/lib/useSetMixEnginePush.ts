/**
 * One-shot set lane mix push when mixes/lanes change while paused.
 * During playback, useBoothSimulation owns the throttled RAF engine push loop.
 */
import { useEffect } from "react";
import type { LaneLayout, TransitionRegion } from "../components/setbuilder/setTimelineLayout";
import { pushSetEngineMixes } from "./boothSimulation";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { useTransportStore } from "../stores/transportStore";
import { useBoothStore } from "../stores/boothStore";

export function useSetMixEnginePush(
  lanes: LaneLayout[],
  transitions: TransitionRegion[],
  enabled: boolean,
): void {
  const mixes = useStudioDeckStore(s => s.mixes);
  const playheadSec = useTransportStore(s => s.positionSeconds);
  const engineReady = useTransportStore(s => s.engineTracksReady);
  const isPlaying = useTransportStore(s => s.isPlaying);
  const boothMode = useBoothStore(s => s.mode);

  useEffect(() => {
    if (!enabled || !engineReady || isPlaying || lanes.length === 0) return;
    pushSetEngineMixes(lanes, transitions, mixes, playheadSec, boothMode);
  }, [enabled, engineReady, isPlaying, lanes, transitions, mixes, playheadSec, boothMode]);
}
