import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface EmbedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface NativeTimelineLaneMetrics {
  y: number;
  height: number;
}

export interface NativeTimelineClip {
  start_sec: number;
  duration_sec: number;
  lane_index: number;
  lane_count: number;
  color: [number, number, number, number];
  wave_color?: [number, number, number, number];
  wavecache_path?: string | null;
  label?: string;
  badge?: string;
  label_color?: [number, number, number, number];
}

export interface NativeTimelineViewport {
  pixels_per_second: number;
  scroll_left: number;
}

export interface NativeTimelineScene {
  viewport: {
    pixels_per_second: number;
    scroll_left: number;
    viewport_width: number;
    viewport_height: number;
    total_sec: number;
    bpm: number;
    beats_per_bar: number;
  };
  clips: NativeTimelineClip[];
  playhead_sec: number;
  cursor_sec?: number | null;
  selected_lane_index?: number | null;
  lane_metrics?: NativeTimelineLaneMetrics[];
  locators?: { time_sec: number }[];
  dom_rulers?: boolean;
}

export async function measureNativeEmbedFrame(el: HTMLElement): Promise<EmbedFrame> {
  const scale = await getCurrentWindow().scaleFactor();
  const elRect = el.getBoundingClientRect();
  const rootRect = document.documentElement.getBoundingClientRect();
  const width = Math.max(1, el.offsetWidth || elRect.width);
  const height = Math.max(1, el.offsetHeight || elRect.height);
  return {
    x: elRect.left - rootRect.left,
    y: elRect.top - rootRect.top,
    width,
    height,
    scale,
  };
}

export async function startNativeTimelineEmbed(frame: EmbedFrame): Promise<void> {
  await invoke("timeline_embed_start", { frame });
}

export async function resizeNativeTimelineEmbed(frame: EmbedFrame): Promise<void> {
  await invoke("timeline_embed_set_frame", { frame });
}

export async function updateNativeTimelineScene(scene: NativeTimelineScene): Promise<void> {
  await invoke("timeline_embed_set_scene", { scene });
}

export async function updateNativeTimelinePlayhead(playheadSec: number): Promise<void> {
  await invoke("timeline_embed_set_playhead", { playheadSec });
}

export async function wheelNativeTimelineEmbed(
  deltaY: number,
  ctrl: boolean,
  cursorX: number,
): Promise<void> {
  await invoke("timeline_embed_wheel", { deltaY, ctrl, cursorX });
}

export async function stopNativeTimelineEmbed(): Promise<void> {
  await invoke("timeline_embed_stop");
}

export async function isNativeTimelineEmbedActive(): Promise<boolean> {
  return invoke<boolean>("timeline_embed_is_active");
}

export async function listenNativeTimelineViewport(
  handler: (viewport: NativeTimelineViewport) => void,
): Promise<() => void> {
  return listen<NativeTimelineViewport>("timeline-embed:viewport", event => {
    handler(event.payload);
  });
}

/** @deprecated Phase 0 standalone spike window */
export async function openNativeTimelineSpike(): Promise<void> {
  await invoke("timeline_spike_open");
}

export async function closeNativeTimelineSpike(): Promise<void> {
  await invoke("timeline_spike_close");
}
