// ─────────────────────────────────────────────
//  Playback Engine settings (Pro Tools-style)
// ─────────────────────────────────────────────

export type ErrorRecoveryPolicy = "stop" | "continue" | "silence" | "repeat_last";

export type DiskCacheSize = "small" | "normal" | "large";

export type BufferSizeSamples = 64 | 128 | 256 | 512 | 1024;

export interface PlaybackErrorRecovery {
  cpuOverload: ErrorRecoveryPolicy;
  diskUnderrun: ErrorRecoveryPolicy;
  deviceDisconnect: ErrorRecoveryPolicy;
}

export interface PlaybackEngineSettings {
  /** JUCE output device name (e.g. "External Headphones") */
  outputDeviceName: string;
  bufferSizeSamples: BufferSizeSamples;
  sampleRate: 44100 | 48000 | 96000;

  errorRecovery: PlaybackErrorRecovery;

  /** Skip processing on muted tracks / idle plugin chains */
  dynamicPluginProcessing: boolean;
  /** Hybrid live vs anticipative playback path */
  optimizeLowBuffer: boolean;
  /** 0 = auto (use all cores) */
  maxRealtimeThreads: number;

  /** Ignore minor RT glitches on main playback engine */
  ignoreErrorsMainPlayback: boolean;
  /** Ignore minor RT glitches on aux I/O */
  ignoreErrorsAuxIo: boolean;

  diskCacheSize: DiskCacheSize;
}

export interface AudioOutputDeviceInfo {
  name: string;
  isCurrent: boolean;
}

export interface PlaybackEngineStatus {
  deviceType: string;
  currentOutputDevice: string;
  outputDevices: AudioOutputDeviceInfo[];
  availableBufferSizes: number[];
  availableSampleRates: number[];
  settings: PlaybackEngineSettings;
  bufferSizeMs: number;
  sampleRate: number;
  cpuUsage: number;
  diskCacheBytes: number;
  engineAvailable: boolean;
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackEngineSettings = {
  outputDeviceName: "",
  bufferSizeSamples: 256,
  sampleRate: 48000,
  errorRecovery: {
    cpuOverload: "continue",
    diskUnderrun: "silence",
    deviceDisconnect: "stop",
  },
  dynamicPluginProcessing: true,
  optimizeLowBuffer: false,
  maxRealtimeThreads: 0,
  ignoreErrorsMainPlayback: false,
  ignoreErrorsAuxIo: true,
  diskCacheSize: "normal",
};

export const DISK_CACHE_SAMPLES: Record<DiskCacheSize, number> = {
  small: 220_500,
  normal: 441_000,
  large: 882_000,
};

/** Compute buffer deadline in ms at a given sample rate */
export function bufferSizeMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}
