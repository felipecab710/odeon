/**
 * Booth simulation driver — maps set arrangement + transport → Pioneer twin state.
 */
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../stores/setBuilderStore";
import type { BoothSnapshot, CDJDeckState, DJMChannelState } from "../stores/boothStore";
import { DECK_COLORS } from "../stores/boothStore";
import {
  computeSetLayout,
  type LaneLayout,
  type TransitionRegion,
} from "../components/setbuilder/setTimelineLayout";
import {
  transitionGainCurve,
  transitionFilterCurve,
  transitionEqKillCurve,
  transitionCrossfaderPos,
} from "./boothCurves";
import {
  type DeckMix,
  defaultDeckMix,
  applyAllDeckMixesBySlot,
  deckTrackId,
} from "./deckMixEngine";
import { useEngineStore } from "../stores/engineStore";
import { assignDeckLanes } from "./boothDeckAssign";
import { mossFxFromPlan } from "./boothMossFx";
import type { TransitionPlanData } from "./apiClient";
import type { BoothMode } from "../stores/boothStore";
import { djSyncCoordinator } from "./djSyncCoordinator";

const GAIN_TO_DB = (g: number) => (g <= 0.001 ? -60 : 20 * Math.log10(g));

function trackTitle(e: CatalogEntry): string {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

function findActiveTransition(
  transitions: TransitionRegion[],
  playheadSec: number,
): { transition: TransitionRegion; t: number } | null {
  for (const tr of transitions) {
    if (playheadSec >= tr.startSec && playheadSec <= tr.endSec) {
      const dur = tr.endSec - tr.startSec;
      const t = dur > 0 ? (playheadSec - tr.startSec) / dur : 0;
      return { transition: tr, t };
    }
  }
  return null;
}

function applyLoopWrap(
  localPos: number,
  loopActive: boolean,
  loopIn: number,
  loopOut: number,
): number {
  if (!loopActive || loopOut <= loopIn + 0.05) return localPos;
  if (localPos < loopOut) return localPos;
  const span = loopOut - loopIn;
  return loopIn + ((localPos - loopIn) % span);
}

function buildDeckState(
  deckIndex: number,
  lane: LaneLayout | null,
  isPlaying: boolean,
  playheadSec: number,
  prevJogAngle: number,
  bpm: number,
  prevDeck: CDJDeckState | undefined,
): CDJDeckState {
  if (!lane) {
    return {
      deckIndex,
      entryId: null,
      title: "Empty",
      artist: "",
      bpm: 128,
      key: "—",
      positionSec: 0,
      durationSec: 0,
      isPlaying: false,
      isLoaded: false,
      jogAngle: prevJogAngle,
      pitchPercent: 0,
      playLit: false,
      cueLit: false,
      hotCueSlots: Array(8).fill(false),
      hotCueTimes: Array(8).fill(null),
      loopActive: false,
      loopInSec: 0,
      loopOutSec: 0,
    };
  }

  const entry = lane.entry;
  let localPos = Math.max(0, playheadSec - lane.startSec);
  const dur = entry.duration_seconds ?? 240;
  const laneBpm = entry.bpm ?? bpm;
  const loopActive = prevDeck?.loopActive ?? false;
  const loopIn = prevDeck?.loopInSec ?? 0;
  const loopOut = prevDeck?.loopOutSec ?? Math.min(dur, loopIn + 16);
  localPos = applyLoopWrap(localPos, loopActive, loopIn, loopOut);
  const jogDelta = isPlaying ? (laneBpm / 60) * 360 * (1 / 60) : 0;

  return {
    deckIndex,
    entryId: lane.card.entryId,
    title: trackTitle(entry),
    artist: entry.artist ?? "",
    bpm: laneBpm,
    key: entry.key ?? "—",
    positionSec: localPos,
    durationSec: dur,
    isPlaying,
    isLoaded: true,
    jogAngle: (prevJogAngle + jogDelta) % 360,
    pitchPercent: 0,
    playLit: isPlaying,
    cueLit: false,
    hotCueSlots: prevDeck?.hotCueSlots ?? Array(8).fill(false),
    hotCueTimes: prevDeck?.hotCueTimes ?? Array(8).fill(null),
    loopActive,
    loopInSec: loopIn,
    loopOutSec: loopOut,
  };
}

function buildChannelState(
  chIndex: number,
  lane: LaneLayout | null,
  mix: DeckMix,
  inTransition: boolean,
  transT: number,
  isOutgoing: boolean,
): DJMChannelState {
  let high = mix.high;
  let mid = mix.mid;
  let low = mix.low;
  let filter = mix.filter;
  let faderDb = mix.faderDb;

  if (inTransition && lane) {
    const gain = transitionGainCurve(transT, isOutgoing);
    faderDb = GAIN_TO_DB(gain);
    filter = transitionFilterCurve(transT, isOutgoing) * 12;
    const eqKill = transitionEqKillCurve(transT, isOutgoing);
    if (eqKill < 0) low = eqKill;
  }

  const trackId = lane != null ? deckTrackId(chIndex) : null;
  const meters = trackId
    ? useEngineStore.getState().trackStates[trackId]
    : null;

  return {
    channelIndex: chIndex,
    entryId: lane?.card.entryId ?? null,
    deckLabel: lane ? `Deck ${chIndex + 1}` : `CH ${chIndex + 1}`,
    color: DECK_COLORS[chIndex],
    trimDb: mix.trimDb,
    high,
    mid,
    low,
    filter,
    faderDb,
    cfAssign: mix.cfAssign,
    cue: mix.cue,
    solo: mix.solo,
    mute: mix.mute,
    meterL: meters?.leftMeterDb ?? -90,
    meterR: meters?.rightMeterDb ?? -90,
    beatFxActive: inTransition && isOutgoing,
  };
}

export interface SimulationInput {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  playheadSec: number;
  isPlaying: boolean;
  prevSnapshot: BoothSnapshot | null;
  mode: BoothMode;
  transitionPlans: Record<number, TransitionPlanData | null>;
  interactiveChannels: DJMChannelState[] | null;
}

export function computeBoothSnapshot(input: SimulationInput): BoothSnapshot {
  const {
    sorted, entryMap, playheadSec, isPlaying, prevSnapshot,
    mode, transitionPlans, interactiveChannels,
  } = input;
  const layout = computeSetLayout(sorted, entryMap);
  const { lanes, transitions } = layout;

  const activeTrans = findActiveTransition(transitions, playheadSec);
  let crossfaderPos = mode === "interactive" && prevSnapshot
    ? prevSnapshot.mixer.crossfaderPos
    : 0.5;
  let transitionIndex: number | null = null;
  let mossReason: string | null = null;
  let transitionStrategy: string | null = null;
  let mossFx = { beatFxName: "DELAY", soundColorFx: "SPACE" };

  if (activeTrans) {
    transitionIndex = activeTrans.transition.index;
    if (mode === "simulation") {
      crossfaderPos = transitionCrossfaderPos(activeTrans.t);
    }
    const plan = transitionPlans[activeTrans.transition.index];
    const hints = mossFxFromPlan(plan);
    mossFx = hints;
    mossReason = hints.reason ?? null;
    transitionStrategy = plan?.strategy ?? null;
  }

  const deckSlotIndices = assignDeckLanes(lanes, playheadSec, activeTrans);
  const deckLanes: (LaneLayout | null)[] = deckSlotIndices.map(
    idx => idx >= 0 ? lanes[idx] : null,
  );

  const mixes: Record<number, DeckMix> = {};
  for (let i = 0; i < lanes.length; i++) {
    mixes[i] = {
      ...defaultDeckMix(),
      cfAssign: i % 2 === 0 ? "A" : "B",
      faderDb: 0,
    };
  }

  const prevDecks = prevSnapshot?.decks ?? [];

  const decks: CDJDeckState[] = deckLanes.map((lane, i) =>
    buildDeckState(
      i,
      lane,
      isPlaying && !!lane && playheadSec >= (lane?.startSec ?? 0) && playheadSec < (lane?.endSec ?? 0),
      playheadSec,
      prevDecks[i]?.jogAngle ?? 0,
      layout.lanes[0]?.entry.bpm ?? 128,
      prevDecks[i],
    ),
  );

  if (mode === "simulation" && activeTrans) {
    const outLane = lanes.find(l => l.card.entryId === activeTrans.transition.fromEntryId);
    const leaderSlot = deckSlotIndices.findIndex(
      idx => idx >= 0 && lanes[idx]?.card.entryId === activeTrans.transition.fromEntryId,
    );
    if (leaderSlot >= 0 && outLane) {
      djSyncCoordinator.setLeader(leaderSlot, outLane.entry.bpm ?? 128);
      djSyncCoordinator.syncFollowers(
        decks.map((d, i) => ({
          deckIndex: i,
          bpm: d.bpm,
          rate: 1,
          loaded: d.isLoaded,
        })),
      );
    }
  }

  let channels: DJMChannelState[] = [0, 1, 2, 3].map(chIndex => {
    const lane = deckLanes[chIndex];
    const mix = lane ? (mixes[lane.index] ?? defaultDeckMix()) : defaultDeckMix();

    let inTransition = false;
    let transT = 0;
    let isOutgoing = false;

    if (activeTrans && lane && mode === "simulation") {
      const tr = activeTrans.transition;
      if (lane.card.entryId === tr.fromEntryId) {
        inTransition = true;
        transT = activeTrans.t;
        isOutgoing = true;
      } else if (lane.card.entryId === tr.toEntryId) {
        inTransition = true;
        transT = activeTrans.t;
        isOutgoing = false;
      }
    }

    const base = buildChannelState(chIndex, lane, mix, inTransition, transT, isOutgoing);
    if (interactiveChannels?.[chIndex]?.entryId === base.entryId) {
      const ic = interactiveChannels[chIndex];
      return {
        ...base,
        trimDb: ic.trimDb,
        high: ic.high,
        mid: ic.mid,
        low: ic.low,
        filter: ic.filter,
        faderDb: ic.faderDb,
        cfAssign: ic.cfAssign,
        cue: ic.cue,
        solo: ic.solo,
        mute: ic.mute,
      };
    }
    return base;
  });

  const masterL = Math.max(...channels.map(c => c.meterL));
  const masterR = Math.max(...channels.map(c => c.meterR));

  const activeLane = lanes.find(l => playheadSec >= l.startSec && playheadSec < l.endSec);

  return {
    mode,
    simulationActive: isPlaying,
    currentTransitionIndex: transitionIndex,
    transitionStrategy,
    mossReason,
    playheadSec,
    decks,
    channels,
    mixer: {
      crossfaderPos,
      masterDb: prevSnapshot?.mixer.masterDb ?? 0,
      masterMeterL: masterL,
      masterMeterR: masterR,
      beatFxOn: activeTrans != null,
      beatFxName: activeTrans ? mossFx.beatFxName : "DELAY",
      beatFxLevel: activeTrans ? activeTrans.t : 0,
      soundColorFx: activeTrans ? mossFx.soundColorFx : "SPACE",
      soundColorParam: activeTrans ? transitionFilterCurve(activeTrans.t, true) : 0,
      headphoneLevel: prevSnapshot?.mixer.headphoneLevel ?? 0.7,
      boothLevel: prevSnapshot?.mixer.boothLevel ?? 0.6,
      tapBpm: activeLane?.entry.bpm ?? lanes[0]?.entry.bpm ?? 128,
    },
  };
}

/** Push computed channel mixes to engine. */
export function pushBoothToEngine(
  snapshot: BoothSnapshot,
): void {
  const mixes: Record<number, DeckMix> = {};

  snapshot.channels.forEach(ch => {
    if (!ch.entryId) return;
    const faderDb = snapshot.mode === "simulation" ? ch.faderDb : (ch.faderDb || 0);
    mixes[ch.channelIndex] = {
      ...defaultDeckMix(),
      trimDb: ch.trimDb,
      faderDb: Math.max(-60, faderDb),
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
  });

  applyAllDeckMixesBySlot(mixes, snapshot.mixer.crossfaderPos);
}
