/**
 * Continuously push set lane mixes + automation to the engine during arrangement preview.
 * Complements one-shot pushes from strip toggles and play-start priming.
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
    if (!enabled || !engineReady || lanes.length === 0) return;
    pushSetEngineMixes(lanes, transitions, mixes, playheadSec, boothMode);
  }, [enabled, engineReady, lanes, transitions, mixes, playheadSec, boothMode]);

  useEffect(() => {
    if (!enabled || !engineReady || !isPlaying || lanes.length === 0) return;
    let raf = 0;
    const tick = () => {
      pushSetEngineMixes(
        lanes,
        transitions,
        useStudioDeckStore.getState().mixes,
        useTransportStore.getState().positionSeconds,
        useBoothStore.getState().mode,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, engineReady, isPlaying, lanes, transitions]);
}
