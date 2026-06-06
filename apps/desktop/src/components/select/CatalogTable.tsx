import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { CatalogEntry } from "@odeon/shared";
import { useSelectStore } from "../../stores/selectStore";
import { FieldTooltip, FIELD_TOOLTIPS } from "./FieldTooltip";
import { apiClient } from "../../lib/apiClient";
import { loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import { StaticWaveform } from "./WaveformRenderer";
import type { WaveformMode } from "../../stores/selectStore";
import type { WaveformCache } from "../../lib/waveformEngine/types";

const ROW_HEIGHT = 42;
const WAVE_W = 120;
const WAVE_H = 28;
const OVERSCAN = 8; // extra rows rendered above/below viewport

function MiniWaveform({ entry, mode }: { entry: CatalogEntry; mode: WaveformMode }) {
  const [cache, setCache] = useState<WaveformCache | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (entry.status !== "ready") return;
    setCache(null);
    setFailed(false);
    let cancelled = false;
    loadWaveformCache(entry.file_path)
      .then(c => {
        if (cancelled) return;
        if (c) setCache(c);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [entry.file_path, entry.status]);

  return (
    <div style={{
      width: WAVE_W, height: WAVE_H, borderRadius: 2, overflow: "hidden",
      background: "#0a0a0a", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {cache
        ? <StaticWaveform cache={cache} width={WAVE_W} height={WAVE_H} mode={mode} />
        : failed
          ? <span style={{ fontSize: 8, color: "#333" }}>no cache</span>
          : entry.status === "ready"
            ? <span style={{ fontSize: 8, color: "#2a2a2a" }}>···</span>
            : null
      }
    </div>
  );
}

function formatDuration(s?: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
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
  { key: "Duration", label: "DURATION", width: 68,  tip: true  },
  { key: "BPM",      label: "BPM",      width: 58,  tip: true  },
  { key: "Key",      label: "KEY",      width: 60,  tip: true  },
  { key: "LUFS",     label: "LUFS",     width: 58,  tip: true  },
  { key: "Status",   label: "STATUS",   width: 76,  tip: true  },
];

function displayTitle(entry: CatalogEntry): string {
  if (entry.title) return entry.title;
  const name = entry.file_name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function CatalogTable() {
  const { entries, selectedId, selectEntry, filter, waveformMode } = useSelectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(500);

  // Track container height for virtual scroll
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

  // Virtual scroll calculations
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = filtered.slice(startIdx, endIdx);
  const paddingTop = startIdx * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (filtered.length - endIdx) * ROW_HEIGHT);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto"
      style={{ fontSize: 12, position: "relative" }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          {COLUMNS.map(c => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead>
          <tr style={{ background: "#1e1e1e", color: "#666", position: "sticky", top: 0, zIndex: 1 }}>
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
          {/* Top spacer */}
          {paddingTop > 0 && <tr><td colSpan={COLUMNS.length} style={{ height: paddingTop, padding: 0, border: "none" }} /></tr>}

          {visibleRows.map((entry) => {
            const selected = entry.id === selectedId;
            return (
              <tr
                key={entry.id}
                onClick={() => selectEntry(entry.id)}
                style={{
                  height: ROW_HEIGHT,
                  background: selected ? "rgba(255,255,255,0.06)" : "transparent",
                  cursor: "pointer",
                  borderBottom: "1px solid #222",
                }}
                onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = selected ? "rgba(255,255,255,0.06)" : "transparent"; }}
              >
                <td style={{ padding: "4px 4px 4px 8px" }}><MiniWaveform entry={entry} mode={waveformMode} /></td>
                <td style={{ padding: "4px 4px" }}><AlbumArt entry={entry} /></td>
                <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ddd", fontWeight: 500 }}>
                  {displayTitle(entry)}
                </td>
                <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#999" }}>
                  {entry.artist ?? "—"}
                </td>
                <td style={{ padding: "4px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#666" }}>
                  {entry.album ?? "—"}
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
                <td style={{ padding: "4px 10px" }}><StatusBadge status={entry.status} /></td>
              </tr>
            );
          })}

          {/* Bottom spacer */}
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
  );
}
