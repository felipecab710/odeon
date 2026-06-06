import { useCallback } from "react";
import { useNavigationStore, type NavView } from "../../stores/navigationStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTransportStore } from "../../stores/transportStore";

async function startWindowDrag(e: React.MouseEvent) {
  if (e.button !== 0) return;
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().startDragging();
  } catch { /* browser dev */ }
}

interface NavItem {
  id: NavView;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "studio",   label: "Studio" },
  { id: "select",   label: "Select" },
  { id: "research", label: "Research" },
  { id: "settings", label: "Settings" },
];

export function AppTitleBar() {
  const { view, navigate } = useNavigationStore();
  const project = useProjectStore((s) => s.project);
  const isLoading = useProjectStore((s) => s.isLoading);
  const engineReady = useTransportStore((s) => s.engineReady);
  const onDragRegionMouseDown = useCallback((e: React.MouseEvent) => {
    void startWindowDrag(e);
  }, []);

  return (
    <header className="app-titlebar" data-tauri-drag-region>
      <div className="app-titlebar-inner">
        <div
          className="flex items-center gap-2 min-w-0 app-titlebar-drag"
          data-tauri-drag-region
          onMouseDown={onDragRegionMouseDown}
        >
          <div className="w-5 h-5 rounded bg-studio-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-[10px]">O</span>
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-studio-text-faint">
            ODEON
          </span>

          {view === "studio" && project && (
            <>
              <span className="text-studio-border mx-0.5">·</span>
              <span className="text-[10px] text-studio-text-faint truncate max-w-[200px]">
                {project.name}
              </span>
              {isLoading && (
                <span className="text-[10px] text-studio-accent animate-pulse">processing…</span>
              )}
              <div className="flex items-center gap-1 ml-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    engineReady ? "bg-studio-meter" : "bg-studio-text-faint"
                  }`}
                />
                <span className="text-[10px] text-studio-text-faint">
                  {engineReady ? "Engine" : "No audio"}
                </span>
              </div>
            </>
          )}
        </div>

        <div
          className="app-titlebar-drag flex-1 self-stretch"
          data-tauri-drag-region
          onMouseDown={onDragRegionMouseDown}
        />

        <nav className="no-drag flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className="app-titlebar-nav-btn"
                data-active={active ? "true" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
