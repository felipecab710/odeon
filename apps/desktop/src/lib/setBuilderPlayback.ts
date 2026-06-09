/**
 * Prime set-preview engine before transport play (faders + lane mixes).
 */
import { useNavigationStore } from "../stores/navigationStore";
import { getActiveUserSet, useSetBuilderStore } from "../stores/setBuilderStore";
import { useSelectStore } from "../stores/selectStore";
import { useTransportStore } from "../stores/transportStore";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { useBoothStore } from "../stores/boothStore";
import { computeSetLayout } from "../components/setbuilder/setTimelineLayout";
import { pushSetEngineMixes } from "./boothSimulation";

export function primeSetBuilderPlaybackIfNeeded(): void {
  if (useNavigationStore.getState().view !== "research") return;
  const cards = getActiveUserSet(useSetBuilderStore.getState()).cards;
  if (cards.length < 2) return;
  if (!useTransportStore.getState().engineTracksReady) return;

  const sorted = [...cards].sort((a, b) => a.order - b.order);
  const entryMap = new Map(useSelectStore.getState().entries.map(e => [e.id, e]));
  const layout = computeSetLayout(sorted, entryMap);
  const playheadSec = useTransportStore.getState().positionSeconds;

  pushSetEngineMixes(
    layout.lanes,
    layout.transitions,
    useStudioDeckStore.getState().mixes,
    playheadSec,
    useBoothStore.getState().mode,
  );
}
