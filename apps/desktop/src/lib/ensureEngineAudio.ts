/**
 * Bind CoreAudio output on engine boot — fixes silent playback when the sidecar
 * starts before the OS default device is ready or a saved device name is stale.
 */
import {
  DEFAULT_PLAYBACK_SETTINGS,
  type PlaybackEngineSettings,
  type PlaybackEngineStatus,
} from "@odeon/shared";
import { engineClient } from "./engineClient";

const STORAGE_KEY = "odeon:playback-engine";

function loadLocalSettings(): PlaybackEngineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYBACK_SETTINGS };
    return { ...DEFAULT_PLAYBACK_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PLAYBACK_SETTINGS };
  }
}

export async function ensureEngineAudioOutput(): Promise<void> {
  try {
    let status = (await engineClient.getPlaybackEngineSettings()) as PlaybackEngineStatus;
    if (status.engineAvailable) return;

    const local = loadLocalSettings();
    status = (await engineClient.setPlaybackEngineSettings(
      local as unknown as Record<string, unknown>,
    )) as PlaybackEngineStatus;
    if (status.engineAvailable) return;

    if (local.outputDeviceName) {
      await engineClient.setPlaybackEngineSettings({
        ...local,
        outputDeviceName: "",
      } as unknown as Record<string, unknown>);
    }
  } catch (e) {
    console.warn("[ensureEngineAudio] output bind failed:", e);
  }
}
