/**
 * DJM-lite deck mix state + engine volume math.
 *
 * Architecture: Mixxx EngineXfader + EngineMixer orientation buses (A/THRU/B),
 * implemented on Odeon studio engine RPC until true deck players land.
 * See docs/ODEON_DJ_RESEARCH.md
 */
import { engineClient } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";

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

export const SET_PROJECT_ID = "odeon-set-preview";
export const DJ_PROJECT_ID = "odeon-dj-booth";

export function setTrackId(entryId: string): string {
  return `set:${entryId}`;
}

/** Fixed CDJ deck route — Mixxx PlayerManager deck slot */
export function deckTrackId(deckIndex: number): string {
  return `deck:${deckIndex}`;
}

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
 * @param route — Studio set timeline uses per-clip levels only (no A/B bus).
 *   Crossfader is visual on the booth; the engine already mixes overlapping clips.
 */
export function effectiveVolumeDb(
  mix: DeckMix,
  crossfaderPos: number,
  route: "set" | "dj" = "dj",
): number {
  const base = mix.trimDb + mix.faderDb;
  if (route === "set") {
    return Math.max(-120, Math.min(12, base));
  }
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
  const volumeDb = effectiveVolumeDb(mix, crossfaderPos, route);
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

  engineClient.setTrackVolume(trackId, volumeDb);
  engineClient.muteTrack(trackId, mix.mute);
  // Set timeline has no PFL bus — cue/solo would silence non-soloed arrangement lanes.
  if (route === "dj") {
    engineClient.soloTrack(trackId, soloed);
  } else {
    engineClient.soloTrack(trackId, false);
  }
}

export function applyAllDeckMixes(
  mixes: Record<number, DeckMix>,
  entryIds: string[],
  crossfaderPos: number,
): void {
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
