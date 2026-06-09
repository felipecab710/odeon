/**
 * Set Builder timeline context — Audacity 4 TimelineContext / au3 ZoomInfo.
 *
 * Single owner for zoom, scroll, pixel↔time, grid ticks, ruler marks, and snap.
 */
import { zoomAtAnchor } from "./timelineViewportZoom";
import {
  MIN_PX_PER_SEC,
  MAX_PX_PER_SEC,
} from "../components/setbuilder/setTimelineLayout";
import {
  buildBeatGridLevels,
  collectBeatRulerMarks,
  collectGridLines,
  collectTimeRulerMarks,
  finestVisibleGridInterval,
  paintBeatGridCanvas,
  paintBeatRulerCanvas,
  paintTimeRulerCanvas,
  type BeatGridLevel,
  type BeatGridLine,
  type BeatRulerMark,
  type TimeRulerMark,
} from "./setBeatGrid";

export interface SetTimelineContextParams {
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  totalSec: number;
  bpm?: number;
  beatsPerBar?: number;
}

/** @deprecated Use SetTimelineContextParams */
export type SetTimelineViewportMetrics = SetTimelineContextParams;

export interface TimelineHitTest {
  viewportX: number;
  contentX: number;
  timeSec: number;
}

export class SetTimelineContext {
  readonly pixelsPerSecond: number;
  readonly scrollLeft: number;
  readonly viewportWidth: number;
  readonly totalSec: number;
  readonly bpm: number;
  readonly beatsPerBar: number;

  private _gridLevels: BeatGridLevel[] | null = null;

  constructor(params: SetTimelineContextParams) {
    this.pixelsPerSecond = params.pixelsPerSecond;
    this.scrollLeft = params.scrollLeft;
    this.viewportWidth = params.viewportWidth;
    this.totalSec = params.totalSec;
    this.bpm = params.bpm ?? 128;
    this.beatsPerBar = params.beatsPerBar ?? 4;
  }

  /** Time at the left edge of the visible frame (Audacity hpos / frameStartTime). */
  get frameStartTimeSec(): number {
    return this.scrollLeft / this.safePps;
  }

  /** Time at the right edge of the visible frame. */
  get frameEndTimeSec(): number {
    return (this.scrollLeft + this.viewportWidth) / this.safePps;
  }

  toParams(): SetTimelineContextParams {
    return {
      pixelsPerSecond: this.pixelsPerSecond,
      scrollLeft: this.scrollLeft,
      viewportWidth: this.viewportWidth,
      totalSec: this.totalSec,
      bpm: this.bpm,
      beatsPerBar: this.beatsPerBar,
    };
  }

  /** @deprecated Alias for toParams */
  toMetrics(): SetTimelineContextParams {
    return this.toParams();
  }

  withView(scrollLeft: number, viewportWidth?: number): SetTimelineContext {
    return new SetTimelineContext({
      ...this.toParams(),
      scrollLeft,
      viewportWidth: viewportWidth ?? this.viewportWidth,
    });
  }

  withZoom(pixelsPerSecond: number, scrollLeft?: number): SetTimelineContext {
    return new SetTimelineContext({
      ...this.toParams(),
      pixelsPerSecond,
      scrollLeft: scrollLeft ?? this.scrollLeft,
    });
  }

  // ─── ZoomInfo / TimelineContext coordinate transforms ─────────────────────

  clampTimeSec(timeSec: number): number {
    return Math.max(0, Math.min(this.totalSec, timeSec));
  }

  /** Audacity ZoomInfo::TimeToPosition */
  timeToViewportX(timeSec: number): number {
    return timeSec * this.pixelsPerSecond - this.scrollLeft;
  }

  /** Audacity ZoomInfo::PositionToTime */
  viewportXToTimeSec(viewportX: number): number {
    return (this.scrollLeft + viewportX) / this.safePps;
  }

  timeSecToContentX(timeSec: number): number {
    return timeSec * this.pixelsPerSecond;
  }

  contentXToTimeSec(contentX: number): number {
    return this.clampTimeSec(contentX / this.safePps);
  }

  static viewportXFromClientX(clientX: number, scrollEl: HTMLElement): number {
    const rect = scrollEl.getBoundingClientRect();
    return Math.max(0, Math.min(scrollEl.clientWidth, clientX - rect.left));
  }

