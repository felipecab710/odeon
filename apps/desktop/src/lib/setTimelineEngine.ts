/**
 * Set Builder timeline engine — framework-agnostic coordinator for seek, time
 * conversion, and viewport math (waveform-playlist PlaylistEngine pattern).
 */
import { useTransportStore } from "../stores/transportStore";
import { useBoothStore } from "../stores/boothStore";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { pushSetEngineMixes } from "./boothSimulation";
import { viewTimeRangeFromMetrics } from "./setTimelineViewport";
import type { LaneLayout, TransitionRegion } from "../components/setbuilder/setTimelineLayout";
import {
  contentXFromTimeSec,
  timeToViewportX as playheadAnchorViewportXFn,
} from "./setTimelineViewport";

export {
  contentXFromClientX,
  timeSecFromClientX,
  timeSecFromContentX,
  contentXFromTimeSec,
  timeToViewportX,
  viewportXFromClientX,
  positionToTimeSec,
  hitTestClientX,
  viewTimeRange,
  viewTimeRangeFromMetrics,
} from "./setTimelineViewport";

/** Default project sample rate for sample-accurate snap at clip boundaries. */
export const SET_TIMELINE_SAMPLE_RATE = 44100;

export interface SetTimelineSeekContext {
  lanes: LaneLayout[];
  transitions: TransitionRegion[];
  totalSec: number;
}

/** @deprecated Use SetTimelineSeekContext — viewport math is SetTimelineContext in setTimelineContext.ts */
export type SetTimelineContext = SetTimelineSeekContext;

export function pixelsToTimeSec(deltaPx: number, pixelsPerSecond: number): number {
  return deltaPx / Math.max(pixelsPerSecond, 1e-9);
}

export function timeSecToSample(timeSec: number, sampleRate = SET_TIMELINE_SAMPLE_RATE): number {
  return Math.round(timeSec * sampleRate);
}

export function sampleToTimeSec(sample: number, sampleRate = SET_TIMELINE_SAMPLE_RATE): number {
  return sample / sampleRate;
}

export function getSetViewTimeRange(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerSecond: number,
) {
  return viewTimeRangeFromMetrics({
    scrollLeft,
    viewportWidth,
    pixelsPerSecond,
    totalSec: Infinity,
  });
}

/** Playhead X in timeline content coordinates. */
export function playheadAnchorContentX(playheadSec: number, pixelsPerSecond: number): number {
  return Math.max(0, contentXFromTimeSec(playheadSec, pixelsPerSecond));
}

export function playheadAnchorViewportX(
  playheadSec: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return playheadAnchorViewportXFn(playheadSec, pixelsPerSecond, scrollLeft);
}

/** Seek transport + booth + lane mixes so playback is ready at the new position. */
export async function seekSetTimeline(
  timeSec: number,
  ctx: SetTimelineSeekContext,
): Promise<number> {
  const t = Math.max(0, Math.min(ctx.totalSec, timeSec));
  const transport = useTransportStore.getState();

  if (transport.engineTracksReady) {
    await transport.seek(t);
  } else {
    transport.setPosition(t);
  }

  useBoothStore.getState().setSnapshot({ playheadSec: t });

  if (ctx.lanes.length > 0 && transport.engineTracksReady) {
    pushSetEngineMixes(
      ctx.lanes,
      ctx.transitions,
      useStudioDeckStore.getState().mixes,
      t,
      useBoothStore.getState().mode,
    );
  }

  return t;
}
