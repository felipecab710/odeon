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
  applyDeckMixToEngine,
  deckTrackId,
  effectiveVolumeDb,
  setTrackId,
} from "./deckMixEngine";
import { engineClient } from "./engineClient";
import { useEngineStore } from "../stores/engineStore";
import { assignDeckLanes } from "./boothDeckAssign";
import { mossFxFromPlan } from "./boothMossFx";
import type { TransitionPlanData } from "./apiClient";
import type { BoothMode } from "../stores/boothStore";
import { djSyncCoordinator } from "./djSyncCoordinator";
import { simulateChannelMeters } from "./boothMeterSim";
import type { WaveformCache } from "./waveformEngine/types";
import {
  firstCueSec,
  indicatorToLit,
  pioneerIndicators,
  vinylAngleFromPositionSec,
} from "./boothTransportSim";
import { useStudioAutomationStore } from "../stores/studioAutomationStore";
import { applyLaneAutomation } from "./applyLaneAutomation";

const GAIN_TO_DB = (g: number) => (g <= 0.001 ? -60 : 20 * Math.log10(g));

function laneActiveAt(lane: LaneLayout, playheadSec: number): boolean {
  return playheadSec >= lane.startSec && playheadSec < lane.endSec;
}

/** Merge timeline deck mix with transition automation when enabled. */
function resolveDeckMixForChannel(
  mix: DeckMix,
  lane: LaneLayout | null,
  inTransition: boolean,
  transT: number,
  isOutgoing: boolean,
  playheadSec: number,
): DeckMix & { signalFaderDb: number } {
  if (!lane) return { ...mix, faderDb: -60, signalFaderDb: -60 };

  const active = laneActiveAt(lane, playheadSec);
  let displayFader = mix.faderDb;
  let signalFader = active ? mix.faderDb : -60;
  let filter = mix.filter;
  let low = mix.low;

  const globalAutomation = useStudioAutomationStore.getState().globalEnabled;
  const curves = lane
    ? useStudioAutomationStore.getState().tracks[lane.index]?.curves
    : undefined;
  const automated = applyLaneAutomation(mix, curves, playheadSec, {
    inTransition,
    transT,
    isOutgoing,
    globalEnabled: globalAutomation,
  });

  if (globalAutomation && mix.showAutomation) {
    displayFader = automated.faderDb;
    signalFader = active ? automated.faderDb : -60;
    filter = automated.filter;
    low = automated.low;
  } else if (inTransition && mix.showAutomation) {
    const gain = transitionGainCurve(transT, isOutgoing);
    const autoDb = GAIN_TO_DB(gain);
    displayFader = autoDb;
    signalFader = active ? autoDb : -60;
    filter = mix.filter + transitionFilterCurve(transT, isOutgoing) * 12;
    const eqKill = transitionEqKillCurve(transT, isOutgoing);
    if (eqKill < 0) low = Math.min(low, eqKill);
  }

  if (mix.mute) signalFader = -60;

  return { ...mix, faderDb: displayFader, signalFaderDb: signalFader, filter, low };
}

