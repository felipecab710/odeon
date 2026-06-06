import { TransportBar } from "../components/transport/TransportBar";
import { TrackList } from "../components/tracks/TrackList";
import { Mixer } from "../components/mixer/Mixer";
import { InspectorPanel } from "../components/inspector/InspectorPanel";
import { ImportProgress } from "../components/import/ImportProgress";
import { PlaybackEngineDialog } from "../components/settings/PlaybackEngineDialog";
import { SessionLauncher } from "../components/layout/SessionLauncher";
import { useProjectStore } from "../stores/projectStore";
import { useTimelineStore } from "../stores/timelineStore";
import { seedProjectWaveformCaches } from "../lib/waveformEngine";
import type { OdeonProject } from "@odeon/shared";

export function StudioView() {
  const { project, setProject } = useProjectStore();

  const handleOpenSession = (p: OdeonProject) => {
    seedProjectWaveformCaches(p);
    setProject(p);
    useTimelineStore.getState().resetView();
  };

  if (!project) {
    return <SessionLauncher onOpen={handleOpenSession} />;
  }

  return (
    <>
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
    </>
  );
}
