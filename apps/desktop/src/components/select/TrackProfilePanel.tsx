/**
 * TrackProfilePanel — waveform + metadata panel for a selected catalog entry.
 * Features: colored frequency waveform, beat grid, hot cues, memory points,
 * loops, and tag editing.
 */
import { useEffect, useState, useCallback } from "react";
import { useSelectStore } from "../../stores/selectStore";
import { apiClient, type StemJobData, type StemPathsData, type TrackAnalysisData } from "../../lib/apiClient";
import { getCachedWaveform, loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import { pauseSelectStemPreview, playSelectStemFile } from "../../lib/useSelectEngineSync";
import { ColoredWaveformCanvas } from "./ColoredWaveformCanvas";
import { FieldTooltip, FIELD_TOOLTIPS } from "./FieldTooltip";
import type { CatalogEntry, CatalogMarker, MarkerType, CreateMarkerRequest } from "@odeon/shared";
import type { WaveformCache } from "../../lib/waveformEngine/types";

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

const HOT_CUE_COLORS = ["#e74c3c","#2ecc71","#3498db","#f1c40f","#e67e22","#9b59b6","#1abc9c","#e91e63"];

const MARKER_LABEL: Record<MarkerType, string> = {
  hot_cue: "Hot Cue",
  memory:  "Memory",
  cue:     "Cue",
  loop:    "Loop",
};

function sectionColor(label: string): string {
  const map: Record<string, string> = {
    intro: "#6b7280", build: "#facc15", drop: "#f87171",
    breakdown: "#a78bfa", bridge: "#38bdf8", outro: "#4ade80",
  };
  return map[label.toLowerCase()] ?? "#888";
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function formatDuration(s?: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function stemStatusLabel(job: StemJobData | null, stemCount: number): string {
  if (!job) return stemCount > 0 ? `Ready (${stemCount} stems)` : "Not separated";
  if (job.status === "queued") return "Queued…";
  if (job.status === "running") return "Separating…";
  if (job.status === "completed") return `Ready (${stemCount || 4} stems)`;
  if (job.status === "failed") return job.last_error ? `Failed — ${job.last_error}` : "Failed";
  return "Not separated";
}

function fileFormat(entry: CatalogEntry): string {
  const name = entry.file_name || entry.file_path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "—";
  const ext = name.slice(dot + 1).trim();
  return ext ? ext.toUpperCase() : "—";
}

// ─────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  const tip = FIELD_TOOLTIPS[label];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #222" }}>
      <span style={{ color: "#888", fontSize: 11, display: "flex", alignItems: "center" }}>
        {label}{tip && <FieldTooltip text={tip} />}
      </span>
      <span style={{ color: "#ccc", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginTop: 14, marginBottom: 6 }}>
      {children}
    </div>
  );
}

interface MarkerRowProps {
  marker: CatalogMarker;
  onDelete: (id: string) => void;
}
function MarkerRow({ marker, onDelete }: MarkerRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: "1px solid #1e1e1e" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: marker.color, flexShrink: 0 }} />
      <span style={{ color: "#aaa", fontSize: 10, flex: 1 }}>
        {marker.label || MARKER_LABEL[marker.type]} — {formatTime(marker.time_seconds)}
        {marker.end_time_seconds != null && ` → ${formatTime(marker.end_time_seconds)}`}
      </span>
      <button
        onClick={() => onDelete(marker.id)}
        style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
        title="Delete"
      >×</button>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Add-marker mini-form
// ─────────────────────────────────────────────

