import { useEffect, useState } from "react";
import { startFrameMonitor } from "./lib/perfDiagnostics";
import { TopBar } from "./components/layout/TopBar";
import { NavBar } from "./components/layout/NavBar";
import { useProjectStore } from "./stores/projectStore";
import { useTransportStore } from "./stores/transportStore";
import { useEngineStore } from "./stores/engineStore";
import { useNavigationStore } from "./stores/navigationStore";
import { engineClient } from "./lib/engineClient";
import { apiClient } from "./lib/apiClient";
import { useEngineSync } from "./lib/useEngineSync";
import { useTransportShortcuts } from "./hooks/useTransportShortcuts";
import { prefetchProjectWaveformCaches } from "./lib/waveformEngine";
import type { OdeonProject } from "@odeon/shared";
import { StudioView } from "./views/StudioView";
import { SelectView } from "./views/SelectView";
import { ResearchView } from "./views/ResearchView";
import { SettingsView } from "./views/SettingsView";

function windowTitleForProject(project: OdeonProject | null): string {
  return project?.name ? `${project.name} — Odeon` : "Odeon";
}

function AppBar() {
  return (
    <div style={{
      height: 44, background: "#141414", borderBottom: "1px solid #222",
      display: "flex", alignItems: "center", padding: "0 16px", flexShrink: 0,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: 4, background: "#2a6496",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginRight: 10, flexShrink: 0,
      }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>O</span>
      </div>
      <span style={{ color: "#fff", fontWeight: 700, fontSize: 13, letterSpacing: "0.06em" }}>ODEON</span>
    </div>
  );
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
  const { setBpm, setEngineReady } = useTransportStore();
  const { initTrack } = useEngineStore();
  const view = useNavigationStore((s) => s.view);
  const [apiReady, setApiReady] = useState(false);

  useTransportShortcuts();

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

    engineClient.onEngineReady(() => setEngineReady(true))
      .then((u) => unsubs.push(u));

    engineClient.onEngineUnavailable(() => setEngineReady(false))
      .then((u) => unsubs.push(u));

    engineClient.onTransportState((data) => {
      setEngineReady(true);
      setBpm(data.bpm);
    }).then((u) => unsubs.push(u));

    // engineReady fires before React registers listeners — poll once to catch it
    engineClient.getTransportState()
      .then(() => setEngineReady(true))
      .catch(() => {});

    return () => unsubs.forEach((u) => u());
  }, []);

  useEngineSync(project);

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
      {view === "studio" ? (
        <TopBar />
      ) : (
        <AppBar />
      )}
      <NavBar />
      {view === "studio"   && <StudioView />}
      {view === "select"   && <SelectView />}
      {view === "research" && <ResearchView />}
      {view === "settings" && <SettingsView />}
    </div>
  );
}
