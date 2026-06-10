/**
 * DJM-lite deck mix state + engine volume math.
 *
 * Architecture: Mixxx EngineXfader + EngineMixer orientation buses (A/THRU/B),
 * implemented on Odeon studio engine RPC until true deck players land.
 * See docs/ODEON_DJ_RESEARCH.md
 */
import { engineClient } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";
import {
  SET_PROJECT_ID,
  deckStemTrackId,
  deckTrackId,
  setStemTrackId,
  setTrackId,
} from "./routeIds";

export type CfAssign = "A" | "THRU" | "B";

export interface DeckMix {
  trimDb: number;
  faderDb: number;
  low: number;
  mid: number;
  high: number;
  filter: number;
  cfAssign: CfAssign;
  solo: boolean;
  cue: boolean;
  mute: boolean;
  showAutomation: boolean;
}

export {
  SET_PROJECT_ID,
  deckTrackId,
  setTrackId,
  setStemTrackId,
  deckStemTrackId,
};

export const DJ_PROJECT_ID = "odeon-dj-booth";

export function defaultDeckMix(): DeckMix {
  return {
    trimDb: 0,
    faderDb: 0,
    low: 0,
    mid: 0,
    high: 0,
    filter: 0,
    cfAssign: "THRU",
    solo: false,
    cue: false,
    mute: false,
    showAutomation: true,
  };
}

/**
 * Mixxx EngineXfader constant-power bus gains (LEFT=0, CENTER=1, RIGHT=2).
 * Returns linear gain 0..1 for the channel's orientation bus.
 */
export function crossfaderWeight(assign: CfAssign, position: number): number {
  const t = Math.max(0, Math.min(1, position));
  const left = Math.cos(t * Math.PI * 0.5);
  const right = Math.sin(t * Math.PI * 0.5);
  const norm = Math.sqrt(left * left + right * right) || 1;
  const nLeft = left / norm;
  const nRight = right / norm;

  if (assign === "A") return nLeft;
  if (assign === "B") return nRight;
  return 1; // THRU → CENTER bus (Mixxx orientation 1)
}

export function crossfaderWeightToDb(weight: number): number {
  if (weight <= 0.00001) return -120;
  return 20 * Math.log10(weight);
}

/**
 * @param route — Set timeline uses engine channel strip (trim+fader+cf on route).
 *   Crossfader position is pushed via setCrossfader before lane mixes.
 */
export function effectiveVolumeDb(mix: DeckMix, crossfaderPos: number): number {
  const base = mix.trimDb + mix.faderDb;
  const cfDb = crossfaderWeightToDb(crossfaderWeight(mix.cfAssign, crossfaderPos));
  return Math.max(-120, Math.min(12, base + cfDb));
}

export function applyDeckMixToEngine(
  entryId: string,
  mix: DeckMix,
  crossfaderPos: number,
): void {
  applyDeckMixByTrackId(setTrackId(entryId), mix, crossfaderPos);
}

export function applyDeckMixBySlot(
  deckIndex: number,
  mix: DeckMix,
  crossfaderPos: number,
): void {
  applyDeckMixByTrackId(deckTrackId(deckIndex), mix, crossfaderPos);
}

function parseDeckIndex(trackId: string): number | null {
  const m = /^deck:(\d+)$/.exec(trackId);
  return m ? Number(m[1]) : null;
}

function applyDeckMixByTrackId(
  trackId: string,
  mix: DeckMix,
  crossfaderPos: number,
): void {
  const route = trackId.startsWith("set:") ? "set" : "dj";
  const volumeDb = effectiveVolumeDb(mix, crossfaderPos);
  const soloed = mix.solo || mix.cue;
  const deckIndex = parseDeckIndex(trackId);

  useEngineStore.getState().setTrackState(trackId, {
    volumeDb,
    muted: mix.mute,
    soloed,
  });

  if (deckIndex !== null) {
    engineClient.setDeckChannelMix(deckIndex, {
      trimDb: mix.trimDb,
      faderDb: mix.faderDb,
      lowDb: mix.low,
      midDb: mix.mid,
      highDb: mix.high,
      filter: mix.filter,
      orientation: mix.cfAssign,
      muted: mix.mute,
      pfl: soloed,
    });
    return;
  }

  if (route === "set") {
    engineClient.setTrackChannelMix(trackId, {
      trimDb: mix.trimDb,
      faderDb: mix.faderDb,
      lowDb: mix.low,
      midDb: mix.mid,
      highDb: mix.high,
      filter: mix.filter,
      orientation: mix.cfAssign,
      muted: mix.mute,
    });
    return;
  }

  engineClient.setTrackVolume(trackId, volumeDb);
  engineClient.muteTrack(trackId, mix.mute);
  engineClient.soloTrack(trackId, soloed);
}

export function applyAllDeckMixes(
  mixes: Record<number, DeckMix>,
  entryIds: string[],
  crossfaderPos: number,
): void {
  void engineClient.setCrossfader(crossfaderPos);
  entryIds.forEach((entryId, i) => {
    const mix = mixes[i] ?? defaultDeckMix();
    applyDeckMixToEngine(entryId, mix, crossfaderPos);
  });
}

/** Booth twin — mixes keyed by deck slot index (deck:0..3 routes). */
export function applyAllDeckMixesBySlot(
  mixes: Record<number, DeckMix>,
  crossfaderPos: number,
): void {
  engineClient.setCrossfader(crossfaderPos);
  for (const [key, mix] of Object.entries(mixes)) {
    applyDeckMixBySlot(Number(key), mix, crossfaderPos);
  }
}
