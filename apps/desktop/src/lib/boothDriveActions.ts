/**
 * Drive mode deck actions — hot cues, loops, cue jump.
 */
import { engineClient, unwrapEngineResult } from "./engineClient";
import { useBoothStore } from "../stores/boothStore";

export async function driveSetHotcue(
  deckIndex: number,
  slot: number,
  timeSeconds: number,
): Promise<void> {
  await unwrapEngineResult(
    await engineClient.deckSetHotcue(deckIndex, slot, timeSeconds),
  );
  const deck = useBoothStore.getState().decks[deckIndex];
  const slots = [...deck.hotCueSlots];
  const times = [...deck.hotCueTimes];
  slots[slot] = true;
  times[slot] = timeSeconds;
  useBoothStore.getState().patchDeck(deckIndex, { hotCueSlots: slots, hotCueTimes: times });
}

export async function driveJumpHotcue(deckIndex: number, slot: number): Promise<void> {
  await unwrapEngineResult(await engineClient.deckJumpHotcue(deckIndex, slot));
}

export async function driveClearHotcue(deckIndex: number, slot: number): Promise<void> {
  await unwrapEngineResult(await engineClient.deckClearHotcue(deckIndex, slot));
  const deck = useBoothStore.getState().decks[deckIndex];
  const slots = [...deck.hotCueSlots];
  const times = [...deck.hotCueTimes];
  slots[slot] = false;
  times[slot] = null;
  useBoothStore.getState().patchDeck(deckIndex, { hotCueSlots: slots, hotCueTimes: times });
}

export async function driveToggleLoop(
  deckIndex: number,
  enabled: boolean,
  inSeconds: number,
  outSeconds: number,
): Promise<void> {
  await unwrapEngineResult(
    await engineClient.deckSetLoop(deckIndex, enabled, inSeconds, outSeconds),
  );
  useBoothStore.getState().patchDeck(deckIndex, {
    loopActive: enabled,
    loopInSec: inSeconds,
    loopOutSec: outSeconds,
  });
}

export async function driveCueToStart(deckIndex: number): Promise<void> {
  await unwrapEngineResult(await engineClient.deckSeek(deckIndex, 0));
}