  hitTestClientX(clientX: number, scrollEl: HTMLElement): TimelineHitTest {
    const viewportX = SetTimelineContext.viewportXFromClientX(clientX, scrollEl);
    const contentX = scrollEl.scrollLeft + viewportX;
    const timeSec = this.clampTimeSec(contentX / this.safePps);
    return { viewportX, contentX, timeSec };
  }

  timeSecFromClientX(clientX: number, scrollEl: HTMLElement): number {
    return this.hitTestClientX(clientX, scrollEl).timeSec;
  }

  viewTimeRange(padSec = 2): { start: number; end: number } {
    return {
      start: Math.max(0, this.frameStartTimeSec - padSec),
      end: this.frameEndTimeSec + padSec,
    };
  }

  scrollLeftForAnchoredTime(timeSec: number, viewportX: number): number {
    return Math.max(0, timeSec * this.pixelsPerSecond - viewportX);
  }

  /**
   * Audacity TimelineContext::setZoom equivalent — anchor time stays at viewportX.
   */
  zoomAt(factor: number, anchorViewportX: number): {
    pixelsPerSecond: number;
    scrollLeft: number;
  } | null {
    const result = zoomAtAnchor({
      oldPps: this.pixelsPerSecond,
      factor,
      scrollLeft: this.scrollLeft,
      anchorViewportX,
      minPps: MIN_PX_PER_SEC,
      maxPps: MAX_PX_PER_SEC,
    });
    if (!result) return null;
    return { pixelsPerSecond: result.newPps, scrollLeft: result.newScrollLeft };
  }

  // ─── Grid + rulers (shared tick positions — Audacity TimelineRuler → GridLines) ─

  gridLevels(): BeatGridLevel[] {
    if (!this._gridLevels) {
      this._gridLevels = buildBeatGridLevels(this.bpm, this.pixelsPerSecond, this.beatsPerBar);
    }
    return this._gridLevels;
  }

  gridLines(): BeatGridLine[] {
    const { start, end } = this.viewTimeRange();
    return collectGridLines(this.totalSec, this.gridLevels(), start, end);
  }

  beatRulerMarks(): BeatRulerMark[] {
    const { start, end } = this.viewTimeRange();
    return collectBeatRulerMarks(
      this.totalSec,
      this.gridLevels(),
      start,
      end,
      this.bpm,
      this.pixelsPerSecond,
      this.beatsPerBar,
    );
  }

  timeRulerMarks(): TimeRulerMark[] {
    const { start, end } = this.viewTimeRange();
    return collectTimeRulerMarks(this.totalSec, start, end, this.pixelsPerSecond);
  }

  /** Snap to finest visible grid line at current zoom (Ableton edit snap). */
  snapTimeSec(timeSec: number): number {
    const interval = finestVisibleGridInterval(this.bpm, this.pixelsPerSecond, this.beatsPerBar);
    if (interval <= 0) return Math.max(0, timeSec);
    const snapped = Math.round(timeSec / interval) * interval;
    return Math.max(0, Math.round(snapped * 1e6) / 1e6);
  }

  paintBeatRuler(ctx: CanvasRenderingContext2D, marks: BeatRulerMark[], height: number): void {
    paintBeatRulerCanvas(
      ctx,
      marks,
      this.scrollLeft,
      this.pixelsPerSecond,
      this.viewportWidth,
      height,
    );
  }

  paintTimeRuler(ctx: CanvasRenderingContext2D, marks: TimeRulerMark[], height: number): void {
    paintTimeRulerCanvas(
      ctx,
      marks,
      this.scrollLeft,
      this.pixelsPerSecond,
      this.viewportWidth,
      height,
    );
  }

  paintGrid(ctx: CanvasRenderingContext2D, lines: BeatGridLine[], height: number): void {
    paintBeatGridCanvas(
      ctx,
      lines,
      this.scrollLeft,
      this.pixelsPerSecond,
      this.viewportWidth,
      height,
      this.gridLevels(),
    );
  }

  private get safePps(): number {
    return Math.max(this.pixelsPerSecond, 1e-9);
  }
}

/** Factory helper for hooks and stores. */
export function createSetTimelineContext(params: SetTimelineContextParams): SetTimelineContext {
  return new SetTimelineContext(params);
}