interface AddMarkerFormProps {
  onAdd: (req: CreateMarkerRequest) => void;
  duration: number;
}
function AddMarkerForm({ onAdd, duration }: AddMarkerFormProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MarkerType>("cue");
  const [time, setTime] = useState("0");
  const [endTime, setEndTime] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#ff6b35");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: 6, width: "100%", padding: "4px 0", background: "#222",
          border: "1px solid #333", borderRadius: 4, color: "#888", fontSize: 10,
          cursor: "pointer",
        }}
      >
        + Add Marker
      </button>
    );
  }

  return (
    <div style={{ marginTop: 6, background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 4, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {(["cue","hot_cue","memory","loop"] as MarkerType[]).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              flex: 1, padding: "2px 0", fontSize: 9, fontWeight: 600,
              background: type === t ? "#333" : "#1a1a1a",
              border: `1px solid ${type === t ? "#555" : "#2a2a2a"}`,
              color: type === t ? "#ddd" : "#666", borderRadius: 3, cursor: "pointer",
            }}
          >
            {MARKER_LABEL[t]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <label style={{ color: "#666", fontSize: 10, width: 32 }}>At</label>
        <input
          type="number" min={0} max={duration} step={0.1} value={time}
          onChange={e => setTime(e.target.value)}
          style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#ccc", fontSize: 10, padding: "2px 4px", borderRadius: 3 }}
        />
        <span style={{ color: "#555", fontSize: 9 }}>s</span>
      </div>
      {type === "loop" && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <label style={{ color: "#666", fontSize: 10, width: 32 }}>End</label>
          <input
            type="number" min={0} max={duration} step={0.1} value={endTime}
            onChange={e => setEndTime(e.target.value)}
            style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#ccc", fontSize: 10, padding: "2px 4px", borderRadius: 3 }}
          />
          <span style={{ color: "#555", fontSize: 9 }}>s</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <label style={{ color: "#666", fontSize: 10, width: 32 }}>Label</label>
        <input
          value={label} onChange={e => setLabel(e.target.value)} placeholder="optional"
          style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#ccc", fontSize: 10, padding: "2px 4px", borderRadius: 3 }}
        />
        <input type="color" value={color} onChange={e => setColor(e.target.value)}
          style={{ width: 22, height: 22, border: "none", borderRadius: 3, cursor: "pointer", padding: 0 }}
        />
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <button
          onClick={() => {
            onAdd({ type, time_seconds: parseFloat(time) || 0, end_time_seconds: type === "loop" && endTime ? parseFloat(endTime) : null, label: label || null, color });
            setOpen(false); setLabel(""); setTime("0"); setEndTime("");
          }}
          style={{ flex: 1, padding: "3px 0", background: "#2a6496", border: "none", color: "#fff", fontSize: 10, borderRadius: 3, cursor: "pointer" }}
        >
          Save
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ flex: 1, padding: "3px 0", background: "#2a2a2a", border: "none", color: "#888", fontSize: 10, borderRadius: 3, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Tags editor
// ─────────────────────────────────────────────

function TagsEditor({ entry, onUpdate }: { entry: CatalogEntry; onUpdate: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const t = draft.trim();
    if (t && !entry.tags.includes(t)) onUpdate([...entry.tags, t]);
    setDraft(""); setAdding(false);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {entry.tags.map(tag => (
          <span
            key={tag}
            style={{ background: "#2a2a2a", color: "#aaa", padding: "2px 6px", borderRadius: 3, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
          >
            {tag}
            <span
              onClick={() => onUpdate(entry.tags.filter(t => t !== tag))}
              style={{ cursor: "pointer", color: "#555", fontSize: 11 }}
            >×</span>
          </span>
        ))}
      </div>
      {adding ? (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addTag(); if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
            placeholder="tag name"
            style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#ccc", fontSize: 10, padding: "2px 6px", borderRadius: 3, outline: "none" }}
          />
          <button onClick={addTag} style={{ background: "#2a6496", border: "none", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer" }}>Add</button>
          <button onClick={() => { setAdding(false); setDraft(""); }} style={{ background: "#222", border: "none", color: "#888", fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer" }}>✕</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ background: "none", border: "1px dashed #333", color: "#555", fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer" }}
        >
          + tag
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main panel
// ─────────────────────────────────────────────

const WAVEFORM_W = 248;
const WAVEFORM_H = 72;

export function TrackProfilePanel() {
  const { selectedId, entries, updateEntryTags, loadStemsSummary, ensurePolling } = useSelectStore();
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [cache, setCache] = useState<WaveformCache | null>(null);
  const [markers, setMarkers] = useState<CatalogMarker[]>([]);
  const [analysis, setAnalysis] = useState<TrackAnalysisData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [stemJob, setStemJob] = useState<StemJobData | null>(null);
  const [stemCount, setStemCount] = useState(0);
  const [stemPaths, setStemPaths] = useState<StemPathsData | null>(null);
  const [separating, setSeparating] = useState(false);
  const [playingStem, setPlayingStem] = useState<string | null>(null);
  const [stemPlayError, setStemPlayError] = useState<string | null>(null);

  const refreshStemState = useCallback(async (entryId: string) => {
    let job: StemJobData | null = null;
    let count = 0;
    let paths: StemPathsData | null = null;
    try {
      job = await apiClient.select.getStemJob(entryId);
    } catch {
      job = null;
    }
    try {
      const stems = await apiClient.select.getStems(entryId);
      paths = stems;
      count = [stems.vocals_path, stems.drums_path, stems.bass_path, stems.other_path]
        .filter(Boolean).length;
    } catch {
      count = 0;
      paths = null;
    }
    setStemJob(job);
    setStemCount(count);
    setStemPaths(paths);
    return job;
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEntry(null);
      setCache(null);
      setMarkers([]);
      setStemJob(null);
      setStemCount(0);
      return;
    }
    const e = entries.find(e => e.id === selectedId) ?? null;
    setEntry(e);
    setCache(null);

    if (e && e.status === "pending") {
      apiClient.select.analyzeEntry(e.id).catch(() => {});
    }
    if (e) {
      apiClient.select.listMarkers(e.id).then(setMarkers).catch(() => {});
      apiClient.select.getAnalysis(e.id).then(r => setAnalysis(r.analysis)).catch(() => setAnalysis(null));
      refreshStemState(e.id).catch(() => {});
    }
  }, [selectedId, entries, refreshStemState]);

  useEffect(() => {
    if (!entry) return;
    if (stemJob?.status !== "queued" && stemJob?.status !== "running") return;
    const timer = window.setInterval(() => {
      refreshStemState(entry.id).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [entry, stemJob?.status, refreshStemState]);

  // Load waveform cache when entry is ready
  useEffect(() => {
    if (!entry?.file_path || entry.status !== "ready") return;
    const instant = getCachedWaveform(entry.file_path);
    if (instant) {
      setCache(instant);
      return;
    }
    loadWaveformCache(entry.file_path, entry.waveform_cache_path, entry.id).then(c => setCache(c)).catch(() => {});
  }, [entry?.file_path, entry?.status, entry?.waveform_cache_path, entry?.id]);

  const handleAddMarker = useCallback(async (req: CreateMarkerRequest) => {
    if (!entry) return;
    try {
      const m = await apiClient.select.createMarker(entry.id, req);
      setMarkers(prev => [...prev, m].sort((a, b) => a.time_seconds - b.time_seconds));
    } catch {}
  }, [entry]);

  const handleDeleteMarker = useCallback(async (markerId: string) => {
    if (!entry) return;
    try {
      await apiClient.select.deleteMarker(entry.id, markerId);
      setMarkers(prev => prev.filter(m => m.id !== markerId));
    } catch {}
  }, [entry]);

  const handleUpdateTags = useCallback(async (tags: string[]) => {
    if (!entry) return;
    try {
      await apiClient.select.updateTags(entry.id, tags);
      updateEntryTags(entry.id, tags);
    } catch {}
  }, [entry, updateEntryTags]);

  if (!entry) {
    return (
      <div style={{
        width: 280, padding: 24, color: "#555", fontSize: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#1a1a1a", borderLeft: "1px solid #2a2a2a",
      }}>
        Select a file to preview
      </div>
    );
  }

  const hotCues    = markers.filter(m => m.type === "hot_cue");
  const memories   = markers.filter(m => m.type === "memory");
  const cues       = markers.filter(m => m.type === "cue");
  const loops      = markers.filter(m => m.type === "loop");

  return (
    <div style={{
      width: 280, flexShrink: 0, display: "flex", flexDirection: "column",
      background: "#1a1a1a", borderLeft: "1px solid #2a2a2a", overflow: "auto",
    }}>
      {/* Colored waveform */}
      <div style={{
        padding: "8px 16px", background: "#111",
        borderBottom: "1px solid #2a2a2a", flexShrink: 0,
      }}>
        <div style={{ borderRadius: 3, overflow: "hidden", background: "#0c0c0c" }}>
          <ColoredWaveformCanvas
            cache={cache}
            beatTimes={entry.beat_times}
            width={WAVEFORM_W}
            height={WAVEFORM_H}
          />
        </div>
        {/* Beat count hint */}
        {entry.beat_times && entry.beat_times.length > 0 && (
          <div style={{ marginTop: 4, color: "#555", fontSize: 9 }}>
            {entry.beat_times.length} beats detected · beat grid shown
          </div>
        )}
      </div>

      {/* Hot cue buttons (1-8) */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #222", flexShrink: 0 }}>
        <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 5 }}>HOT CUES</div>
        <div style={{ display: "flex", gap: 3 }}>
          {HOT_CUE_COLORS.map((col, i) => {
            const existing = hotCues.find(m => m.color === col) ?? hotCues[i];
            return (
              <div
                key={i}
                title={existing ? `${existing.label || "Hot Cue " + (i + 1)} @ ${formatTime(existing.time_seconds)}` : `Hot Cue ${i + 1} (empty)`}
                style={{
                  width: 26, height: 26, borderRadius: 4, border: `2px solid ${existing ? col : "#2a2a2a"}`,
                  background: existing ? col + "33" : "#111",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "default", fontSize: 9, fontWeight: 700, color: existing ? col : "#333",
                }}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      </div>

      {/* Metadata */}
      <div style={{ padding: "8px 16px", flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: "#ddd", marginBottom: 8, wordBreak: "break-word", lineHeight: 1.3 }}>
          {entry.file_name}
        </div>
        <MetaRow label="Status"   value={entry.status} />
        <MetaRow label="Format"   value={fileFormat(entry)} />
        <MetaRow label="Duration" value={formatDuration(entry.duration_seconds)} />
        <MetaRow label="BPM"      value={entry.bpm != null ? entry.bpm.toFixed(2) : null} />
        <MetaRow label="Key"      value={entry.key} />
        <MetaRow label="LUFS"     value={entry.integrated_lufs != null ? entry.integrated_lufs.toFixed(1) : null} />
        <MetaRow label="Peak dB"  value={entry.true_peak_db != null ? entry.true_peak_db.toFixed(1) : null} />
        <MetaRow label="RMS dB"   value={entry.rms_db != null ? entry.rms_db.toFixed(1) : null} />
        <MetaRow label="Channels" value={entry.channels} />
        <MetaRow label="Rate"     value={entry.sample_rate != null ? `${entry.sample_rate} Hz` : null} />

        {/* ML Analysis */}
        <SectionHeader>AI ANALYSIS</SectionHeader>
        {analysis ? (
          <div style={{ marginBottom: 8 }}>
            {analysis.mood && <MetaRow label="Mood" value={analysis.mood} />}
            {analysis.energy_arc && <MetaRow label="Energy" value={analysis.energy_arc} />}
            {analysis.rhythm_pattern && <MetaRow label="Rhythm" value={analysis.rhythm_pattern} />}
            {analysis.vocal_enters_seconds != null && (
              <MetaRow label="Vocals at" value={`${analysis.vocal_enters_seconds}s`} />
            )}
            {analysis.sections && analysis.sections.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {analysis.sections.map((s, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", fontSize: 9,
                    padding: "2px 0", borderBottom: "1px solid #1a1a1a",
                  }}>
                    <span style={{ color: sectionColor(s.label) }}>{s.label}</span>
                    <span style={{ color: "#555" }}>{s.start_seconds}s–{s.end_seconds}s</span>
                  </div>
                ))}
              </div>
            )}
            {analysis.transition_notes && (
              <p style={{ color: "#555", fontSize: 9, marginTop: 6, lineHeight: 1.4 }}>{analysis.transition_notes}</p>
            )}
          </div>
        ) : (
          <p style={{ color: "#444", fontSize: 10, marginBottom: 6 }}>No AI analysis yet.</p>
        )}
        <button
          disabled={analyzing || entry.status !== "ready"}
          onClick={async () => {
            if (!entry) return;
            setAnalyzing(true);
            try {
              const r = await apiClient.select.analyzeMl(entry.id);
              setAnalysis(r.analysis);
            } catch { /* RunPod may be offline */ }
            finally { setAnalyzing(false); }
          }}
          style={{
            background: "#111", border: "1px solid #333", borderRadius: 4,
            padding: "4px 8px", color: analyzing ? "#444" : "#888",
            fontSize: 10, cursor: analyzing ? "default" : "pointer", width: "100%",
          }}
        >
          {analyzing ? "Analyzing…" : "Run AI Analysis"}
        </button>

        <SectionHeader>STEMS</SectionHeader>
        <MetaRow label="Status" value={stemStatusLabel(stemJob, stemCount)} />
        {stemCount > 0 && stemPaths?.vocals_path && (
          <div style={{ marginTop: 6, marginBottom: 6 }}>
            <div style={{ color: "#555", fontSize: 9, marginBottom: 4, wordBreak: "break-all" }}>
              {stemPaths.vocals_path.replace(/\/[^/]+\.wav$/, "/")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {(["vocals", "drums", "bass", "other"] as const).map(stem => {
                const hasStem = Boolean(stemPaths[`${stem}_path` as keyof StemPathsData]);
                const active = playingStem === stem;
                return (
                  <button
                    key={stem}
                    disabled={!hasStem}
                    onClick={async () => {
                      if (!entry || !hasStem) return;
                      const stemPath = stemPaths[`${stem}_path` as keyof StemPathsData];
                      if (!stemPath) return;
                      if (active) {
                        await pauseSelectStemPreview();
                        setPlayingStem(null);
                        return;
                      }
                      setStemPlayError(null);
                      try {
                        const label = `${stem} — ${entry.title || entry.file_name}`;
                        await playSelectStemFile(stemPath, label, stem);
                        setPlayingStem(stem);
                      } catch (err) {
                        setPlayingStem(null);
                        setStemPlayError(err instanceof Error ? err.message : "Playback failed");
                      }
                    }}
                    style={{
                      padding: "5px 6px",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "capitalize",
                      background: active ? "#2d5a2d" : "#1a2e1a",
                      border: `1px solid ${active ? "#4ade80" : "#2d5a2d"}`,
                      color: hasStem ? (active ? "#4ade80" : "#8fd9a0") : "#444",
                      borderRadius: 4,
                      cursor: hasStem ? "pointer" : "default",
                    }}
                  >
                    {active ? `■ ${stem}` : `▶ ${stem}`}
                  </button>
                );
              })}
            </div>
            {stemPlayError && (
              <div style={{ marginTop: 4, color: "#f87171", fontSize: 9 }}>{stemPlayError}</div>
            )}
          </div>
        )}
        <button
          disabled={
            separating
            || entry.status !== "ready"
            || stemJob?.status === "queued"
            || stemJob?.status === "running"
          }
          onClick={async () => {
            if (!entry) return;
            setSeparating(true);
            try {
              const result = await apiClient.select.separate(entry.id);
              if (result.job) setStemJob(result.job);
              else setStemJob({ entry_id: entry.id, status: "queued" });
              await refreshStemState(entry.id);
              await loadStemsSummary();
              ensurePolling();
            } catch {
              setStemJob({ entry_id: entry.id, status: "failed", last_error: "Could not start separation" });
            } finally {
              setSeparating(false);
            }
          }}
          style={{
            marginTop: 6,
            background: "#1a2e1a",
            border: "1px solid #2d5a2d",
            borderRadius: 4,
            padding: "4px 8px",
            color: separating || stemJob?.status === "queued" || stemJob?.status === "running" ? "#444" : "#4ade80",
            fontSize: 10,
            cursor: separating || stemJob?.status === "queued" || stemJob?.status === "running" ? "default" : "pointer",
            width: "100%",
          }}
        >
          {separating || stemJob?.status === "queued" || stemJob?.status === "running"
            ? "Separating…"
            : stemCount > 0 || stemJob?.status === "completed"
              ? "Re-separate Stems"
              : "Separate Stems"}
        </button>

        {/* Tags */}
        <SectionHeader>TAGS</SectionHeader>
        <TagsEditor entry={entry} onUpdate={handleUpdateTags} />

        {/* Cue Points */}
        {(cues.length > 0 || true) && (
          <>
            <SectionHeader>CUE POINTS</SectionHeader>
            {cues.map(m => <MarkerRow key={m.id} marker={m} onDelete={handleDeleteMarker} />)}
          </>
        )}

        {/* Hot Cues */}
        {hotCues.length > 0 && (
          <>
            <SectionHeader>HOT CUES</SectionHeader>
            {hotCues.map(m => <MarkerRow key={m.id} marker={m} onDelete={handleDeleteMarker} />)}
          </>
        )}

        {/* Memory Points */}
        {memories.length > 0 && (
          <>
            <SectionHeader>MEMORY POINTS</SectionHeader>
            {memories.map(m => <MarkerRow key={m.id} marker={m} onDelete={handleDeleteMarker} />)}
          </>
        )}

        {/* Loops */}
        {loops.length > 0 && (
          <>
            <SectionHeader>LOOPS</SectionHeader>
            {loops.map(m => <MarkerRow key={m.id} marker={m} onDelete={handleDeleteMarker} />)}
          </>
        )}

        {/* Add marker form */}
        <AddMarkerForm
          onAdd={handleAddMarker}
          duration={entry.duration_seconds ?? 600}
        />
      </div>
    </div>
  );
}
