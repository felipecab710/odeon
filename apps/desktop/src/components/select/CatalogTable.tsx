import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { StemSummaryEntry } from "../../lib/apiClient";
import { useSelectStore } from "../../stores/selectStore";
import { FieldTooltip, FIELD_TOOLTIPS } from "./FieldTooltip";
import { apiClient } from "../../lib/apiClient";
import { getCachedWaveform, loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import {
  pauseSelectStemPreview,
  playSelectStemFile,
  prefetchSelectDeck,
  type SelectPlaybackMode,
} from "../../lib/useSelectEngineSync";
import { StaticWaveform } from "./WaveformRenderer";
import type { WaveformMode } from "../../stores/selectStore";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import { AddToSetContextMenu } from "./AddToSetContextMenu";

const ROW_HEIGHT = 42;
const WAVE_W = 120;
const WAVE_H = 28;
const OVERSCAN = 8;

const STEM_TYPES = ["vocals", "drums", "bass", "other"] as const;
type StemType = (typeof STEM_TYPES)[number];

const STEM_LABELS: Record<StemType, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

const STEM_COLORS: Record<StemType, string> = {
  vocals: "#60a5fa",
  drums: "#fb923c",
  bass: "#a78bfa",
  other: "#4ade80",
};

type FlatRow =
  | { kind: "track"; entry: CatalogEntry }
  | { kind: "stem"; entry: CatalogEntry; stem: StemType };

function entryHasStemActivity(summary?: StemSummaryEntry): boolean {
  if (!summary) return false;
  return summary.has_stems
    || summary.job_status === "queued"
    || summary.job_status === "running"
    || summary.job_status === "failed";
}

function MiniWaveform({ entry, mode }: { entry: CatalogEntry; mode: WaveformMode }) {
  const [cache, setCache] = useState<WaveformCache | null>(
    () => (entry.status === "ready" ? getCachedWaveform(entry.file_path) : null),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (entry.status !== "ready") return;
    const instant = getCachedWaveform(entry.file_path);
    if (instant) {
      setCache(instant);
      setFailed(false);
      return;
    }
    setFailed(false);
    let cancelled = false;
    loadWaveformCache(entry.file_path, entry.waveform_cache_path, entry.id)
      .then(c => {
        if (cancelled) return;
        if (c) setCache(c);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [entry.file_path, entry.waveform_cache_path, entry.status]);

  return (
    <div style={{
      width: WAVE_W, height: WAVE_H, borderRadius: 2, overflow: "hidden",
      background: "#0a0a0a", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {cache
        ? <StaticWaveform cache={cache} width={WAVE_W} height={WAVE_H} mode={mode} cacheKey={entry.file_path} />
        : failed
          ? <span style={{ fontSize: 8, color: "#333" }}>no cache</span>
          : entry.status === "ready"
            ? <span style={{ fontSize: 8, color: "#2a2a2a" }}>···</span>
            : null
      }
    </div>
  );
}

function StemPreview({ stem }: { stem: StemType }) {
  const color = STEM_COLORS[stem];
  return (
    <div style={{
      width: WAVE_W, height: WAVE_H, borderRadius: 2, overflow: "hidden",
      background: "#0a0a0a", flexShrink: 0, position: "relative",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(90deg, ${color}22 0%, ${color}44 50%, ${color}22 100%)`,
      }} />
      <div style={{
        position: "absolute", left: 6, right: 6, top: "50%", height: 2,
        transform: "translateY(-50%)", background: color, opacity: 0.7, borderRadius: 1,
      }} />
    </div>
  );
}

function formatDuration(s?: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function fileFormat(entry: CatalogEntry): string {
  const name = entry.file_name || entry.file_path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "—";
  const ext = name.slice(dot + 1).trim();
  return ext ? ext.toUpperCase() : "—";
}

function StemBadge({ summary, expandable, expanded, onToggle }: {
  summary?: StemSummaryEntry;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  if (!summary) {
    return <span style={{ color: "#444", fontSize: 10 }}>—</span>;
  }

  let label = "—";
  let style: React.CSSProperties = { color: "#444", fontSize: 10 };

  if (summary.has_stems) {
    label = "STEMS";
    style = {
      display: "inline-block", padding: "1px 6px", borderRadius: 3,
      fontSize: 10, fontWeight: 700, background: "#1a3d2a", color: "#4ade80",
      cursor: expandable ? "pointer" : "default",
    };
  } else if (summary.job_status === "queued" || summary.job_status === "running") {
    label = "···";
    style = {
      display: "inline-block", padding: "1px 6px", borderRadius: 3,
      fontSize: 10, fontWeight: 700, background: "#3d3200", color: "#fbbf24",
      cursor: expandable ? "pointer" : "default",
    };
  } else if (summary.job_status === "failed") {
    label = "FAIL";
    style = {
      display: "inline-block", padding: "1px 6px", borderRadius: 3,
      fontSize: 10, fontWeight: 700, background: "#3d1a1a", color: "#f87171",
      cursor: expandable ? "pointer" : "default",
    };
  }

  if (!expandable) {
    return <span title="Stems" style={style}>{label}</span>;
  }

  return (
    <button
      type="button"
      title={expanded ? "Collapse stems" : "Expand stems"}
      onClick={e => { e.stopPropagation(); onToggle?.(); }}
      style={{
        ...style,
        border: expanded ? "1px solid rgba(74,222,128,0.4)" : "1px solid transparent",
      }}
    >
      {expanded ? "▾ " : "▸ "}{label}
    </button>
  );
}

function StemRowStatus({ summary, stem }: { summary?: StemSummaryEntry; stem: StemType }) {
  if (!summary) return <span style={{ color: "#444", fontSize: 10 }}>—</span>;

  const ready = summary.stems?.[stem];
  if (ready) {
    return (
      <span style={{
        display: "inline-block", padding: "1px 6px", borderRadius: 3,
        fontSize: 10, fontWeight: 600, background: "#1e8a46", color: "#fff",
        textTransform: "uppercase", letterSpacing: "0.04em",
      }}>ready</span>
    );
  }
  if (summary.job_status === "running") {
    return <span style={{ color: "#fbbf24", fontSize: 10, fontWeight: 600 }}>running</span>;
  }
  if (summary.job_status === "queued") {
    return <span style={{ color: "#fbbf24", fontSize: 10, fontWeight: 600 }}>queued</span>;
  }
  if (summary.job_status === "failed") {
    return <span style={{ color: "#f87171", fontSize: 10, fontWeight: 600 }}>failed</span>;
  }
  return <span style={{ color: "#444", fontSize: 10 }}>—</span>;
}

function StatusBadge({ status }: { status: CatalogEntry["status"] }) {
  const colors: Record<CatalogEntry["status"], string> = {
    pending:   "#444",
    analyzing: "#b87800",
    ready:     "#1e8a46",
    error:     "#c0392b",
  };
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 3,
      fontSize: 10, fontWeight: 600, background: colors[status],
      color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {status}
    </span>
  );
}

function AlbumArt({ entry }: { entry: CatalogEntry }) {
  if (!entry.has_artwork) {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: 3, background: "#222",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, border: "1px solid #2a2a2a",
      }}>
        <span style={{ color: "#444", fontSize: 10 }}>♪</span>
      </div>
    );
  }
  return (
    <img
      src={apiClient.select.artworkUrl(entry.id)}
      alt=""
      width={32}
      height={32}
      style={{ borderRadius: 3, objectFit: "cover", flexShrink: 0, display: "block", border: "1px solid #333" }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

const COLUMNS = [
  { key: "wave",     label: "PREVIEW",  width: WAVE_W + 8, tip: false },
  { key: "art",      label: "",         width: 40,  tip: false },
  { key: "title",    label: "TITLE",    width: 180, tip: false },
  { key: "artist",   label: "ARTIST",   width: 140, tip: false },
  { key: "album",    label: "ALBUM",    width: 120, tip: false },
  { key: "Format",   label: "FORMAT",   width: 52,  tip: true  },
  { key: "Duration", label: "DURATION", width: 68,  tip: true  },
  { key: "BPM",      label: "BPM",      width: 58,  tip: true  },
  { key: "Key",      label: "KEY",      width: 60,  tip: true  },
  { key: "LUFS",     label: "LUFS",     width: 58,  tip: true  },
  { key: "Stems",    label: "STEMS",    width: 72,  tip: false },
  { key: "Status",   label: "STATUS",   width: 76,  tip: true  },
];

function displayTitle(entry: CatalogEntry): string {
  if (entry.title) return entry.title;
  const name = entry.file_name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function CatalogTable() {
  const { entries, selectedId, selectEntry, filter, waveformMode, stemsSummary } = useSelectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(500);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [playingStem, setPlayingStem] = useState<{ entryId: string; stem: StemType } | null>(null);
  const [stemPlayError, setStemPlayError] = useState<string | null>(null);
  const [addToSetMenu, setAddToSetMenu] = useState<{
    x: number;
    y: number;
    entry: CatalogEntry;
  } | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const obs = new ResizeObserver(([e]) => setViewportH(e.contentRect.height));
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const q = filter.toLowerCase();
    return entries.filter((e) =>
      e.file_name.toLowerCase().includes(q) ||
      (e.title?.toLowerCase().includes(q) ?? false) ||
      (e.artist?.toLowerCase().includes(q) ?? false) ||
      (e.album?.toLowerCase().includes(q) ?? false) ||
      (e.key?.toLowerCase().includes(q) ?? false) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [entries, filter]);

  const flatRows = useMemo((): FlatRow[] => {
    const rows: FlatRow[] = [];
    for (const entry of filtered) {
      rows.push({ kind: "track", entry });
      const summary = stemsSummary[entry.id];
      if (expandedIds.has(entry.id) && entryHasStemActivity(summary)) {
        for (const stem of STEM_TYPES) {
          rows.push({ kind: "stem", entry, stem });
        }
      }
    }
    return rows;
  }, [filtered, expandedIds, stemsSummary]);

  const toggleExpanded = useCallback((entryId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const playStem = useCallback(async (entry: CatalogEntry, stem: StemType) => {
    const key = { entryId: entry.id, stem };
    if (playingStem?.entryId === key.entryId && playingStem.stem === key.stem) {
      await pauseSelectStemPreview();
      setPlayingStem(null);
      return;
    }

    setStemPlayError(null);
    try {
      const paths = await apiClient.select.getStems(entry.id);
      const pathKey = `${stem}_path` as keyof typeof paths;
      const stemPath = paths[pathKey];
      if (!stemPath || typeof stemPath !== "string") {
        throw new Error(`${stem} stem not available`);
      }
      const label = `${stem} — ${entry.title || entry.file_name}`;
      await playSelectStemFile(stemPath, label, stem as SelectPlaybackMode);
      setPlayingStem(key);
      selectEntry(entry.id);
    } catch (err) {
      setPlayingStem(null);
      setStemPlayError(err instanceof Error ? err.message : "Playback failed");
    }
  }, [playingStem, selectEntry]);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(flatRows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = flatRows.slice(startIdx, endIdx);
  const paddingTop = startIdx * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (flatRows.length - endIdx) * ROW_HEIGHT);

  const closeAddToSetMenu = useCallback(() => setAddToSetMenu(null), []);

  const openAddToSetMenu = useCallback((e: React.MouseEvent, entry: CatalogEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setAddToSetMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleTableContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-catalog-entry-id]");
    if (!row) return;
    const entryId = row.dataset.catalogEntryId;
    if (!entryId) return;
    const entry = entries.find(item => item.id === entryId);
    if (!entry) return;
    openAddToSetMenu(e, entry);
  }, [entries, openAddToSetMenu]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  return (
    <>
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onContextMenuCapture={handleTableContextMenu}
      className="flex-1 overflow-auto"
      style={{ fontSize: 12, position: "relative" }}
    >
      {stemPlayError && (
        <div style={{
          position: "sticky", top: 0, zIndex: 2,
          padding: "4px 10px", background: "rgba(61,26,26,0.95)",
          color: "#f87171", fontSize: 11, borderBottom: "1px solid #3d1a1a",
        }}>
          {stemPlayError}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          {COLUMNS.map(c => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead>
          <tr style={{ background: "#1e1e1e", color: "#666", position: "sticky", top: stemPlayError ? 28 : 0, zIndex: 1 }}>
            {COLUMNS.map(c => (
              <th key={c.key} style={{
                padding: c.key === "art" ? "6px 8px" : "6px 10px",
                textAlign: "left", fontWeight: 600, fontSize: 10,
                letterSpacing: "0.06em", borderBottom: "1px solid #2a2a2a",
                whiteSpace: "nowrap", overflow: "hidden",
              }}>
                {c.key === "art" ? null : (
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    {c.label}
                    {c.tip && FIELD_TOOLTIPS[c.key] && <FieldTooltip text={FIELD_TOOLTIPS[c.key]} above />}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && <tr><td colSpan={COLUMNS.length} style={{ height: paddingTop, padding: 0, border: "none" }} /></tr>}

          {visibleRows.map((row) => {
            if (row.kind === "track") {
              const { entry } = row;
              const selected = entry.id === selectedId;
              const summary = stemsSummary[entry.id];
              const expandable = entryHasStemActivity(summary);
              const expanded = expandedIds.has(entry.id);

              return (
                <tr
                  key={`track-${entry.id}`}
                  data-catalog-entry-id={entry.id}
                  onClick={() => selectEntry(entry.id)}
                  style={{
                    height: ROW_HEIGHT,
                    background: selected ? "rgba(255,255,255,0.06)" : "transparent",
                    cursor: "pointer",
                    borderBottom: "1px solid #222",
                  }}
                  onMouseEnter={e => {
                    if (entry.status === "ready") {
                      prefetchSelectDeck(entry, { engine: true, activeEntryId: selectedId });
                    }
                    if (!selected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={e => {
                    if (!selected) {
                      (e.currentTarget as HTMLElement).style.background = selected
                        ? "rgba(255,255,255,0.06)"
                        : "transparent";
                    }
                  }}
                >
                  <td style={{ padding: "4px 4px 4px 8px" }}><MiniWaveform entry={entry} mode={waveformMode} /></td>
                  <td style={{ padding: "4px 4px" }}><AlbumArt entry={entry} /></td>
                  <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ddd", fontWeight: 500 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
                      {expandable && (
                        <button
                          type="button"
                          title={expanded ? "Collapse stems" : "Expand stems"}
                          onClick={e => { e.stopPropagation(); toggleExpanded(entry.id); }}
                          style={{
                            background: "none", border: "none", color: "#666",
                            fontSize: 10, cursor: "pointer", padding: 0, flexShrink: 0,
                          }}
                        >
                          {expanded ? "▾" : "▸"}
                        </button>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{displayTitle(entry)}</span>
                    </span>
                  </td>
                  <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#999" }}>
                    {entry.artist ?? "—"}
                  </td>
                  <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#666" }}>
                    {entry.album ?? "—"}
                  </td>
                  <td style={{ padding: "4px 10px", color: "#777", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>
                    {fileFormat(entry)}
                  </td>
                  <td style={{ padding: "4px 10px", color: "#888", fontVariantNumeric: "tabular-nums" }}>
                    {formatDuration(entry.duration_seconds)}
                  </td>
                  <td style={{ padding: "4px 10px", color: "#888", fontVariantNumeric: "tabular-nums" }}>
                    {entry.bpm != null ? entry.bpm.toFixed(1) : "—"}
                  </td>
                  <td style={{ padding: "4px 10px", color: "#888" }}>{entry.key ?? "—"}</td>
                  <td style={{ padding: "4px 10px", color: "#888", fontVariantNumeric: "tabular-nums" }}>
                    {entry.integrated_lufs != null ? entry.integrated_lufs.toFixed(1) : "—"}
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <StemBadge
                      summary={summary}
                      expandable={expandable}
                      expanded={expanded}
                      onToggle={() => toggleExpanded(entry.id)}
                    />
                  </td>
                  <td style={{ padding: "4px 10px" }}><StatusBadge status={entry.status} /></td>
                </tr>
              );
            }

            const { entry, stem } = row;
            const summary = stemsSummary[entry.id];
            const ready = summary?.stems?.[stem];
            const pending = !ready && (summary?.job_status === "queued" || summary?.job_status === "running");
            const active = playingStem?.entryId === entry.id && playingStem.stem === stem;
            const color = STEM_COLORS[stem];

            return (
              <tr
                key={`stem-${entry.id}-${stem}`}
                data-catalog-entry-id={entry.id}
                onClick={() => {
                  if (ready) void playStem(entry, stem);
                  else selectEntry(entry.id);
                }}
                style={{
                  height: ROW_HEIGHT,
                  background: active ? "rgba(45,90,45,0.12)" : "rgba(255,255,255,0.02)",
                  cursor: ready ? "pointer" : "default",
                  borderBottom: "1px solid #1a1a1a",
                }}
                onMouseEnter={e => {
                  if (ready) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = active
                    ? "rgba(45,90,45,0.12)"
                    : "rgba(255,255,255,0.02)";
                }}
              >
                <td style={{ padding: "4px 4px 4px 8px" }}><StemPreview stem={stem} /></td>
                <td style={{ padding: "4px 4px" }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 3,
                    background: `${color}18`, border: `1px solid ${color}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color, fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                  }}>
                    {stem.slice(0, 3)}
                  </div>
                </td>
                <td style={{
                  padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", color, fontWeight: 600,
                }}>
                  <span style={{ color: "#444", marginRight: 6 }}>↳</span>
                  {STEM_LABELS[stem]}
                </td>
                <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#777" }}>
                  {entry.artist ?? "—"}
                </td>
                <td style={{ padding: "4px 10px", color: "#555", fontSize: 10 }}>stem</td>
                <td style={{ padding: "4px 10px", color: "#666", fontSize: 10, fontWeight: 600 }}>WAV</td>
                <td style={{ padding: "4px 10px", color: "#666", fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(entry.duration_seconds)}
                </td>
                <td style={{ padding: "4px 10px", color: "#555", fontVariantNumeric: "tabular-nums" }}>
                  {entry.bpm != null ? entry.bpm.toFixed(1) : "—"}
                </td>
                <td style={{ padding: "4px 10px", color: "#555" }}>{entry.key ?? "—"}</td>
                <td style={{ padding: "4px 10px", color: "#555", fontVariantNumeric: "tabular-nums" }}>
                  {entry.integrated_lufs != null ? entry.integrated_lufs.toFixed(1) : "—"}
                </td>
                <td style={{ padding: "4px 10px" }}>
                  {ready ? (
                    <span style={{
                      display: "inline-block", padding: "1px 6px", borderRadius: 3,
                      fontSize: 10, fontWeight: 700, background: active ? "#2d5a2d" : "#1a3d2a",
                      color: active ? "#4ade80" : "#6ee7a0",
                    }}>
                      {active ? "■ PLAYING" : "▶ PLAY"}
                    </span>
                  ) : pending ? (
                    <span style={{ color: "#fbbf24", fontSize: 10, fontWeight: 600 }}>···</span>
                  ) : (
                    <span style={{ color: "#333", fontSize: 10 }}>—</span>
                  )}
                </td>
                <td style={{ padding: "4px 10px" }}>
                  <StemRowStatus summary={summary} stem={stem} />
                </td>
              </tr>
            );
          })}

          {paddingBottom > 0 && <tr><td colSpan={COLUMNS.length} style={{ height: paddingBottom, padding: 0, border: "none" }} /></tr>}

          {filtered.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} style={{ padding: "24px", textAlign: "center", color: "#555" }}>
                {entries.length === 0 ? "No files imported yet. Use Import Folder to add audio." : "No matches."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>

    {addToSetMenu && (
      <AddToSetContextMenu
        x={addToSetMenu.x}
        y={addToSetMenu.y}
        entry={addToSetMenu.entry}
        onClose={closeAddToSetMenu}
      />
    )}
    </>
  );
}
