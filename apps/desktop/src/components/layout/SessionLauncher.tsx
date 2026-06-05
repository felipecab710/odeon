/**
 * SessionLauncher — shown on startup instead of auto-creating a blank project.
 * Mirrors Ardour's "Recent Sessions" / "New Session" flow.
 */
import { useEffect, useState } from "react";
import type { OdeonProject } from "@odeon/shared";
import { apiClient } from "../../lib/apiClient";

interface Props {
  onOpen: (project: OdeonProject) => void;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function statusColor(status: string) {
  if (status === "analyzed" || status === "compared" || status === "ready") return "text-studio-meter";
  if (status === "stems_separated") return "text-studio-accent";
  return "text-studio-text-faint";
}

export function SessionLauncher({ onOpen }: Props) {
  const [tab, setTab] = useState<"recent" | "new">("recent");
  const [recent, setRecent] = useState<OdeonProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("Untitled Project");
  const [newFolder, setNewFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listProjects()
      .then((projects) => setRecent(projects))
      .catch(() => setRecent([]))
      .finally(() => setLoading(false));
  }, []);

  const pickFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({ directory: true, title: "Choose project location" });
      if (typeof chosen === "string") setNewFolder(chosen);
    } catch {
      // browser mode — ignore
    }
  };

  const revealInFinder = async (path: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reveal_in_finder", { path });
    } catch {
      // browser mode or command unavailable — ignore
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await apiClient.createProject(newName.trim(), newFolder || undefined);
      onOpen(project);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiClient.deleteProject(id).catch(() => {});
    setRecent((r) => r.filter((p) => p.id !== id));
    setDeleteId(null);
  };

  return (
    <div className="flex flex-col h-full w-full bg-studio-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 pt-10 pb-6">
        <div className="w-9 h-9 rounded-lg bg-studio-accent flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-lg">O</span>
        </div>
        <div>
          <div className="text-studio-text font-semibold text-xl tracking-wide">ODEON</div>
          <div className="text-studio-text-faint text-xs">AI Reference Mixing Workbench</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-8 border-b border-studio-border">
        {(["recent", "new"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
              ${tab === t
                ? "border-studio-accent text-studio-accent"
                : "border-transparent text-studio-text-dim hover:text-studio-text"}`}
          >
            {t === "recent" ? "Recent Sessions" : "New Session"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6">

        {/* ── Recent sessions ─────────────────────────────────────────── */}
        {tab === "recent" && (
          <div className="max-w-2xl">
            {loading && (
              <div className="text-studio-text-faint text-sm py-8 text-center">Loading sessions…</div>
            )}
            {!loading && recent.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-studio-text-faint">
                <div className="text-4xl opacity-20">♪</div>
                <div className="text-sm">No saved sessions yet.</div>
                <button
                  onClick={() => setTab("new")}
                  className="mt-2 px-4 py-2 rounded bg-studio-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Create your first session
                </button>
              </div>
            )}
            {!loading && recent.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-4 px-4 py-3 mb-1 rounded-lg cursor-pointer
                           bg-studio-surface hover:bg-studio-active transition-colors border border-transparent
                           hover:border-studio-border"
                onClick={() => onOpen(p)}
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center text-white text-lg"
                  style={{ background: "linear-gradient(135deg, #4A90D9, #2563eb)" }}
                >
                  ♪
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-studio-text font-medium text-sm truncate">{p.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xxs uppercase tracking-wider ${statusColor(p.status)}`}>
                      {p.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-studio-text-faint text-xxs">·</span>
                    <span className="text-studio-text-faint text-xxs">
                      {p.tracks.length} track{p.tracks.length !== 1 ? "s" : ""}
                    </span>
                    {p.bpm && (
                      <>
                        <span className="text-studio-text-faint text-xxs">·</span>
                        <span className="text-studio-text-faint text-xxs">{p.bpm.toFixed(0)} BPM</span>
                      </>
                    )}
                  </div>
                  {p.folder_path && (
                    <div className="text-xxs text-studio-text-faint mt-0.5 truncate opacity-60">{p.folder_path}</div>
                  )}
                </div>

                {/* Date */}
                <div className="text-xxs text-studio-text-faint flex-shrink-0">{formatDate(p.updated_at)}</div>

                {/* Delete — only visible on hover */}
                {deleteId === p.id ? (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                      className="px-2 py-0.5 text-xxs rounded bg-studio-mute text-white hover:opacity-80"
                    >Delete</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteId(null); }}
                      className="px-2 py-0.5 text-xxs rounded bg-studio-active text-studio-text"
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteId(p.id); }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-studio-text-faint
                               text-xs transition-opacity px-1 flex-shrink-0"
                    title="Delete session"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── New session ──────────────────────────────────────────────── */}
        {tab === "new" && (
          <div className="max-w-md">
            <div className="flex flex-col gap-5">
              {/* Session name */}
              <div>
                <label className="block text-studio-text-dim text-xs mb-1.5 uppercase tracking-wider">
                  Session Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  className="w-full bg-studio-panel border border-studio-border rounded px-3 py-2
                             text-studio-text text-sm focus:outline-none focus:border-studio-accent"
                  placeholder="My Mix Session"
                  autoFocus
                />
              </div>

              {/* Save location */}
              <div>
                <label className="block text-studio-text-dim text-xs mb-1.5 uppercase tracking-wider">
                  Save Location
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    className="flex-1 bg-studio-panel border border-studio-border rounded px-3 py-2
                               text-studio-text text-sm focus:outline-none focus:border-studio-accent font-mono"
                    placeholder="~/Music/Odeon Projects (default)"
                    spellCheck={false}
                  />
                  <button
                    onClick={pickFolder}
                    className="px-3 py-2 rounded bg-studio-active border border-studio-border
                               text-studio-text-dim hover:text-studio-text hover:border-studio-accent
                               transition-colors flex items-center gap-1.5 text-sm"
                    title="Browse for folder"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.914a.5.5 0 0 1-.354-.146l-.5-.5A1.5 1.5 0 0 0 6 3H1.5z"/>
                    </svg>
                    Browse
                  </button>
                </div>

                {/* Preview path + Reveal in Finder */}
                <div className="flex items-center justify-between mt-1.5">
                  <div className="text-xxs text-studio-text-faint">
                    Will be created at:{" "}
                    <span className="text-studio-text-dim font-mono">
                      {newFolder || "~/Music/Odeon Projects"}/{newName || "…"}
                    </span>
                  </div>
                  {newFolder && (
                    <button
                      onClick={() => revealInFinder(newFolder)}
                      className="text-xxs text-studio-accent hover:underline ml-2 flex-shrink-0"
                    >
                      Reveal in Finder ↗
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="mt-2 px-6 py-2.5 rounded bg-studio-accent text-white font-semibold text-sm
                           hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {creating ? "Creating…" : "Create Session"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-8 pb-6 text-xxs text-studio-text-faint">
        Sessions are saved to disk as <code className="text-studio-text-dim">.odeon</code> files · Audio files stay in the project folder
      </div>
    </div>
  );
}
