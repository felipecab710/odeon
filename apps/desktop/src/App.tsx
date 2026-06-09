import { useEffect, useState } from "react";
import { startFrameMonitor } from "./lib/perfDiagnostics";
import { TopBar } from "./components/layout/TopBar";
import { AppTitleBar } from "./components/layout/AppTitleBar";
import { useProjectStore } from "./stores/projectStore";
import { useTransportStore } from "./stores/transportStore";
import { useEngineStore } from "./stores/engineStore";
import { useNavigationStore } from "./stores/navigationStore";
import { engineClient } from "./lib/engineClient";
import { apiClient } from "./lib/apiClient";
import { useEngineSync } from "./lib/useEngineSync";
import { ensureEngineAudioOutput } from "./lib/ensureEngineAudio";
import { resetSetEngineSession } from "./lib/useSetEngineSync";
import { useTransportShortcuts } from "./hooks/useTransportShortcuts";
import { useUndoShortcuts } from "./hooks/useUndoShortcuts";
import { prefetchProjectWaveformCaches } from "./lib/waveformEngine";
import type { OdeonProject } from "@odeon/shared";
import { StudioView } from "./views/StudioView";
import { SelectView } from "./views/SelectView";
import { ResearchView } from "./views/ResearchView";
import { SettingsView } from "./views/SettingsView";

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
  const { project } = useProjectStore();
  const { setBpm, setEngineReady, setEngineTracksReady } = useTransportStore();
  const { initTrack } = useEngineStore();
  const view = useNavigationStore((s) => s.view);
  const engineProject = view === "studio" ? project : null;
  const [apiReady, setApiReady] = useState(false);

  useTransportShortcuts();
  useUndoShortcuts();

  useEffect(() => startFrameMonitor(), []);

  useEffect(() => {
    void setWindowTitle(view === "studio" ? windowTitleForProject(project) : "Odeon");
  }, [project?.id, project?.name, view]);

  // API health check — poll until up
  useEffect(() => {
    const check = async () => {
      try {
        await apiClient.health();
        setApiReady(true);
      } catch {
        setTimeout(check, 1000);
      }
    };
    check();
  }, []);

  // Wire engine lifecycle events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    engineClient.onEngineReady(() => {
      resetSetEngineSession();
      void ensureEngineAudioOutput().finally(() => setEngineReady(true));
    }).then((u) => unsubs.push(u));

    engineClient.onEngineUnavailable(() => {
      setEngineReady(false);
      setEngineTracksReady(false);
    }).then((u) => unsubs.push(u));

    engineClient.onEngineTerminated(() => {
      setEngineReady(false);
      setEngineTracksReady(false);
      resetSetEngineSession();
      void engineClient.restartEngine()
        .then(() => ensureEngineAudioOutput())
        .then(() => engineClient.getTransportState())
        .then(() => setEngineReady(true))
        .catch((err) => console.warn("[App] engine restart failed:", err));
    }).then((u) => unsubs.push(u));

    engineClient.onTransportState((data) => {
      setEngineReady(true);
      setBpm(data.bpm);
    }).then((u) => unsubs.push(u));

    // engineReady fires before React registers listeners — poll once to catch it
    engineClient.getTransportState()
      .then(() => ensureEngineAudioOutput())
      .then(() => setEngineReady(true))
      .catch(() => {});

    return () => unsubs.forEach((u) => u());
  }, []);

  // Only the Studio view owns the engine via the DAW project.
  // Research/Booth use useSetEngineSync — avoid wiping set-preview on every render.
  useEngineSync(engineProject);

  useEffect(() => {
    if (!project) return;
    prefetchProjectWaveformCaches(project);
  }, [project?.id, project?.tracks]);

  useEffect(() => {
    if (!project) return;
    for (const track of project.tracks) initTrack(track.id, track.volume_db, track.pan);
  }, [project?.id, project?.tracks?.length]);

  if (!apiReady) {
    return (
      <div className="app-shell flex flex-col h-full w-full overflow-hidden bg-studio-bg">
        <div className="flex flex-col flex-1 items-center justify-center gap-3 text-studio-text-faint">
          <div className="w-8 h-8 rounded bg-studio-accent flex items-center justify-center">
            <span className="text-white font-bold text-sm">O</span>
          </div>
          <div className="text-sm animate-pulse">Connecting to Odeon API…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex flex-col h-full w-full overflow-hidden bg-studio-bg">
      <AppTitleBar />
      {view === "studio" && <TopBar />}
      <div className={view === "studio" ? "flex flex-1 flex-col min-h-0 overflow-hidden" : "hidden"}>
        <StudioView />
      </div>
      <div className={view === "select" ? "flex flex-1 flex-col min-h-0 overflow-hidden" : "hidden"}>
        <SelectView />
      </div>
      <div className={view === "research" ? "flex flex-1 flex-col min-h-0 overflow-hidden" : "hidden"}>
        <ResearchView />
      </div>
      {view === "settings" && <SettingsView />}
    </div>
  );
}
