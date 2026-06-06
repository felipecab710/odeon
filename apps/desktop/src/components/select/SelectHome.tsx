import { useEffect, useCallback, useState } from "react";
import { useSelectStore } from "../../stores/selectStore";
import { CatalogTable } from "./CatalogTable";
import { TrackProfilePanel } from "./TrackProfilePanel";
import { PlayerStrip } from "./PlayerStrip";
import { apiClient } from "../../lib/apiClient";
import { clearAllWaveformCache } from "../../lib/waveformEngine/cacheLoader";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let _toastId = 0;

export function SelectHome() {
  const {
    loading, scanning, stats, filter, isPolling, catalogFolderPath,
    setFilter, loadEntries, loadStats, loadCollections, importFolder, scanFolder, ensurePolling,
  } = useSelectStore();
  const [refreshing, setRefreshing] = useState(false);
  const [rebuildingWaves, setRebuildingWaves] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(message: string, type: Toast["type"] = "success") {
    const id = ++_toastId;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }

  useEffect(() => {
    // Clear any nulls cached under the old (broken) magic-byte check
    clearAllWaveformCache();
    loadEntries().then(() => {
      loadStats();
      loadCollections();
      ensurePolling();
    });
  }, []);

  const handleRefreshMetadata = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await apiClient.select.refreshMetadata();
      await loadEntries();
      showToast(`Tags refreshed — ${result.updated} tracks updated`);
    } catch {
      showToast("Tag refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  }, [loadEntries]);

  const handleRebuildWaveforms = useCallback(async () => {
    setRebuildingWaves(true);
    try {
      clearAllWaveformCache();
      const result = await apiClient.select.rebuildWaveforms();
      clearAllWaveformCache();
      showToast(`Waveforms rebuilt — ${result.rebuilt} / ${result.total} tracks`);
    } catch {
      showToast("Waveform rebuild failed", "error");
    } finally {
      setRebuildingWaves(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        const added = await importFolder(selected);
        showToast(added > 0 ? `${added} new track${added === 1 ? "" : "s"} added` : "Folder imported");
      }
    } catch {
      const path = prompt("Enter folder path to import:");
      if (path) {
        const added = await importFolder(path);
        showToast(added > 0 ? `${added} new track${added === 1 ? "" : "s"} added` : "Folder imported");
      }
    }
  }, [importFolder]);

  const handleScan = useCallback(async () => {
    if (!catalogFolderPath) {
      showToast("Import a folder first to set your music catalog", "error");
      return;
    }
    const added = await scanFolder();
    if (added > 0) {
      showToast(`${added} new track${added === 1 ? "" : "s"} found — analyzing…`);
    } else {
      showToast("No new files found");
    }
  }, [catalogFolderPath, scanFolder]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#161616", position: "relative" }}>
      {/* Toast notifications */}
      <div style={{
        position: "absolute", bottom: 80, right: 16, zIndex: 100,
        display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none",
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === "success" ? "#1a2e1a" : "#2e1a1a",
            border: `1px solid ${t.type === "success" ? "#2d5a2d" : "#5a2d2d"}`,
            borderRadius: 6, padding: "10px 14px",
            color: t.type === "success" ? "#4ade80" : "#f87171",
            fontSize: 12, fontWeight: 500,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            animation: "fadeInUp 0.2s ease",
          }}>
            {t.type === "success" ? "✓ " : "✕ "}{t.message}
          </div>
        ))}
      </div>
      {/* Toolbar */}
      <div
        style={{
          height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
          background: "#1a1a1a", borderBottom: "1px solid #2a2a2a", flexShrink: 0,
        }}
      >
        <button
          onClick={handleImport}
          disabled={loading || scanning}
          style={{
            padding: "3px 12px", fontSize: 11, fontWeight: 600,
            background: "#2a2a2a", color: "#ccc", border: "1px solid #3a3a3a",
            borderRadius: 4, cursor: "pointer",
          }}
        >
          {loading ? "Loading…" : "Import Folder"}
        </button>

        <button
          onClick={handleScan}
          disabled={loading || scanning || !catalogFolderPath}
          title={catalogFolderPath ? `Scan for new files in ${catalogFolderPath}` : "Import a folder first"}
          style={{
            padding: "3px 12px", fontSize: 11, fontWeight: 600,
            background: scanning ? "#2a2a2a" : "#1e2e3e",
            color: scanning ? "#888" : "#5b9bd5",
            border: "1px solid #2a4a6a",
            borderRadius: 4,
            cursor: loading || scanning || !catalogFolderPath ? "default" : "pointer",
            opacity: catalogFolderPath ? 1 : 0.5,
          }}
        >
          {scanning ? "Scanning…" : "Scan"}
        </button>

        <button
          onClick={handleRefreshMetadata}
          disabled={refreshing}
          title="Re-read ID3 tags (title, artist, album art) for all tracks"
          style={{
            padding: "3px 10px", fontSize: 11, fontWeight: 600,
            background: "transparent", color: refreshing ? "#555" : "#888",
            border: "1px solid #333", borderRadius: 4, cursor: refreshing ? "default" : "pointer",
          }}
        >
          {refreshing ? "Refreshing…" : "↻ Refresh Tags"}
        </button>

        <button
          onClick={handleRebuildWaveforms}
          disabled={rebuildingWaves}
          title="Regenerate waveform preview cache for all analyzed tracks (fast)"
          style={{
            padding: "3px 10px", fontSize: 11, fontWeight: 600,
            background: "transparent", color: rebuildingWaves ? "#555" : "#888",
            border: "1px solid #333", borderRadius: 4, cursor: rebuildingWaves ? "default" : "pointer",
          }}
        >
          {rebuildingWaves ? "Rebuilding…" : "⟳ Rebuild Waveforms"}
        </button>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          style={{
            flex: 1, maxWidth: 240, padding: "3px 8px", fontSize: 11,
            background: "#222", color: "#ccc", border: "1px solid #333",
            borderRadius: 4, outline: "none",
          }}
        />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16, color: "#666", fontSize: 11 }}>
          {isPolling && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#b87800" }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: "#b87800",
                animation: "pulse 1.2s ease-in-out infinite",
              }} />
              Analyzing…
            </span>
          )}
          {stats && (
            <>
              <span>{stats.total_entries} files</span>
              <span>{stats.ready_entries} analyzed</span>
              <span>{(stats.total_duration_s / 60).toFixed(1)} min</span>
            </>
          )}
        </div>
      </div>

      {/* Player strip — top, Lexicon-style */}
      <PlayerStrip />

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <CatalogTable />
        <TrackProfilePanel />
      </div>
    </div>
  );
}
