import { invoke } from "@tauri-apps/api/core";

export async function openNativeTimelineSpike(): Promise<void> {
  await invoke("timeline_spike_open");
}

export async function closeNativeTimelineSpike(): Promise<void> {
  await invoke("timeline_spike_close");
}
