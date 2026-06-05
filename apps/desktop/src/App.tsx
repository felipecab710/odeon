import { useEffect, useState } from "react";
import { startFrameMonitor } from "./lib/perfDiagnostics";
import { useTimelineStore } from "./stores/timelineStore";
import { TopBar } from "./components/layout/TopBar";
import { TransportBar } from "./components/transport/TransportBar";
import { TrackList } from "./components/tracks/TrackList";
import { Mixer } from "./components/mixer/Mixer";
import { InspectorPanel } from "./components/inspector/InspectorPanel";
import { SessionLauncher } from "./components/layout/SessionLauncher";
import { ImportProgress } from "./components/import/ImportProgress";
import { useProjectStore } from "./stores/projectStore";
import { useTransportStore } from "./stores/transportStore";
import { useEngineStore } from "./stores/engineStore";
import { engineClient } from "./lib/engineClient";
import { apiClient } from "./lib/apiClient";
import { useEngineSync } from "./lib/useEngineSync";
import { useWebAudioSync } from "./lib/useWebAudioSync";
import { useTransportShortcuts } from "./hooks/useTransportShortcuts";
import { PlaybackEngineDialog } from "./components/settings/PlaybackEngineDialog";
import { webAudioEngine } from "./lib/webAudioEngine";
import { prefetchProjectWaveformCaches, seedProjectWaveformCaches } from "./lib/waveformEngine";
import type { OdeonProject } from "@odeon/shared";
import { DEFAULT_PLAYBACK_SETTINGS } from "@odeon/shared";

function windowTitleForProject(project: OdeonProject | null): string {
  return project?.name ? `${project.name} — Odeon` : "Odeon";
}

async function setWindowTitle(title: string) {
  document.title = title;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch { /* browser mode */ }
}

export default function App() {
  const { setProject, project } = useProjectStore();
  const { setIsPlaying, setPosition, setBpm, setEngineReady } = useTransportStore();
  const { updateMeters, initTrack } = useEngineStore();
  const [apiReady, setApiReady] = useState(false);
  const [showLauncher, setShowLauncher] = useState(true);

  useTransportShortcuts();

  // Dev perf monitor (enable via localStorage "odeon:perf" = "1")
  useEffect(() => startFrameMonitor(), []);

  // Native title bar (macOS window chrome) — project name centred in the top bar.
  useEffect(() => {
    if (showLauncher) {
      void setWindowTitle("Odeon");
      return;
    }
    void setWindowTitle(windowTitleForProject(project));
  }, [project?.id, project?.name, showLauncher]);

  // Apply saved playback-engine prefs to Web Audio on startup
  useEffect(() => {
    try {
      const raw = localStorage.getItem("odeon:playback-engine");
      const settings = raw
        ? { ...DEFAULT_PLAYBACK_SETTINGS, ...JSON.parse(raw) }
        : DEFAULT_PLAYBACK_SETTINGS;
      webAudioEngine.applyPlaybackSettings(settings);
    } catch { /* ignore */ }
  }, []);

  // Check API availability on startup; don't show launcher until API is up
  useEffect(() => {
    const check = async () => {
      try {
        await apiClient.health();
        setApiReady(true);
      } catch {
        // Retry every second until the API is up
        setTimeout(check, 1000);
      }
    };
    check();
  }, []);

  // Wire engine events once
  useEffect(() => {
    let unsubTransport: (() => void) | null = null;
    let unsubMeters: (() => void) | null = null;
    let unsubReady: (() => void) | null = null;
    let unsubUnavail: (() => void) | null = null;

    engineClient.onEngineReady(() => setEngineReady(true)).then((u) => { unsubReady = u; });
    engineClient.onEngineUnavailable(() => setEngineReady(false)).then((u) => { unsubUnavail = u; });
    engineClient.onTransportState((data) => {
      setEngineReady(true);
      setBpm(data.bpm);
      // Web Audio owns transport when tracks are loaded — native engine polls at 0 when idle.
      if (useTransportStore.getState().webAudioReady) return;
      if (!webAudioEngine.isPlaying()) {
        setIsPlaying(data.isPlaying);
        setPosition(data.positionSeconds);
      }
    }).then((u) => { unsubTransport = u; });
    engineClient.onTrackMeters((data) => {
      // Web Audio owns live metering in the desktop app — ignore native engine peaks.
      if (useTransportStore.getState().webAudioReady) return;
      updateMeters(data.meters);
    }).then((u) => { unsubMeters = u; });

    return () => {
      unsubTransport?.(); unsubMeters?.(); unsubReady?.(); unsubUnavail?.();
    };
  }, []);

  const handleOpenSession = (p: OdeonProject) => {
    seedProjectWaveformCaches(p);
    setProject(p);
    useTimelineStore.getState().resetView();
    setShowLauncher(false);
  };

  // Sync tracks to engines whenever project changes
  useEngineSync(project);
  useWebAudioSync(project);

  // Seed waveform caches whenever project tracks change (upload / analyze)
  useEffect(() => {
    if (!project) return;
    seedProjectWaveformCaches(project);
    prefetchProjectWaveformCaches(project);
  }, [project?.id, project?.tracks]);

  // Initialize mixer state for new tracks
  useEffect(() => {
    if (!project) return;
    for (const track of project.tracks) initTrack(track.id, track.volume_db, track.pan);
  }, [project?.id, project?.tracks?.length]);

  // Show launcher overlay when API is ready but no session open
  if (!apiReady || showLauncher) {
    return (
      <div className="app-shell flex flex-col h-full w-full overflow-hidden bg-studio-bg">
        {!apiReady ? (
          <div className="flex flex-col flex-1 items-center justify-center gap-3 text-studio-text-faint">
            <div className="w-8 h-8 rounded bg-studio-accent flex items-center justify-center">
              <span className="text-white font-bold text-sm">O</span>
            </div>
            <div className="text-sm animate-pulse">Connecting to Odeon API…</div>
          </div>
        ) : (
          <SessionLauncher onOpen={handleOpenSession} />
        )}
      </div>
    );
  }

  return (
    <div className="app-shell flex flex-col h-full w-full overflow-hidden bg-studio-bg">
      <TopBar onOpenSessionLauncher={() => setShowLauncher(true)} />
      <TransportBar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <TrackList />
        </div>
        <InspectorPanel />
      </div>
      <Mixer />
      <ImportProgress />
      <PlaybackEngineDialog />
    </div>
  );
}
