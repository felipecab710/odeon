/**
 * Set Builder timeline engine — framework-agnostic coordinator for seek, time
 * conversion, and viewport math (waveform-playlist PlaylistEngine pattern).
 */
import { useTransportStore } from "../stores/transportStore";
import { useBoothStore } from "../stores/boothStore";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { pushSetEngineMixes } from "./boothSimulation";
import { viewTimeRange } from "./setBeatGrid";
import type { LaneLayout, TransitionRegion } from "../components/setbuilder/setTimelineLayout";

/** Default project sample rate for sample-accurate snap at clip boundaries. */
export const SET_TIMELINE_SAMPLE_RATE = 44100;

export interface SetTimelineContext {
  lanes: LaneLayout[];
  transitions: TransitionRegion[];
  totalSec: number;
}

export function timeSecFromContentX(
  contentX: number,
  pixelsPerSecond: number,
  totalSec: number,
): number {
  return Math.max(0, Math.min(totalSec, contentX / Math.max(pixelsPerSecond, 1e-9)));
}

export function contentXFromClientX(clientX: number, scrollEl: HTMLElement): number {
  const rect = scrollEl.getBoundingClientRect();
  return clientX - rect.left + scrollEl.scrollLeft;
}

export function timeSecFromClientX(
  clientX: number,
  scrollEl: HTMLElement,
  pixelsPerSecond: number,
  totalSec: number,
): number {
  return timeSecFromContentX(
    contentXFromClientX(clientX, scrollEl),
    pixelsPerSecond,
    totalSec,
  );
}

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
  return viewTimeRange(scrollLeft, viewportWidth, pixelsPerSecond);
}

/** Playhead X in timeline content coordinates — use as CSS transform-origin during zoom. */
export function playheadAnchorContentX(playheadSec: number, pixelsPerSecond: number): number {
  return Math.max(0, playheadSec * pixelsPerSecond);
}

/** Playhead X in scroll viewport coordinates — Ableton-style zoom anchor. */
export function playheadAnchorViewportX(
  playheadSec: number,
  pixelsPerSecond: number,
  scrollLeft: number,
): number {
  return playheadSec * pixelsPerSecond - scrollLeft;
}

/** Seek transport + booth + lane mixes so playback is ready at the new position. */
export async function seekSetTimeline(
  timeSec: number,
  ctx: SetTimelineContext,
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
