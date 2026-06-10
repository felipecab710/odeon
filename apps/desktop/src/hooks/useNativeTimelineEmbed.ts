import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  measureNativeEmbedFrame,
  resizeNativeTimelineEmbed,
  startNativeTimelineEmbed,
  stopNativeTimelineEmbed,
  updateNativeTimelinePlayhead,
  updateNativeTimelineScene,
  type EmbedFrame,
  type NativeTimelineScene,
} from "../lib/nativeTimelineEmbed";
import { waveformColorsFromClip, contrastingTextOn } from "../lib/clipColorPresets";

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}

function waitForLayout(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

interface LaneInput {
  startSec: number;
  durationSec: number;
  index: number;
  colorHex: string;
  wavecachePath?: string;
  label?: string;
  badge?: string;
  labelColorHex?: string;
}

interface DragPreview {
  laneIndex: number;
  deltaPx: number;
}

interface DeckStripInput {
  laneIndex: number;
  colorHex: string;
  deckLabel: string;
  title: string;
  selected: boolean;
  muted: boolean;
  solo: boolean;
  cue: boolean;
  showAutomation: boolean;
  automationExpanded: boolean;
  faderPos?: number;
}

interface AutomationLaneInput {
  laneIndex: number;
  colorHex: string;
  visible: boolean;
  paramLabel?: string;
  keyframes?: { timeSec: number; valueNorm: number }[];
}

interface TransitionInput {
  startSec: number;
  endSec: number;
  fromLaneIndex: number;
  toLaneIndex: number;
  selected: boolean;
}

interface Options {
  active: boolean;
  targetRef: React.RefObject<HTMLElement | null>;
  totalSec: number;
  bpm: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  playheadSec: number;
  cursorSec?: number | null;
  selectedLaneIndex?: number | null;
  laneYs: number[];
  laneHeights: number[];
  waveBandHeights?: number[];
  laneStackHeight: number;
  laneStripWidth: number;
  deckStrips: DeckStripInput[];
  automationLanes: AutomationLaneInput[];
  transitions?: TransitionInput[];
  lanes: LaneInput[];
  dragPreview?: DragPreview | null;
  locators?: { timeSec: number }[];
  onSeekAtClientX?: (clientX: number) => void;
  onCursorAtClientX?: (clientX: number) => void;
  onPointerDown?: (clientX: number, clientY: number) => void;
  onPointerMove?: (clientX: number, clientY: number) => void;
  onContextMenu?: (clientX: number, clientY: number) => void;
  onDoubleClick?: () => void;
  generation?: number;
}

export function useNativeTimelineEmbed({
  active,
  targetRef,
  totalSec,
  bpm,
  pixelsPerSecond,
  scrollLeft,
  playheadSec,
  cursorSec,
  selectedLaneIndex,
  laneYs,
  laneHeights,
  waveBandHeights,
  laneStackHeight,
  laneStripWidth,
  deckStrips,
  automationLanes,
  transitions = [],
  lanes,
  dragPreview,
  locators = [],
  onSeekAtClientX,
  onCursorAtClientX,
  onPointerDown,
  onPointerMove,
  onContextMenu,
  onDoubleClick,
  generation = 0,
}: Options) {
  const [embedReady, setEmbedReady] = useState(false);
  const frameRef = useRef<EmbedFrame | null>(null);

  const buildScene = useCallback((): NativeTimelineScene => {
    const frame = frameRef.current;
    const el = targetRef.current;
    const totalW = frame?.width ?? el?.clientWidth ?? 800;
    const timelineW = Math.max(1, totalW - laneStripWidth);
    const h = laneStackHeight;
    const laneCount = lanes.length;
    const metrics = laneYs.map((y, i) => ({
      y,
      height: laneHeights[i] ?? 0,
      wave_height: waveBandHeights?.[i] ?? (laneHeights[i] ?? 0),
    }));
    return {
      viewport: {
        pixels_per_second: pixelsPerSecond,
        scroll_left: scrollLeft,
        viewport_width: timelineW,
        viewport_height: h,
        total_sec: totalSec,
        bpm,
        beats_per_bar: 4,
      },
      clips: lanes.map(lane => {
        const dragSec =
          dragPreview?.laneIndex === lane.index
            ? dragPreview.deltaPx / Math.max(pixelsPerSecond, 1e-9)
            : 0;
        return {
          start_sec: lane.startSec + dragSec,
          duration_sec: lane.durationSec,
          lane_index: lane.index,
          lane_count: Math.max(1, laneCount),
          color: hexToRgba(lane.colorHex),
          wave_color: hexToRgba(waveformColorsFromClip(lane.colorHex).fill),
          wavecache_path: lane.wavecachePath ?? null,
          label: lane.label ?? "",
          badge: lane.badge ?? "",
          label_color: hexToRgba(lane.labelColorHex ?? contrastingTextOn(lane.colorHex)),
        };
      }),
      playhead_sec: 0,
      cursor_sec: cursorSec ?? null,
      selected_lane_index: selectedLaneIndex ?? null,
      lane_metrics: metrics,
      locators: locators.map(l => ({ time_sec: l.timeSec })),
      dom_rulers: true,
      lane_strip_width: laneStripWidth,
      deck_strips: deckStrips.map(strip => ({
        lane_index: strip.laneIndex,
        color: hexToRgba(strip.colorHex),
        deck_label: strip.deckLabel,
        title: strip.title,
        selected: strip.selected,
        muted: strip.muted,
        solo: strip.solo,
        cue: strip.cue,
        show_automation: strip.showAutomation,
        automation_expanded: strip.automationExpanded,
        fader_pos: strip.faderPos ?? 0.34,
      })),
      automation_lanes: automationLanes.map(lane => ({
        lane_index: lane.laneIndex,
        color: hexToRgba(lane.colorHex),
        visible: lane.visible,
        param_label: lane.paramLabel ?? "",
        keyframes: (lane.keyframes ?? []).map(kf => ({
          time_sec: kf.timeSec,
          value_norm: kf.valueNorm,
        })),
      })),
      transitions: transitions.map(tr => ({
        start_sec: tr.startSec,
        end_sec: tr.endSec,
        from_lane_index: tr.fromLaneIndex,
        to_lane_index: tr.toLaneIndex,
        selected: tr.selected,
      })),
    };
  }, [
    targetRef,
    totalSec,
    bpm,
    pixelsPerSecond,
    scrollLeft,
    cursorSec,
    selectedLaneIndex,
    laneYs,
    laneHeights,
    waveBandHeights,
    laneStackHeight,
    laneStripWidth,
    deckStrips,
    automationLanes,
    transitions,
    lanes,
    dragPreview,
    locators,
  ]);

  const buildSceneRef = useRef(buildScene);
  buildSceneRef.current = buildScene;

  const playheadRef = useRef(playheadSec);
  playheadRef.current = playheadSec;

  const syncFrame = useCallback(async () => {
    const el = targetRef.current;
    if (!el || !active || !embedReady) return;
    const frame = await measureNativeEmbedFrame(el, laneStackHeight);
    frameRef.current = frame;
    await resizeNativeTimelineEmbed(frame);
    await updateNativeTimelineScene(buildSceneRef.current());
  }, [active, embedReady, targetRef, laneStackHeight]);

  const syncFrameRef = useRef(syncFrame);
  syncFrameRef.current = syncFrame;

  const laneLayoutKey = `${laneYs.length}:${laneHeights.join(",")}:${(waveBandHeights ?? []).join(",")}:${laneStackHeight}:${laneStripWidth}`;

  useEffect(() => {
    if (!active) {
      setEmbedReady(false);
      frameRef.current = null;
      void stopNativeTimelineEmbed();
      return;
    }

    const el = targetRef.current;
    if (!el) return;

    let cancelled = false;
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;

    void (async () => {
      await waitForLayout();
      if (cancelled) return;

      let frame = await measureNativeEmbedFrame(el, laneStackHeight);
      if (frame.height < 40) {
        await waitForLayout();
        frame = await measureNativeEmbedFrame(el, laneStackHeight);
      }
      if (cancelled) return;

      frameRef.current = frame;
      await startNativeTimelineEmbed(frame);
      if (cancelled) {
        void stopNativeTimelineEmbed();
        return;
      }

      await updateNativeTimelineScene(buildSceneRef.current());
      await updateNativeTimelinePlayhead(playheadRef.current);
      if (cancelled) {
        void stopNativeTimelineEmbed();
        return;
      }

      setEmbedReady(true);

      const win = getCurrentWindow();
      unlistenMove = await win.onMoved(() => {
        void syncFrameRef.current();
      });
      unlistenResize = await win.onResized(() => {
        void syncFrameRef.current();
      });
    })();

    return () => {
      cancelled = true;
      setEmbedReady(false);
      unlistenMove?.();
      unlistenResize?.();
      void stopNativeTimelineEmbed();
    };
  }, [active, targetRef, laneLayoutKey, generation, laneStackHeight]);

  useEffect(() => {
    if (!active || !embedReady) return;
    void updateNativeTimelinePlayhead(playheadSec);
  }, [active, embedReady, playheadSec]);

  useEffect(() => {
    if (!active || !embedReady) return;
    void updateNativeTimelineScene(buildScene());
  }, [active, embedReady, buildScene]);

  useEffect(() => {
    if (!active) return;
    const el = targetRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      void syncFrame();
    });
    ro.observe(el);
    window.addEventListener("resize", syncFrame);

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onPointerDown?.(e.clientX, e.clientY);
      onSeekAtClientX?.(e.clientX);
    };

    const onMouseMove = (e: MouseEvent) => {
      onCursorAtClientX?.(e.clientX);
      onPointerMove?.(e.clientX, e.clientY);
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      onDoubleClick?.();
    };

    const onContextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      onContextMenu?.(e.clientX, e.clientY);
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("contextmenu", onContextMenuHandler);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncFrame);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("contextmenu", onContextMenuHandler);
    };
  }, [active, targetRef, syncFrame, onSeekAtClientX, onCursorAtClientX, onPointerDown, onPointerMove, onContextMenu, onDoubleClick]);
}
