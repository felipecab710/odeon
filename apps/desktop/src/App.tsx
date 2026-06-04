import { useEffect } from "react";
import { TopBar } from "./components/layout/TopBar";
import { TransportBar } from "./components/transport/TransportBar";
import { TrackList } from "./components/tracks/TrackList";
import { Mixer } from "./components/mixer/Mixer";
import { InspectorPanel } from "./components/inspector/InspectorPanel";
import { useProjectStore } from "./stores/projectStore";
import { useTransportStore } from "./stores/transportStore";
import { useEngineStore } from "./stores/engineStore";
import { engineClient } from "./lib/engineClient";
import { apiClient } from "./lib/apiClient";
import { useEngineSync } from "./lib/useEngineSync";

export default function App() {
  const { createProject, project } = useProjectStore();
  const { setIsPlaying, setPosition, setBpm, setEngineReady } = useTransportStore();
  const { updateMeters, initTrack } = useEngineStore();

  // Bootstrap: create initial project + wire engine events
  useEffect(() => {
    // Create a default project on first load
    const init = async () => {
      try {
        await apiClient.health();
        await createProject("Untitled Project");
      } catch {
        // API not yet available; user will need to start it manually
        console.warn("[App] API not available. Start apps/api first.");
      }
    };
    init();

    // Engine event subscriptions
    let unsubTransport: (() => void) | null = null;
    let unsubMeters: (() => void) | null = null;
    let unsubReady: (() => void) | null = null;
    let unsubUnavail: (() => void) | null = null;

    engineClient.onEngineReady(() => {
      setEngineReady(true);
    }).then((unsub) => { unsubReady = unsub; });

    engineClient.onEngineUnavailable(() => {
      setEngineReady(false);
    }).then((unsub) => { unsubUnavail = unsub; });

    engineClient.onTransportState((data) => {
      setIsPlaying(data.isPlaying);
      setPosition(data.positionSeconds);
      setBpm(data.bpm);
    }).then((unsub) => { unsubTransport = unsub; });

    engineClient.onTrackMeters((data) => {
      updateMeters(data.meters);
    }).then((unsub) => { unsubMeters = unsub; });

    return () => {
      unsubTransport?.();
      unsubMeters?.();
      unsubReady?.();
      unsubUnavail?.();
    };
  }, []);

  // Sync tracks to native engine whenever project changes
  useEngineSync(project);

  // Initialize mixer state for new tracks
  useEffect(() => {
    if (!project) return;
    for (const track of project.tracks) {
      initTrack(track.id, track.volume_db, track.pan);
    }
  }, [project?.id, project?.tracks?.length]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-studio-bg">
      {/* Top bar */}
      <TopBar />

      {/* Transport */}
      <TransportBar />

      {/* Main workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: track list + timeline */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <TrackList />
        </div>

        {/* Right panel: inspector / mix moves */}
        <InspectorPanel />
      </div>

      {/* Bottom: mixer */}
      <Mixer />
    </div>
  );
}
