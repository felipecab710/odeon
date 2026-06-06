/**
 * Interactive booth control — patch channel/deck and push to engine.
 */
import type { DJMChannelState } from "../stores/boothStore";
import type { DeckMix, CfAssign } from "./deckMixEngine";
import {
  applyDeckMixToEngine,
  defaultDeckMix,
} from "./deckMixEngine";

export function channelToDeckMix(ch: DJMChannelState): DeckMix {
  return {
    ...defaultDeckMix(),
    trimDb: ch.trimDb,
    faderDb: ch.signalFaderDb ?? ch.faderDb,
    high: ch.high,
    mid: ch.mid,
    low: ch.low,
    filter: ch.filter,
    cfAssign: ch.cfAssign,
    cue: ch.cue,
    solo: ch.solo,
    mute: ch.mute,
    showAutomation: true,
  };
}

export function pushChannelToEngine(
  ch: DJMChannelState,
  crossfaderPos: number,
): void {
  if (!ch.entryId) return;
  applyDeckMixToEngine(ch.entryId, channelToDeckMix(ch), crossfaderPos);
}

export function patchChannelField<K extends keyof DJMChannelState>(
  channels: DJMChannelState[],
  index: number,
  key: K,
  value: DJMChannelState[K],
  crossfaderPos: number,
): DJMChannelState[] {
  const next = channels.map((c, i) =>
    i === index ? { ...c, [key]: value } : c,
  );
  const ch = next[index];
  if (ch?.entryId) pushChannelToEngine(ch, crossfaderPos);
  return next;
}

export function toggleChannelFlag(
  channels: DJMChannelState[],
  index: number,
  key: "cue" | "solo" | "mute",
  crossfaderPos: number,
  exclusiveCue = true,
): DJMChannelState[] {
  let next = [...channels];
  const val = !next[index][key];

  if (key === "cue" && exclusiveCue && val) {
    next = next.map((c, i) => ({ ...c, cue: i === index }));
  } else {
    next[index] = { ...next[index], [key]: val };
  }

  next.forEach(ch => { if (ch.entryId) pushChannelToEngine(ch, crossfaderPos); });
  return next;
}

export function setCfAssign(
  channels: DJMChannelState[],
  index: number,
  assign: CfAssign,
  crossfaderPos: number,
): DJMChannelState[] {
  return patchChannelField(channels, index, "cfAssign", assign, crossfaderPos);
}