function trackTitle(e: CatalogEntry): string {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

export function findActiveTransition(
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
  bpm: number,
  prevDeck: CDJDeckState | undefined,
  playRate = 1,
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
      jogAngle: 0,
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
  const dur = entry.duration_seconds ?? 240;
  const laneActive = laneActiveAt(lane, playheadSec);
  // Freeze local position when off-timeline — don't let global playhead keep spinning the platter.
  let localPos: number;
  if (!laneActive) {
    localPos = playheadSec >= lane.endSec ? dur : 0;
  } else {
    localPos = Math.max(0, Math.min(dur, playheadSec - lane.startSec));
  }
  const laneBpm = entry.bpm ?? bpm;
  const loopActive = prevDeck?.loopActive ?? false;
  const loopIn = prevDeck?.loopInSec ?? 0;
  const loopOut = prevDeck?.loopOutSec ?? Math.min(dur, loopIn + 16);
  localPos = applyLoopWrap(localPos, loopActive && laneActive, loopIn, loopOut);
  const deckPlaying = isPlaying && laneActive;

  return {
    deckIndex,
    entryId: lane.card.entryId,
    title: trackTitle(entry),
    artist: entry.artist ?? "",
    bpm: laneBpm,
    key: entry.key ?? "—",
    positionSec: localPos,
    durationSec: dur,
    isPlaying: deckPlaying,
    isLoaded: true,
    jogAngle: vinylAngleFromPositionSec(localPos, deckPlaying ? playRate : 0),
    pitchPercent: (playRate - 1) * 100,
    playLit: deckPlaying,
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
  playheadSec: number,
  isPlaying: boolean,
  engineRoute: "set" | "dj",
  waveCaches: Record<string, WaveformCache | null> | undefined,
  nowMs: number,
  crossfaderPos: number,
): DJMChannelState {
  const resolved = resolveDeckMixForChannel(
    mix, lane, inTransition, transT, isOutgoing, playheadSec,
  );
  const {
    trimDb, high, mid, low, filter, faderDb, signalFaderDb, cfAssign, cue, solo, mute,
  } = resolved;

  const trackId = lane?.card.entryId
    ? (engineRoute === "set" ? setTrackId(lane.card.entryId) : deckTrackId(chIndex))
    : null;
  const meters = trackId
    ? useEngineStore.getState().trackStates[trackId]
    : null;

  const localPos = lane ? Math.max(0, playheadSec - lane.startSec) : 0;
  const cache = lane?.card.entryId ? waveCaches?.[lane.card.entryId] : null;
  const meterMix: DeckMix = {
    ...defaultDeckMix(),
    trimDb,
    faderDb: signalFaderDb,
    cfAssign,
    mute,
  };
  const meterFaderDb = effectiveVolumeDb(meterMix, crossfaderPos, engineRoute);
  const { meterL, meterR } = simulateChannelMeters({
    entryId: lane?.card.entryId ?? `ch-${chIndex}`,
    cache,
    localPosSec: localPos,
    faderDb: meterFaderDb,
    isPlaying: isPlaying && meterFaderDb > -50,
    engineL: meters?.leftMeterDb,
    engineR: meters?.rightMeterDb,
    enginePeakL: meters?.peakLeftDb,
    enginePeakR: meters?.peakRightDb,
    bpm: lane?.entry.bpm ?? undefined,
    nowMs,
  });

  return {
    channelIndex: chIndex,
    entryId: lane?.card.entryId ?? null,
    deckLabel: lane ? `Deck ${chIndex + 1}` : `CH ${chIndex + 1}`,
    color: DECK_COLORS[chIndex],
    trimDb,
    high,
    mid,
    low,
    filter,
    faderDb,
    signalFaderDb,
    cfAssign,
    cue,
    solo,
    mute,
    meterL,
    meterR,
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
  engineRoute?: "set" | "dj";
  waveCaches?: Record<string, WaveformCache | null>;
  /** Timeline lane mixes keyed by lane index — drives Pioneer booth + engine. */
  laneMixes?: Record<number, DeckMix>;
  /** Wall clock for Pioneer LED blink phases (Mixxx ControlIndicator). */
  nowMs?: number;
  /** Per-deck playback rate from sync coordinator (1 = nominal pitch). */
  deckRates?: Record<number, number>;
}

export function computeBoothSnapshot(input: SimulationInput): BoothSnapshot {
  const {
    sorted, entryMap, playheadSec, isPlaying, prevSnapshot,
    mode, transitionPlans, interactiveChannels, engineRoute = "dj", waveCaches,
    laneMixes,
    nowMs = performance.now(),
    deckRates,
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
    mixes[i] = laneMixes?.[i] ?? defaultDeckMix();
  }

  const prevDecks = prevSnapshot?.decks ?? [];

  const resolvedDeckRates: Record<number, number> = { ...deckRates };
  if (mode === "simulation" && activeTrans) {
    const leaderIdx = deckLanes.findIndex(
      l => l?.card.entryId === activeTrans.transition.fromEntryId,
    );
    const leaderBpm = leaderIdx >= 0
      ? (deckLanes[leaderIdx]?.entry.bpm ?? 128)
      : 128;
    for (let i = 0; i < deckLanes.length; i++) {
      const lane = deckLanes[i];
      if (!lane) {
        resolvedDeckRates[i] = 1;
        continue;
      }
      if (i === leaderIdx) {
        resolvedDeckRates[i] = 1;
      } else {
        const bpm = lane.entry.bpm ?? 128;
        resolvedDeckRates[i] = Math.max(0.5, Math.min(2, leaderBpm / bpm));
      }
    }
  }

  const decks: CDJDeckState[] = deckLanes.map((lane, i) => {
    const laneActive = !!lane
      && playheadSec >= lane.startSec
      && playheadSec < lane.endSec;
    const deckPlaying = isPlaying && laneActive;
    const playRate = resolvedDeckRates[i] ?? 1;
    const base = buildDeckState(
      i,
      lane,
      deckPlaying,
      playheadSec,
      layout.lanes[0]?.entry.bpm ?? 128,
      prevDecks[i],
      playRate,
    );
    const cueSec = firstCueSec(base.hotCueTimes, base.hotCueSlots);
    const indicators = pioneerIndicators({
      isLoaded: base.isLoaded,
      deckPlaying,
      localPosSec: base.positionSec,
      cueSec,
      durationSec: base.durationSec,
    });
    return {
      ...base,
      playLit: indicatorToLit(indicators.play, nowMs),
      cueLit: indicatorToLit(indicators.cue, nowMs),
    };
  });

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
          rate: resolvedDeckRates[i] ?? 1,
          loaded: d.isLoaded,
        })),
      );
    }
  }

  let channels: DJMChannelState[] = [0, 1, 2, 3].map(chIndex => {
    const lane = deckLanes[chIndex];
    let mix = lane ? { ...(mixes[lane.index] ?? defaultDeckMix()) } : defaultDeckMix();

    let inTransition = false;
    let transT = 0;
    let isOutgoing = false;

    if (activeTrans && lane && mode === "simulation") {
      const tr = activeTrans.transition;
      if (lane.card.entryId === tr.fromEntryId) {
        inTransition = true;
        transT = activeTrans.t;
        isOutgoing = true;
        mix.cfAssign = "A";
      } else if (lane.card.entryId === tr.toEntryId) {
        inTransition = true;
        transT = activeTrans.t;
        isOutgoing = false;
        mix.cfAssign = "B";
      }
    }

    const base = buildChannelState(
      chIndex, lane, mix, inTransition, transT, isOutgoing,
      playheadSec, isPlaying, engineRoute, waveCaches, nowMs, crossfaderPos,
    );
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
        signalFaderDb: ic.faderDb,
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

export interface SetEnginePushContext {
  lanes: LaneLayout[];
  mixes: Record<number, DeckMix>;
  playheadSec: number;
  isPlaying: boolean;
  mode: BoothMode;
  activeTrans: { transition: TransitionRegion; t: number } | null;
}

/** Volume for set-preview engine — clips gate playback; don't silence by lane-active UI. */
function resolveSetLaneEngineVolume(
  mix: DeckMix,
  lane: LaneLayout,
  playheadSec: number,
  inTransition: boolean,
  transT: number,
  isOutgoing: boolean,
): number {
  if (mix.mute) return -60;
  const globalAutomation = useStudioAutomationStore.getState().globalEnabled;
  const curves = useStudioAutomationStore.getState().tracks[lane.index]?.curves;
  const automated = applyLaneAutomation(mix, curves, playheadSec, {
    inTransition,
    transT,
    isOutgoing,
    globalEnabled: globalAutomation,
  });
  return Math.max(-60, automated.faderDb);
}

function pushSetLaneMixes(
  ctx: SetEnginePushContext,
  crossfaderPos: number,
): void {
  for (const lane of ctx.lanes) {
    let mix = { ...(ctx.mixes[lane.index] ?? defaultDeckMix()) };
    let inTransition = false;
    let transT = 0;
    let isOutgoing = false;

    if (ctx.activeTrans && ctx.mode === "simulation") {
      const tr = ctx.activeTrans.transition;
      if (lane.card.entryId === tr.fromEntryId) {
        inTransition = true;
        transT = ctx.activeTrans.t;
        isOutgoing = true;
      } else if (lane.card.entryId === tr.toEntryId) {
        inTransition = true;
        transT = ctx.activeTrans.t;
        isOutgoing = false;
      }
    }

    const globalAutomation = useStudioAutomationStore.getState().globalEnabled;
    const curves = ctx.mixes[lane.index]
      ? useStudioAutomationStore.getState().tracks[lane.index]?.curves
      : undefined;
    const automated = applyLaneAutomation(mix, curves, ctx.playheadSec, {
      inTransition,
      transT,
      isOutgoing,
      globalEnabled: globalAutomation,
    });

    const pushMix: DeckMix = {
      ...defaultDeckMix(),
      trimDb: mix.trimDb,
      faderDb: resolveSetLaneEngineVolume(
        mix, lane, ctx.playheadSec, inTransition, transT, isOutgoing,
      ),
      high: automated.high,
      mid: automated.mid,
      low: automated.low,
      filter: automated.filter,
      cfAssign: "THRU",
      cue: false,
      solo: false,
      mute: mix.mute,
      showAutomation: mix.showAutomation,
    };
    applyDeckMixToEngine(lane.card.entryId, pushMix, crossfaderPos);
  }
}

/** Push timeline deck mixes to set-preview engine (independent of booth RAF). */
export function pushSetEngineMixes(
  lanes: LaneLayout[],
  transitions: TransitionRegion[],
  mixes: Record<number, DeckMix>,
  playheadSec: number,
  mode: BoothMode = "simulation",
): void {
  pushSetLaneMixes(
    {
      lanes,
      mixes,
      playheadSec,
      isPlaying: true,
      mode,
      activeTrans: findActiveTransition(transitions, playheadSec),
    },
    0.5,
  );
}

/** Push computed channel mixes to engine. */
export function pushBoothToEngine(
  snapshot: BoothSnapshot,
  route: "set" | "dj" = "dj",
  setCtx?: SetEnginePushContext,
): void {
  if (route !== "set") {
    void engineClient.setCrossfader(snapshot.mixer.crossfaderPos);
  }

  if (route === "set" && setCtx) {
    pushSetLaneMixes(setCtx, snapshot.mixer.crossfaderPos);
    return;
  }

  const slotMixes: Record<number, DeckMix> = {};
  snapshot.channels.forEach(ch => {
    if (!ch.entryId) return;
    const faderDb = snapshot.mode === "simulation"
      ? ch.signalFaderDb
      : (ch.signalFaderDb || ch.faderDb || 0);
    const mix: DeckMix = {
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
    slotMixes[ch.channelIndex] = mix;
  });
  if (Object.keys(slotMixes).length > 0) {
    applyAllDeckMixesBySlot(slotMixes, snapshot.mixer.crossfaderPos);
  }
}
