import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSelectStore } from "../stores/selectStore";
import { useSetBuilderStore, type SetCard } from "../stores/setBuilderStore";
import { StudioWithBoothPanel } from "../components/setbuilder/StudioWithBoothPanel";
import { SetSequencePanel } from "../components/setbuilder/SetSequencePanel";
import { BoothPanel } from "../components/booth/BoothPanel";
import { ResizableRightSidebar } from "../components/layout/ResizableRightSidebar";
import { FieldTooltip } from "../components/select/FieldTooltip";
import type { CatalogEntry } from "@odeon/shared";
import {
  apiClient,
  type SuggestResult,
  type FlowEdge,
  type SemanticResult,
  type TransitionResult,
  type TlFetchStatus,
  type ProDjStatus,
  type SearchStatus,
  type TransitionPlanData,
  type GenerationResultData,
} from "../lib/apiClient";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function displayTitle(e: CatalogEntry) {
  if (e.title) return e.title;
  return e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

/** Camelot number → position string e.g. "8B" */
const CAMELOT_MAP: Record<string, string> = {
  "C maj":"8B","C min":"5A","C# maj":"3B","C# min":"12A",
  "D maj":"10B","D min":"7A","D# maj":"5B","D# min":"2A",
  "E maj":"12B","E min":"9A","F maj":"7B","F min":"4A",
  "F# maj":"2B","F# min":"11A","G maj":"9B","G min":"6A",
  "G# maj":"4B","G# min":"1A","A maj":"11B","A min":"8A",
  "A# maj":"6B","A# min":"3A","B maj":"1B","B min":"10A",
};

function camelot(k?: string | null) {
  return k ? CAMELOT_MAP[k] ?? k : "—";
}

function compatColor(v?: number | null) {
  if (v == null) return "#555";
  if (v >= 0.8) return "#4ade80";
  if (v >= 0.6) return "#facc15";
  if (v >= 0.4) return "#fb923c";
  return "#f87171";
}

function compatLabel(v?: number | null): string {
  if (v == null) return "—";
  if (v >= 0.8) return "Excellent";
  if (v >= 0.6) return "Good";
  if (v >= 0.4) return "Fair";
  return "Difficult";
}

/** Smart transition tip string */
function transitionTip(edge: FlowEdge): string {
  const tips: string[] = [];
  if (edge.bpm_delta != null) {
    if (edge.bpm_delta <= 2) tips.push("Tight sync — beatmatch directly");
    else if (edge.bpm_delta <= 6) tips.push("Nudge tempo ±" + edge.bpm_delta.toFixed(0) + " BPM");
    else if (edge.bpm_delta <= 15) tips.push("Slow tempo transition or filter");
    else tips.push("Large BPM jump — use phrase break");
  }
  if (edge.key_compat != null) {
    if (edge.key_compat >= 0.95) tips.push("Perfect harmonic match");
    else if (edge.key_compat >= 0.75) tips.push("Adjacent Camelot — blend freely");
    else if (edge.key_compat >= 0.5) tips.push("Energy boost key — use briefly");
    else tips.push("Key clash — use low-pass filter");
  }
  if (edge.lufs_delta != null && edge.lufs_delta > 3) {
    tips.push(`Gain adjust ±${edge.lufs_delta.toFixed(1)} LUFS`);
  }
  return tips[0] ?? "—";
}

// ─── LibrarySidebar ───────────────────────────────────────────────────────────

function LibrarySidebar({
  onSuggestMode,
  suggestMode,
  selectedEntryId,
}: {
  onSuggestMode: () => void;
  suggestMode: boolean;
  selectedEntryId: string | null;
}) {
  const {
    entries, collections, filter, setFilter, loadEntries, loadCollections,
    scanFolder, scanning, catalogFolderPath, isPolling,
  } = useSelectStore();
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const { addCard, cards } = useSetBuilderStore();
  const [suggestions, setSuggestions] = useState<SuggestResult[]>([]);
  const [semanticResults, setSemanticResults] = useState<SemanticResult[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [searchMode, setSearchMode] = useState<"filter" | "semantic">("filter");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  const [bpmFilter, setBpmFilter] = useState<string>("");
  const [keyFilter, setKeyFilter] = useState<string>("all");
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set(["__all__"]));

  useEffect(() => {
    if (!entries.length) loadEntries();
    if (!collections.length) loadCollections();
    // Load search status to know if CLAP is available
    apiClient.select.searchStatus().then(setSearchStatus).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load suggestions when suggest mode is active and an entry is selected
  useEffect(() => {
    if (!suggestMode || !selectedEntryId) { setSuggestions([]); return; }
    const excludeIds = cards.map(c => c.entryId);
    setLoadingSuggestions(true);
    apiClient.select.suggestNext(selectedEntryId, excludeIds, 15)
      .then(setSuggestions)
      .catch(console.error)
      .finally(() => setLoadingSuggestions(false));
  }, [suggestMode, selectedEntryId, cards.map(c=>c.entryId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Semantic search — debounced
  useEffect(() => {
    if (searchMode !== "semantic" || !semanticQuery.trim()) {
      setSemanticResults([]);
      return;
    }
    const tid = setTimeout(() => {
      setLoadingSuggestions(true);
      apiClient.select.semanticSearch(semanticQuery, 30)
        .then(r => setSemanticResults(r.filter(x => !cards.some(c => c.entryId === x.entry_id))))
        .catch(() => setSemanticResults([]))
        .finally(() => setLoadingSuggestions(false));
    }, 400);
    return () => clearTimeout(tid);
  }, [semanticQuery, searchMode, cards.map(c => c.entryId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const inSet = new Set(cards.map(c => c.entryId));

  // Available keys from library for filter dropdown
  const availableKeys = useMemo(() => {
    const keys = new Set<string>();
    entries.forEach(e => { if (e.key) keys.add(e.key); });
    return Array.from(keys).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(e =>
        (e.title ?? e.file_name).toLowerCase().includes(q) ||
        (e.artist ?? "").toLowerCase().includes(q)
      );
    }
    if (bpmFilter) {
      const bpm = parseFloat(bpmFilter);
      if (!isNaN(bpm)) list = list.filter(e => e.bpm != null && Math.abs(e.bpm - bpm) <= 5);
    }
    if (keyFilter !== "all") {
      list = list.filter(e => e.key === keyFilter);
    }
    return list;
  }, [entries, filter, bpmFilter, keyFilter]);

  function toggle(id: string) {
    setExpandedCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const handleScan = async () => {
    if (!catalogFolderPath) {
      setScanMessage("Import a folder in Select first");
      return;
    }
    const added = await scanFolder();
    setScanMessage(
      added > 0
        ? `${added} new track${added === 1 ? "" : "s"} — analyzing…`
        : "No new files found",
    );
    setTimeout(() => setScanMessage(null), 3500);
  };

  return (
    <aside style={{
      width: 230,
      minWidth: 230,
      background: "#1c1c1c",
      borderRight: "1px solid #2a2a2a",
      display: "flex",
      flexDirection: "column",
      padding: "10px 0",
      overflow: "hidden",
    }}>
      {/* Scan + search mode tabs */}
      <div style={{ padding: "0 10px 8px", display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning || !catalogFolderPath}
          title={catalogFolderPath ? `Scan ${catalogFolderPath} for new files` : "Import a folder in Select first"}
          style={{
            flex: 1,
            background: scanning ? "#222" : "#1e2e3e",
            border: "1px solid #2a4a6a",
            borderRadius: 4,
            padding: "6px 8px",
            color: scanning ? "#666" : "#5b9bd5",
            fontSize: 10,
            fontWeight: 700,
            cursor: scanning || !catalogFolderPath ? "default" : "pointer",
            opacity: catalogFolderPath ? 1 : 0.5,
          }}
        >
          {scanning ? "Scanning…" : isPolling ? "Scan · analyzing…" : "Scan for new files"}
        </button>
      </div>
      {scanMessage && (
        <p style={{ color: "#888", fontSize: 9, padding: "0 10px 6px", margin: 0, lineHeight: 1.4 }}>
          {scanMessage}
        </p>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid #1e1e1e", marginBottom: 8 }}>
        {(["filter", "semantic"] as const).map(m => (
          <button key={m} onClick={() => setSearchMode(m)} style={{
            flex: 1, background: "none", border: "none", padding: "7px 4px",
            borderBottom: searchMode === m ? "2px solid #00c3ff" : "2px solid transparent",
            color: searchMode === m ? "#00c3ff" : "#3a3a3a",
            fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em",
          }}>
            {m === "filter" ? "FILTER" : "AI SEARCH"}
          </button>
        ))}
      </div>

      {searchMode === "filter" ? (
        <>
          {/* Keyword search */}
          <div style={{ padding: "0 10px 6px" }}>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search library…"
              style={{
                width: "100%", background: "#111", border: "1px solid #333",
                borderRadius: 4, padding: "5px 8px", color: "#e6e6e6",
                fontSize: 12, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          {/* BPM + Key filters */}
          <div style={{ padding: "0 10px 8px", display: "flex", gap: 6 }}>
            <input
              value={bpmFilter} onChange={e => setBpmFilter(e.target.value)}
              placeholder="BPM ±5" type="number"
              style={{ flex: 1, background: "#111", border: "1px solid #333", borderRadius: 4, padding: "4px 6px", color: "#e6e6e6", fontSize: 11, outline: "none", minWidth: 0 }}
            />
            <select value={keyFilter} onChange={e => setKeyFilter(e.target.value)}
              style={{ flex: 1, background: "#111", border: "1px solid #333", borderRadius: 4, padding: "4px 4px", color: "#e6e6e6", fontSize: 11, outline: "none", minWidth: 0 }}>
              <option value="all">All Keys</option>
              {availableKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        </>
      ) : (
        /* Semantic / AI search */
        <div style={{ padding: "0 10px 8px" }}>
          <input
            value={semanticQuery}
            onChange={e => setSemanticQuery(e.target.value)}
            placeholder={searchStatus?.clap_available
              ? 'Describe the vibe: "uplifting summer house"...'
              : 'e.g. "dark peak-time 8B 128 BPM"...'}
            style={{
              width: "100%", background: "#111",
              border: `1px solid ${semanticQuery ? "#00c3ff44" : "#333"}`,
              borderRadius: 4, padding: "6px 8px", color: "#e6e6e6",
              fontSize: 11, outline: "none", boxSizing: "border-box",
            }}
          />
          {/* CLAP status badge */}
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: searchStatus?.clap_available ? "#4ade80" : "#facc15",
            }} />
            <span style={{ color: "#3a3a3a", fontSize: 9, lineHeight: 1.4 }}>
              {searchStatus?.clap_available
                ? `CLAP active · ${searchStatus.clap_embedded_tracks} tracks embedded${searchStatus.active_mode === "runpod_clap" ? " · GPU" : ""}`
                : searchStatus?.clap_embedded_tracks
                  ? `Indexing… ${searchStatus.clap_embedded_tracks}/201 embedded`
                  : "Metadata mode · embed tracks for AI search"}
            </span>
          </div>
        </div>
      )}

      {/* Suggest mode toggle */}
      {selectedEntryId && searchMode === "filter" && (
        <div style={{ padding: "0 10px 8px" }}>
          <button onClick={onSuggestMode} style={{
            width: "100%",
            background: suggestMode ? "rgba(0,195,255,0.15)" : "#111",
            border: `1px solid ${suggestMode ? "#00c3ff" : "#333"}`,
            borderRadius: 4, padding: "5px 8px",
            color: suggestMode ? "#00c3ff" : "#6a6a6a",
            fontSize: 11, cursor: "pointer", fontWeight: 600, transition: "all .15s",
          }}>
            {loadingSuggestions ? "Loading…" : suggestMode ? "✦ Showing suggestions" : "✦ Suggest compatible tracks"}
          </button>
        </div>
      )}

      <p style={{ padding: "0 10px", color: "#e6e6e6", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {searchMode === "semantic" && semanticQuery ? `Results (${semanticResults.length})` : suggestMode && selectedEntryId ? "Suggestions" : "Library"}
      </p>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {/* Semantic search results */}
        {searchMode === "semantic" && semanticQuery ? (
          loadingSuggestions ? (
            <div style={{ padding: "20px 10px", color: "#3a3a3a", fontSize: 11, textAlign: "center" }}>Searching…</div>
          ) : semanticResults.length === 0 ? (
            <div style={{ padding: "20px 10px", color: "#2a2a2a", fontSize: 11, textAlign: "center" }}>
              No matches. Try different keywords.
            </div>
          ) : semanticResults.map(r => (
            <SemanticRow key={r.entry_id} result={r} inSet={inSet.has(r.entry_id)} onAdd={() => addCard(r.entry_id)} />
          ))
        ) : suggestMode && suggestions.length > 0 ? (
          /* Suggestion list sorted by compatibility */
          suggestions.map(s => (
            <SuggestRow
              key={s.entry_id}
              suggestion={s}
              inSet={inSet.has(s.entry_id)}
              onAdd={() => addCard(s.entry_id)}
            />
          ))
        ) : (
          <>
            {/* All Music section */}
            <LibSection
              label={`Music Catalog (${filtered.length})`}
              expanded={expandedCols.has("__all__")}
              onToggle={() => toggle("__all__")}
            >
              {filtered.map(e => (
                <LibRow key={e.id} entry={e} inSet={inSet.has(e.id)} onAdd={() => addCard(e.id)} />
              ))}
            </LibSection>

            {/* Per-collection sections */}
            {collections.map(col => {
              const colEntries = filtered.filter(e => e.collection_ids.includes(col.id));
              if (!colEntries.length) return null;
              return (
                <LibSection
                  key={col.id}
                  label={col.name}
                  expanded={expandedCols.has(col.id)}
                  onToggle={() => toggle(col.id)}
                >
                  {colEntries.map(e => (
                    <LibRow key={e.id} entry={e} inSet={inSet.has(e.id)} onAdd={() => addCard(e.id)} />
                  ))}
                </LibSection>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

function LibSection({
  label, expanded, onToggle, children,
}: { label: string; expanded: boolean; onToggle: () => void; children: React.ReactNode; }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          background: "none", border: "none", padding: "3px 10px", cursor: "pointer",
          color: "#6a6a6a", fontSize: 12, fontWeight: 600, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 10, transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", display: "inline-block", transition: "transform .15s" }}>▼</span>
        {label}
      </button>
      {expanded && children}
    </div>
  );
}

function LibRow({ entry, inSet, onAdd }: { entry: CatalogEntry; inSet: boolean; onAdd: () => void; }) {
  return (
    <div
      onClick={onAdd}
      title={inSet ? "Already in set" : "Click to add to canvas"}
      style={{
        padding: "4px 10px 4px 22px", cursor: inSet ? "default" : "pointer",
        color: inSet ? "#4a4a4a" : "#ccc", fontSize: 12, fontWeight: 500,
        display: "flex", alignItems: "center", gap: 6, userSelect: "none",
        borderLeft: inSet ? "2px solid #00c3ff" : "2px solid transparent",
      }}
      onMouseEnter={e => { if (!inSet) (e.currentTarget as HTMLElement).style.background = "#252525"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {displayTitle(entry)}
      </span>
      {entry.bpm && <span style={{ color: "#4a4a4a", fontSize: 10, flexShrink: 0 }}>{Math.round(entry.bpm)}</span>}
      {inSet && <span style={{ fontSize: 10, color: "#00c3ff", flexShrink: 0 }}>✓</span>}
    </div>
  );
}

function SemanticRow({ result, inSet, onAdd }: { result: SemanticResult; inSet: boolean; onAdd: () => void; }) {
  const pct = Math.round(result.score * 100);
  const color = result.method === "clap" ? "#a78bfa" : compatColor(result.score);
  return (
    <div
      onClick={onAdd}
      style={{
        padding: "5px 10px", cursor: inSet ? "default" : "pointer",
        color: inSet ? "#4a4a4a" : "#ccc", fontSize: 12,
        display: "flex", alignItems: "center", gap: 8, userSelect: "none",
        borderLeft: inSet ? "2px solid #00c3ff" : "2px solid transparent",
        opacity: inSet ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!inSet) (e.currentTarget as HTMLElement).style.background = "#252525"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, color, flexShrink: 0,
        background: `${color}15`, border: `1px solid ${color}33`,
        borderRadius: 3, padding: "1px 4px",
      }}>{pct}%</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.title}</div>
        <div style={{ color: "#4a4a4a", fontSize: 9 }}>
          {result.bpm ? Math.round(result.bpm) + " BPM" : ""}
          {result.key ? " · " + camelot(result.key) : ""}
          {result.method === "clap" && <span style={{ color: "#a78bfa", marginLeft: 4 }}>✦ CLAP</span>}
        </div>
      </div>
      {inSet && <span style={{ fontSize: 9, color: "#00c3ff", flexShrink: 0 }}>✓</span>}
    </div>
  );
}

function SuggestRow({ suggestion, inSet, onAdd }: { suggestion: SuggestResult; inSet: boolean; onAdd: () => void; }) {
  const pct = Math.round(suggestion.overall * 100);
  const color = compatColor(suggestion.overall);
  return (
    <div
      onClick={onAdd}
      style={{
        padding: "5px 10px 5px 10px", cursor: inSet ? "default" : "pointer",
        color: inSet ? "#4a4a4a" : "#ccc", fontSize: 12,
        display: "flex", alignItems: "center", gap: 8, userSelect: "none",
        borderLeft: inSet ? "2px solid #00c3ff" : "2px solid transparent",
        opacity: inSet ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!inSet) (e.currentTarget as HTMLElement).style.background = "#252525"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* compatibility pill */}
      <span style={{
        fontSize: 10, fontWeight: 700, color, flexShrink: 0,
        background: `${color}18`, border: `1px solid ${color}44`,
        borderRadius: 3, padding: "1px 4px",
      }}>{pct}%</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {suggestion.title}
        </div>
        <div style={{ color: "#5a5a5a", fontSize: 10 }}>
          {suggestion.bpm ? Math.round(suggestion.bpm) + " BPM" : ""}
          {suggestion.key ? " · " + camelot(suggestion.key) : ""}
        </div>
      </div>
      {inSet && <span style={{ fontSize: 10, color: "#00c3ff", flexShrink: 0 }}>✓</span>}
    </div>
  );
}

// ─── SetTrackCard ─────────────────────────────────────────────────────────────

const CARD_W = 200;
const ARTWORK_SIZE = 190;
const CARD_CONTENT_H = 80;

function SetTrackCard({
  card, entry, selected, flow, onSelect, onMove, onRemove, disableDrag, onCanvasPan,
  onWireStart, isWireTarget, inputPortRef, outputPortRef,
}: {
  card: SetCard;
  entry: CatalogEntry;
  selected: boolean;
  flow?: FlowEdge | null;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onRemove: () => void;
  disableDrag?: boolean;
  onCanvasPan?: (e: React.PointerEvent) => void;
  onWireStart?: (cardId: string, e: React.PointerEvent) => void;
  isWireTarget?: boolean;
  inputPortRef?: (el: HTMLDivElement | null) => void;
  outputPortRef?: (el: HTMLDivElement | null) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; cardX: number; cardY: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (disableDrag) {
      onCanvasPan?.(e);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, cardX: card.x, cardY: card.y };
    onSelect();
  }, [card.x, card.y, onSelect, disableDrag, onCanvasPan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    onMove(
      dragState.current.cardX + (e.clientX - dragState.current.startX),
      dragState.current.cardY + (e.clientY - dragState.current.startY),
    );
  }, [onMove]);

  const onPointerUp = useCallback(() => { dragState.current = null; }, []);

  const artworkUrl = entry.has_artwork ? apiClient.select.artworkUrl(entry.id) : null;
  const title = displayTitle(entry);
  const flowColor = flow ? compatColor(flow.overall) : "transparent";

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={e => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute", left: card.x, top: card.y, width: CARD_W,
        cursor: "grab", userSelect: "none", zIndex: selected ? 10 : 1,
      }}
    >
      {/* artwork */}
      <div style={{
        width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: 8, overflow: "hidden",
        background: "#1a1a1a",
        border: selected ? "2px solid #00c3ff" : "2px solid transparent",
        boxShadow: selected ? "0 0 0 1px rgba(0,195,255,0.3)" : "0 4px 20px rgba(0,0,0,0.5)",
        transition: "border-color .15s, box-shadow .15s",
        position: "relative",
      }}>
        {artworkUrl ? (
          <img src={artworkUrl} alt="" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 40, opacity: 0.1 }}>♪</span>
          </div>
        )}

        {/* order badge */}
        <div style={{
          position: "absolute", top: 8, left: 8,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
          borderRadius: 12, padding: "2px 8px",
          fontSize: 11, fontWeight: 700, color: "#e6e6e6",
        }}>
          #{card.order + 1}
        </div>

        {/* remove */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="Remove from set (Delete)"
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.75)", border: "none", borderRadius: "50%",
            width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#afafaf", fontSize: 12,
            opacity: selected || hovered ? 1 : 0, transition: "opacity .15s",
          }}
        >
          ×
        </button>

        {/* flow compatibility indicator at bottom of card */}
        {flow && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
            background: flowColor, opacity: 0.8,
          }} />
        )}

        {/* Open in arrangement hint */}
        {selected && (
          <button
            onClick={e => {
              e.stopPropagation();
              const { setViewMode, selectTransition, cards } = useSetBuilderStore.getState();
              const sorted = [...cards].sort((a, b) => a.order - b.order);
              const pos = sorted.findIndex(c => c.id === card.id);
              if (pos >= 0 && pos < sorted.length - 1) selectTransition(pos);
              else if (pos > 0) selectTransition(pos - 1);
              setViewMode("arrangement");
            }}
            style={{
              position: "absolute", bottom: 8, right: 8,
              background: "rgba(0,0,0,0.8)", border: "1px solid #facc1555",
              borderRadius: 4, padding: "3px 7px", fontSize: 9, fontWeight: 700,
              color: "#facc15", cursor: "pointer",
            }}
          >
            ⊟ Edit transition
          </button>
        )}
      </div>

      {/* input port — drop wire here to play after another track */}
      <div
        ref={inputPortRef}
        title="Drop connection here"
        style={{
          position: "absolute", left: -7, top: ARTWORK_SIZE / 2 - 7,
          width: 14, height: 14, borderRadius: "50%",
          background: isWireTarget ? "#00c3ff" : "#2a2a2a",
          border: `2px solid ${isWireTarget ? "#00c3ff" : "#555"}`,
          boxShadow: isWireTarget ? "0 0 8px rgba(0,195,255,0.5)" : "none",
          transition: "all .12s", zIndex: 6, pointerEvents: "none",
        }}
      />

      {/* output port — drag to connect to another track */}
      <div
        ref={outputPortRef}
        onPointerDown={e => {
          e.stopPropagation();
          onWireStart?.(card.id, e);
        }}
        title="Drag to connect next track"
        style={{
          position: "absolute", left: ARTWORK_SIZE - 7, top: ARTWORK_SIZE / 2 - 7,
          width: 14, height: 14, borderRadius: "50%",
          background: hovered || selected ? "#666" : "#444",
          border: "2px solid #888",
          cursor: "crosshair", zIndex: 6,
        }}
      />

      {/* info below art */}
      <div style={{ paddingTop: 8, paddingLeft: 2 }}>
        <p style={{ color: "#fff", fontWeight: 700, fontSize: 13, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </p>
        <p style={{ color: "#6a6a6a", fontWeight: 500, fontSize: 11, margin: "2px 0 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {entry.artist || "—"}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {entry.bpm && <Chip label={`${Math.round(entry.bpm)} BPM`} />}
          {entry.key && <Chip label={camelot(entry.key)} color="#00c3ff" />}
          {entry.duration_seconds && <Chip label={fmtDuration(entry.duration_seconds)} />}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      background: "#1a1a1a", borderRadius: 3, padding: "1px 5px",
      fontSize: 10, color: color ?? "#5a5a5a", border: "1px solid #2a2a2a",
    }}>{label}</span>
  );
}

function parseArtists(artistStr: string | null | undefined): string[] {
  if (!artistStr?.trim()) return [];
  return artistStr
    .split(/,|\s+&\s+|\s+and\s+|\s+feat\.?\s+|\s+x\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function artistLibraryStats(name: string, entryMap: Map<string, CatalogEntry>, currentEntryId: string) {
  const needle = name.trim().toLowerCase();
  const tracks = [...entryMap.values()].filter(e => {
    const parts = parseArtists(e.artist);
    return parts.some(p => p.toLowerCase() === needle)
      || e.artist?.trim().toLowerCase() === needle;
  });

  const bpms = tracks.map(t => t.bpm).filter((v): v is number => v != null);
  const albums = [...new Set(tracks.map(t => t.album?.trim()).filter(Boolean))] as string[];
  const others = tracks
    .filter(t => t.id !== currentEntryId)
    .slice(0, 4)
    .map(t => displayTitle(t));

  return { trackCount: tracks.length, bpms, albums, others };
}

function ArtistTooltip({ name, entryMap, currentEntryId }: {
  name: string;
  entryMap: Map<string, CatalogEntry>;
  currentEntryId: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hovering, setHovering] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const stats = useMemo(
    () => artistLibraryStats(name, entryMap, currentEntryId),
    [name, entryMap, currentEntryId],
  );

  const bpmRange = stats.bpms.length
    ? stats.bpms.length === 1
      ? `${Math.round(stats.bpms[0])} BPM`
      : `${Math.round(Math.min(...stats.bpms))}–${Math.round(Math.max(...stats.bpms))} BPM`
    : null;

  return (
    <span
      ref={ref}
      onMouseEnter={() => {
        setHovering(true);
        if (!ref.current) return;
        const r = ref.current.getBoundingClientRect();
        setCoords({ x: Math.min(r.left, window.innerWidth - 248), y: r.bottom + 6 });
      }}
      onMouseLeave={() => {
        setHovering(false);
        setCoords(null);
      }}
      style={{
        color: hovering ? "#fff" : "#b0b0b0",
        cursor: "default",
        borderBottom: hovering ? "1px solid #aaa" : "none",
        transition: "color .12s, border-color .12s",
      }}
    >
      {name}
      {coords && createPortal(
        <div style={{
          position: "fixed",
          left: coords.x,
          top: coords.y,
          width: 240,
          background: "#2c2c2c",
          border: "1px solid #3a3a3a",
          borderRadius: 6,
          padding: "10px 12px",
          zIndex: 9999,
          pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          <p style={{ color: "#f0f0f0", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>{name}</p>
          <p style={{ color: "#999", fontSize: 10, lineHeight: 1.5, marginBottom: 4 }}>
            {stats.trackCount} track{stats.trackCount !== 1 ? "s" : ""} in your library
          </p>
          {bpmRange && (
            <p style={{ color: "#777", fontSize: 10, marginBottom: 4 }}>BPM range: {bpmRange}</p>
          )}
          {stats.albums.length > 0 && (
            <p style={{ color: "#777", fontSize: 10, marginBottom: 4 }}>
              Album{stats.albums.length !== 1 ? "s" : ""}: {stats.albums.slice(0, 2).join(", ")}
              {stats.albums.length > 2 ? ` +${stats.albums.length - 2} more` : ""}
            </p>
          )}
          {stats.others.length > 0 && (
            <p style={{ color: "#666", fontSize: 9, lineHeight: 1.45, marginTop: 4 }}>
              Also: {stats.others.join(" · ")}
            </p>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

function ArtistLine({ artist, entryMap, currentEntryId }: {
  artist: string | null | undefined;
  entryMap: Map<string, CatalogEntry>;
  currentEntryId: string;
}) {
  const names = parseArtists(artist);
  if (!names.length) return <span style={{ color: "#aaa" }}>—</span>;

  return (
    <p style={{ fontSize: 14, marginBottom: 8, lineHeight: 1.4 }}>
      {names.map((name, i) => (
        <React.Fragment key={`${name}-${i}`}>
          {i > 0 && <span style={{ color: "#888" }}>, </span>}
          <ArtistTooltip name={name} entryMap={entryMap} currentEntryId={currentEntryId} />
        </React.Fragment>
      ))}
    </p>
  );
}

// ─── ConnectionLines ──────────────────────────────────────────────────────────

function ConnectionLines({
  cards, flowEdges, selectedTransitionIndex, onSelectTransition,
}: {
  cards: SetCard[];
  flowEdges: FlowEdge[];
  selectedTransitionIndex: number | null;
  onSelectTransition: (index: number) => void;
}) {
  const sorted = [...cards].sort((a, b) => a.order - b.order);
  const edgeMap = new Map(flowEdges.map(e => [`${e.from_id}→${e.to_id}`, e]));

  const paths: React.ReactNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const edge = edgeMap.get(`${a.entryId}→${b.entryId}`);
    const ax = a.x + ARTWORK_SIZE;
    const ay = a.y + ARTWORK_SIZE / 2;
    const bx = b.x;
    const by = b.y + ARTWORK_SIZE / 2;
    const cx = (ax + bx) / 2;
    const strokeColor = edge ? compatColor(edge.overall) : "#3a3a3a";
    const selected = selectedTransitionIndex === i;
    const d = `M ${ax} ${ay} C ${cx} ${ay}, ${cx} ${by}, ${bx} ${by}`;

    paths.push(
      <g key={`${a.id}-${b.id}`}>
        <path
          d={d}
          stroke="transparent"
          strokeWidth={18}
          fill="none"
          style={{ cursor: "pointer", pointerEvents: "stroke" }}
          onClick={e => { e.stopPropagation(); onSelectTransition(i); }}
        />
        <circle cx={ax} cy={ay} r={selected ? 7 : 5} fill={strokeColor} opacity={selected ? 0.9 : 0.4} />
        <path
          d={d}
          stroke={strokeColor}
          strokeWidth={selected ? 2.5 : 1.5}
          fill="none"
          strokeLinecap="round"
          opacity={selected ? 0.95 : 0.5}
          style={{ pointerEvents: "none" }}
        />
        <circle cx={bx} cy={by} r={selected ? 7 : 5} fill={strokeColor} opacity={selected ? 0.9 : 0.4} />
      </g>
    );
  }

  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "auto", overflow: "visible" }}
      width="100%"
      height="100%"
      onClick={e => e.stopPropagation()}
    >
      {paths}
    </svg>
  );
}

// ─── AiPanel (persistent right sidebar) ──────────────────────────────────────

function AiPanel({
  cards, entryMap, selectedCard, selectedTransitionIndex, flowEdges, onAutoOrder, embedded,
  variant = "full", onClose,
}: {
  cards: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  selectedCard: SetCard | null;
  selectedTransitionIndex: number | null;
  flowEdges: FlowEdge[];
  onAutoOrder: () => void;
  embedded?: boolean;
  variant?: "full" | "track";
  onClose?: () => void;
}) {
  const sorted = useMemo(() => [...cards].sort((a, b) => a.order - b.order), [cards]);
  const selectedEntry = selectedCard ? entryMap.get(selectedCard.entryId) : null;
  const showingTransition = selectedTransitionIndex != null && sorted.length >= 2;
  const showingTrack = !!(selectedCard && selectedEntry) && !showingTransition;

  const totalDuration = useMemo(() => {
    return cards.reduce((s, c) => {
      const e = entryMap.get(c.entryId);
      return s + (e?.duration_seconds ?? 0);
    }, 0);
  }, [cards, entryMap]);

  const bpms = useMemo(() => {
    return cards.map(c => entryMap.get(c.entryId)?.bpm).filter((v): v is number => v != null);
  }, [cards, entryMap]);

  const avgFlow = useMemo(() => {
    if (!flowEdges.length) return null;
    const scored = flowEdges.filter(e => e.overall != null);
    if (!scored.length) return null;
    return scored.reduce((s, e) => s + (e.overall ?? 0), 0) / scored.length;
  }, [flowEdges]);

  if (variant === "track") {
    if (!selectedCard) return null;
    return (
      <aside style={{
        width: 300,
        minWidth: 300,
        flexShrink: 0,
        background: "#1a1a1a",
        borderLeft: "1px solid #2a2a2a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 12px",
          borderBottom: "1px solid #222",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "linear-gradient(135deg, rgba(0,195,255,0.08) 0%, transparent 70%)",
          flexShrink: 0,
        }}>
          <p style={{
            flex: 1,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.05em",
            background: "linear-gradient(to right, #62ffe8, #bcbcbc)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: 0,
          }}>
            Track Analysis
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              style={{
                background: "#222",
                border: "1px solid #333",
                borderRadius: 4,
                color: "#888",
                fontSize: 12,
                width: 24,
                height: 24,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >×</button>
          )}
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px" }}>
          <SelectedTab
            selectedEntry={selectedEntry}
            selectedCard={selectedCard}
            sorted={sorted}
            entryMap={entryMap}
            flowEdges={flowEdges}
            cards={cards}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside style={{
      ...(embedded ? { flex: 1, minHeight: 0 } : { width: 270, minWidth: 270, borderLeft: "1px solid #2a2a2a" }),
      background: "#1a1a1a",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Panel title */}
      <div style={{
        padding: "12px 14px 14px",
        borderBottom: "1px solid #222",
        background: "linear-gradient(135deg, rgba(0,195,255,0.06) 0%, transparent 60%)",
      }}>
        <p style={{
          fontWeight: 700, fontSize: 12, letterSpacing: "0.05em",
          background: "linear-gradient(to right, #62ffe8, #bcbcbc)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          margin: 0,
        }}>
          {showingTransition ? "Transition Analysis" : showingTrack ? "Track Analysis" : "AI Set Analysis"}
        </p>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px" }}>
        {showingTransition ? (
          <TransitionPanel
            transitionIndex={selectedTransitionIndex!}
            sorted={sorted}
            entryMap={entryMap}
            flowEdges={flowEdges}
          />
        ) : showingTrack ? (
          <SelectedTab
            selectedEntry={selectedEntry}
            selectedCard={selectedCard}
            sorted={sorted}
            entryMap={entryMap}
            flowEdges={flowEdges}
            cards={cards}
          />
        ) : (
          <SetHealthTab
            sorted={sorted}
            entryMap={entryMap}
            totalDuration={totalDuration}
            bpms={bpms}
            avgFlow={avgFlow}
            flowEdges={flowEdges}
            onAutoOrder={onAutoOrder}
          />
        )}
      </div>
    </aside>
  );
}

// ─── Health Tab ───────────────────────────────────────────────────────────────

function SetHealthTab({
  sorted, entryMap, totalDuration, bpms, avgFlow, flowEdges, onAutoOrder,
}: {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  totalDuration: number;
  bpms: number[];
  avgFlow: number | null;
  flowEdges: FlowEdge[];
  onAutoOrder: () => void;
}) {
  if (sorted.length === 0) {
    return (
      <div style={{ color: "#3a3a3a", fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
        <p>Add tracks from the library to start building your set.</p>
        <p style={{ marginTop: 8, color: "#2a2a2a" }}>
          The AI will score your set's harmonic flow, BPM arc, and transition quality in real-time.
        </p>
      </div>
    );
  }

  const bpmMin = bpms.length ? Math.min(...bpms) : null;
  const bpmMax = bpms.length ? Math.max(...bpms) : null;
  const bpmAvg = bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : null;

  const keys = sorted.map(c => entryMap.get(c.entryId)?.key).filter(Boolean) as string[];
  const keyMap = new Map<string, number>();
  keys.forEach(k => keyMap.set(k, (keyMap.get(k) ?? 0) + 1));

  const poorTransitions = flowEdges.filter(e => e.overall != null && e.overall < 0.5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Overview stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <StatBox label="Tracks" value={String(sorted.length)} />
        <StatBox label="Total Time" value={fmtDuration(totalDuration)} />
        {bpmAvg != null && <StatBox label="Avg BPM" value={Math.round(bpmAvg).toString()} />}
        {bpmMin != null && bpmMax != null && <StatBox label="BPM Range" value={`${Math.round(bpmMin)}–${Math.round(bpmMax)}`} />}
      </div>

      {/* Set flow score */}
      {avgFlow != null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ color: "#6a6a6a", fontSize: 11 }}>Flow Score</span>
            <span style={{ color: compatColor(avgFlow), fontWeight: 700, fontSize: 13 }}>
              {Math.round(avgFlow * 100)}% — {compatLabel(avgFlow)}
            </span>
          </div>
          <div style={{ height: 4, background: "#222", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${avgFlow * 100}%`, background: compatColor(avgFlow), borderRadius: 2, transition: "width .5s" }} />
          </div>
        </div>
      )}

      {/* BPM arc mini chart */}
      {bpms.length > 1 && (
        <div>
          <p style={{ color: "#6a6a6a", fontSize: 11, marginBottom: 6 }}>BPM Arc</p>
          <BpmArcChart bpms={sorted.map(c => entryMap.get(c.entryId)?.bpm ?? null)} />
        </div>
      )}

      {/* Warnings */}
      {poorTransitions.length > 0 && (
        <div style={{ background: "rgba(251,146,60,0.07)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 6, padding: "8px 10px" }}>
          <p style={{ color: "#fb923c", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            ⚠ {poorTransitions.length} difficult transition{poorTransitions.length > 1 ? "s" : ""}
          </p>
          <p style={{ color: "#6a6a6a", fontSize: 10, lineHeight: 1.5 }}>
            Go to "Flow" tab to see specific suggestions.
          </p>
        </div>
      )}

      {/* Key distribution */}
      {keyMap.size > 0 && (
        <div>
          <p style={{ color: "#6a6a6a", fontSize: 11, marginBottom: 6 }}>Key Distribution</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Array.from(keyMap.entries()).map(([k, n]) => (
              <span key={k} style={{
                background: "rgba(0,195,255,0.08)", border: "1px solid rgba(0,195,255,0.2)",
                borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "#00c3ff",
              }}>
                {camelot(k)} ×{n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Auto-order */}
      {sorted.length >= 3 && (
        <button
          onClick={onAutoOrder}
          title="Auto-order by compatibility"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "none", border: "none", padding: 0,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "#8a8a8a", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 11V3M4 6l3-3 3 3" stroke="#1a1a1a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span style={{ color: "#9a9a9a", fontSize: 11, fontWeight: 600 }}>
            Auto-order by compatibility
          </span>
        </button>
      )}

      {/* Export set */}
      {sorted.length > 0 && (
        <ExportButton sorted={sorted} entryMap={entryMap} />
      )}

      <div style={{ borderTop: "1px solid #222", paddingTop: 10 }}>
        <p style={{ color: "#3a3a3a", fontSize: 10, lineHeight: 1.6 }}>
          Scored via Camelot key distance · BPM closeness · LUFS alignment. Embedding-based audio similarity (MERT · CLAP) coming next.
        </p>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "#2a2a2a", borderRadius: 6,
      padding: "8px 10px", textAlign: "center",
    }}>
      <p style={{ color: "#4a4a4a", fontSize: 10, marginBottom: 2 }}>{label}</p>
      <p style={{ color: "#e6e6e6", fontSize: 15, fontWeight: 700 }}>{value}</p>
    </div>
  );
}

function BpmArcChart({ bpms }: { bpms: (number | null)[] }) {
  const values = bpms.map(b => b ?? 0);
  const min = Math.min(...values.filter(Boolean));
  const max = Math.max(...values.filter(Boolean));
  const range = max - min || 1;
  const w = 242;
  const h = 40;
  const pts = values.map((b, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((b - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="#00c3ff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      />
      {values.map((b, i) => {
        const x = (i / (values.length - 1)) * w;
        const y = h - ((b - min) / range) * (h - 4) - 2;
        return b ? (
          <circle key={i} cx={x} cy={y} r={2.5} fill="#00c3ff" opacity={0.8} />
        ) : null;
      })}
    </svg>
  );
}

function ExportButton({ sorted, entryMap }: { sorted: SetCard[]; entryMap: Map<string, CatalogEntry> }) {
  const [copied, setCopied] = useState(false);

  function exportSet() {
    const lines = sorted.map((c, i) => {
      const e = entryMap.get(c.entryId);
      if (!e) return "";
      const title = displayTitle(e);
      const artist = e.artist ?? "";
      const bpm = e.bpm ? Math.round(e.bpm).toString() : "?";
      const key = camelot(e.key);
      const dur = fmtDuration(e.duration_seconds);
      return `${i + 1}. ${artist ? artist + " – " : ""}${title} [${bpm} BPM · ${key} · ${dur}]`;
    }).filter(Boolean);
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={exportSet}
      style={{
        background: "transparent",
        border: "none",
        padding: "8px 0",
        color: copied ? "#4ade80" : "#6a6a6a",
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        transition: "color .15s", textAlign: "left",
      }}
    >
      {copied ? "✓ Copied to clipboard!" : "⬇ Export set list"}
    </button>
  );
}

// ─── Transitions Tab ──────────────────────────────────────────────────────────

function TransitionsTab({
  sorted, entryMap, flowEdges,
}: {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
}) {
  const edgeMap = new Map(flowEdges.map(e => [`${e.from_id}→${e.to_id}`, e]));

  if (sorted.length < 2) {
    return <p style={{ color: "#3a3a3a", fontSize: 12, marginTop: 8 }}>Add at least 2 tracks to see transition analysis.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sorted.slice(0, -1).map((card, i) => {
        const next = sorted[i + 1];
        const a = entryMap.get(card.entryId);
        const b = entryMap.get(next.entryId);
        const edge = edgeMap.get(`${card.entryId}→${next.entryId}`);
        return (
          <div key={`${card.id}-${next.id}`} style={{
            background: "#2a2a2a", borderRadius: 8, padding: "10px 12px",
          }}>
            {/* Track names */}
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>
              <span style={{ color: "#e6e6e6", fontWeight: 600 }}>#{i + 1} {a ? displayTitle(a) : "?"}</span>
              <span style={{ color: "#3a3a3a", margin: "0 6px" }}>→</span>
              <span style={{ color: "#e6e6e6", fontWeight: 600 }}>#{i + 2} {b ? displayTitle(b) : "?"}</span>
            </div>

            {/* Scores row */}
            {edge && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {edge.overall != null && (
                  <MetricChip label={compatLabel(edge.overall)} value={`${Math.round(edge.overall * 100)}%`} />
                )}
                {edge.bpm_delta != null && (
                  <MetricChip label="BPM Δ" value={`±${edge.bpm_delta.toFixed(0)}`} />
                )}
                {edge.key_compat != null && (
                  <MetricChip label="Harmonic" value={`${Math.round(edge.key_compat * 100)}%`} />
                )}
              </div>
            )}

            {/* Transition tip */}
            {edge && (
              <p style={{ color: "#fff", fontSize: 12, lineHeight: 1.5 }}>
                {transitionTip(edge)}
              </p>
            )}

            {!edge && (
              <p style={{ color: "#3a3a3a", fontSize: 10 }}>Awaiting analysis…</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      background: "#333", borderRadius: 4, padding: "3px 8px",
      fontSize: 11, fontWeight: 500,
    }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: "#fff", marginLeft: 4 }}>{value}</span>
    </span>
  );
}

// ─── Selected Tab ─────────────────────────────────────────────────────────────

function SelectedTab({
  selectedEntry, selectedCard, sorted, entryMap, flowEdges, cards,
}: {
  selectedEntry: CatalogEntry | null | undefined;
  selectedCard: SetCard | null;
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
  cards: SetCard[];
}) {
  const { addCard } = useSetBuilderStore();
  const [nextSuggestions, setNextSuggestions] = useState<SuggestResult[]>([]);
  const [loadingNext, setLoadingNext] = useState(false);
  const [djTransitions, setDjTransitions] = useState<TransitionResult[]>([]);
  const [proDjStatus, setProDjStatus] = useState<ProDjStatus | null>(null);
  const [tlFetching, setTlFetching] = useState(false);
  const [tlFetchStatus, setTlFetchStatus] = useState<TlFetchStatus>({ phase: "idle" });
  const [tlFetched, setTlFetched] = useState(false);
  const tlAutoFetchedRef = useRef<Set<string>>(new Set());
  const proTransitions = useMemo(
    () => djTransitions.filter(t => (t.pro_count ?? 0) > 0 || t.source === "1001tl"),
    [djTransitions],
  );
  const proInLibrary = useMemo(
    () => proTransitions.filter(t => t.in_library !== false && t.entry_id),
    [proTransitions],
  );
  const proNotInLibrary = useMemo(
    () => proTransitions.filter(t => t.in_library === false),
    [proTransitions],
  );

  useEffect(() => {
    apiClient.select.proDjStatus().then(setProDjStatus).catch(() => {});
  }, []);

  const reloadDjTransitions = useCallback(async () => {
    if (!selectedEntry) return [] as TransitionResult[];
    const excludeIds = cards.map(c => c.entryId);
    const t = await apiClient.select.getTransitions(selectedEntry.id, excludeIds, 5).catch(() => []);
    setDjTransitions(t);
    return t;
  }, [selectedEntry, cards]);

  const fetchProDjData = useCallback(async () => {
    if (!selectedEntry || tlFetching) return;
    setTlFetching(true);
    setTlFetchStatus({ phase: "searching" });
    try {
      await apiClient.select.fetch1001TL(selectedEntry.id);
      setTlFetched(true);
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const [t, status] = await Promise.all([
          reloadDjTransitions(),
          apiClient.select.tlFetchStatus(selectedEntry.id).catch(() => ({ phase: "idle" as const })),
        ]);
        setTlFetchStatus(status);
        if (t.some(x => (x.pro_count ?? 0) > 0)) break;
        if (status.phase === "done" && status.error) break;
        if (status.phase === "done") break;
      }
    } catch { /* ignore */ } finally {
      setTlFetching(false);
      setTlFetchStatus(prev => ({ ...prev, phase: "done" }));
    }
  }, [selectedEntry, tlFetching, reloadDjTransitions]);

  // Auto-load play-next + pro DJ transitions whenever a card is selected
  useEffect(() => {
    if (!selectedEntry) {
      setNextSuggestions([]);
      setDjTransitions([]);
      setTlFetched(false);
      return;
    }
    const excludeIds = cards.map(c => c.entryId);
    setLoadingNext(true);
    setTlFetched(false);

    Promise.all([
      apiClient.select.suggestNext(selectedEntry.id, excludeIds, 5),
      apiClient.select.getTransitions(selectedEntry.id, excludeIds, 5),
    ]).then(([suggestions, transitions]) => {
      setNextSuggestions(suggestions);
      setDjTransitions(transitions);
      const hasPro = transitions.some(t => (t.pro_count ?? 0) > 0);
      if (
        proDjStatus?.configured &&
        !hasPro &&
        !tlAutoFetchedRef.current.has(selectedEntry.id)
      ) {
        tlAutoFetchedRef.current.add(selectedEntry.id);
        fetchProDjData();
      }
    }).catch(() => {}).finally(() => setLoadingNext(false));
  }, [selectedEntry?.id, cards.map(c => c.entryId).join(","), proDjStatus?.configured]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = selectedCard ? sorted.findIndex(c => c.id === selectedCard.id) : -1;
  const prevCard = pos > 0 ? sorted[pos - 1] : null;
  const nextCard = pos >= 0 && pos < sorted.length - 1 ? sorted[pos + 1] : null;
  const nextEntry = nextCard ? entryMap.get(nextCard.entryId) : null;

  if (!selectedEntry || !selectedCard) {
    return <p style={{ color: "#3a3a3a", fontSize: 12, marginTop: 8 }}>Select a track on the timeline to see its analysis.</p>;
  }

  const prevEntry = prevCard ? entryMap.get(prevCard.entryId) : null;

  const inEdge = flowEdges.find(e => e.from_id === prevCard?.entryId && e.to_id === selectedCard.entryId);
  const outEdge = flowEdges.find(e => e.from_id === selectedCard.entryId && e.to_id === nextCard?.entryId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Track info */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{
          width: 68, height: 68, borderRadius: 6, overflow: "hidden",
          flexShrink: 0, background: "#2a2a2a",
        }}>
          {selectedEntry.has_artwork ? (
            <img
              src={apiClient.select.artworkUrl(selectedEntry.id)}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#444", fontSize: 18 }}>♪</span>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "#e6e6e6", fontWeight: 700, fontSize: 13, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            #{selectedCard.order + 1} {displayTitle(selectedEntry)}
          </p>
          <ArtistLine
            artist={selectedEntry.artist}
            entryMap={entryMap}
            currentEntryId={selectedEntry.id}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {selectedEntry.bpm && <Chip label={`${Math.round(selectedEntry.bpm)} BPM`} />}
            {selectedEntry.key && <Chip label={`${camelot(selectedEntry.key)}`} color="#00c3ff" />}
            {selectedEntry.duration_seconds && <Chip label={fmtDuration(selectedEntry.duration_seconds)} />}
            {selectedEntry.integrated_lufs != null && <Chip label={`${selectedEntry.integrated_lufs.toFixed(1)} LUFS`} />}
          </div>
        </div>
      </div>

      {/* Play next — algorithmic library matches */}
      <div style={{ marginTop: 8 }}>
        <p style={{ color: "#fff", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
          Play Next — Top 5 From Your Library
        </p>
        <p style={{ color: "#777", fontSize: 11, marginBottom: 10, lineHeight: 1.45 }}>
          State-of-the-art harmonic, tempo, and sonic analysis across your library — only tracks that mix well make the list.
        </p>

        {loadingNext ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ height: 50, background: "#2a2a2a", borderRadius: 6, opacity: 0.4 + i * 0.1 }} />
            ))}
          </div>
        ) : nextSuggestions.length === 0 ? (
          <p style={{ color: "#555", fontSize: 11 }}>No library tracks to suggest — import more music.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {nextSuggestions.map((s, i) => {
              const pct = Math.round(s.overall * 100);
              const inSet = cards.some(c => c.entryId === s.entry_id);
              return (
                <div
                  key={s.entry_id}
                  style={{
                    background: "#262626",
                    borderRadius: 6,
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: inSet ? 0.5 : 1,
                  }}
                >
                  <span style={{ color: "#666", fontSize: 10, fontWeight: 600, flexShrink: 0, width: 12 }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: "#e0e0e0", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
                      {s.title}
                    </p>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {s.bpm && <span style={{ color: "#888", fontSize: 11 }}>{Math.round(s.bpm)} BPM</span>}
                      {s.key && <span style={{ color: "#5b9bd5", fontSize: 11 }}>{camelot(s.key)}</span>}
                      {s.bpm_delta != null && (
                        <span style={{ color: "#888", fontSize: 11 }}>
                          ±{s.bpm_delta.toFixed(0)} BPM
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ color: "#aaa", fontWeight: 600, fontSize: 11 }}>{pct}%</span>
                    {!inSet && (
                      <button
                        onClick={() => addCard(s.entry_id)}
                        title="Add to set"
                        style={{
                          background: "#333", border: "1px solid #444",
                          borderRadius: 3, padding: "2px 6px",
                          color: "#bbb", fontSize: 9, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        + Add
                      </button>
                    )}
                    {inSet && <span style={{ color: "#5b9bd5", fontSize: 9 }}>In set</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* What pro DJs played next — 1001tracklists via Parse.bot */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <p style={{ color: "#fff", fontSize: 11, fontWeight: 600, margin: 0 }}>
            What Pro DJs Played Next
          </p>
          <FieldTooltip text="Real transitions from professional DJ sets on 1001tracklists — festival, club, and radio mixes worldwide. Powered by Parse.bot API. Tracks in your library are shown first; others appear as not imported." />
        </div>
        <p style={{ color: "#777", fontSize: 11, marginBottom: 10, lineHeight: 1.45 }}>
          What Tiësto, Solomun, and thousands of other DJs actually mixed after this track — from sets worldwide.
        </p>

        {!proDjStatus?.configured ? (
          <p style={{ color: "#888", fontSize: 10, lineHeight: 1.5, marginBottom: 8 }}>
            Add a free Parse API key to enable pro DJ data. In{" "}
            <code style={{ color: "#aaa", fontSize: 9 }}>apps/api/.env</code> set{" "}
            <code style={{ color: "#aaa", fontSize: 9 }}>PARSE_API_KEY=your_key</code> then restart the API.{" "}
            <a
              href={proDjStatus?.signup_url ?? "https://parse.bot/marketplace/ec03e43b-6798-40ce-86c9-02832adedc4c/1001tracklists-com-api"}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#5b9bd5" }}
            >
              Get free key →
            </a>
          </p>
        ) : tlFetching && proTransitions.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ height: 50, background: "#2a2a2a", borderRadius: 6, opacity: 0.5 }} />
            ))}
            <p style={{ color: "#666", fontSize: 10, marginTop: 4 }}>
              {tlFetchStatus.phase === "scanning" && tlFetchStatus.total
                ? `Scanning pro set ${tlFetchStatus.scanned ?? 0} of ${tlFetchStatus.total}…`
                : "Searching 1001tracklists…"}
            </p>
          </div>
        ) : proInLibrary.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {proInLibrary.map((t, i) => (
              <div key={t.entry_id!} style={{
                background: "#262626",
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ color: "#666", fontSize: 10, fontWeight: 600, flexShrink: 0, width: 12 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: "#e0e0e0", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.title}
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    {t.bpm && <span style={{ color: "#888", fontSize: 11 }}>{Math.round(t.bpm)} BPM</span>}
                    {t.key && <span style={{ color: "#5b9bd5", fontSize: 11 }}>{camelot(t.key)}</span>}
                    <span style={{ color: "#888", fontSize: 11 }}>
                      {t.pro_count ?? t.transition_count}× in pro sets
                    </span>
                  </div>
                </div>
                {t.entry_id && !cards.some(c => c.entryId === t.entry_id) && (
                  <button
                    onClick={() => addCard(t.entry_id!)}
                    style={{
                      background: "#333", border: "1px solid #444",
                      borderRadius: 3, padding: "2px 5px", color: "#bbb",
                      fontSize: 9, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                    }}
                  >+ Add</button>
                )}
              </div>
            ))}
          </div>
        ) : proNotInLibrary.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <p style={{ color: "#777", fontSize: 10, lineHeight: 1.45, marginBottom: 2 }}>
              Pro DJs played these next — not in your library yet:
            </p>
            {proNotInLibrary.map((t, i) => (
              <div key={`${t.title}-${i}`} style={{
                background: "#222",
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: 0.85,
              }}>
                <span style={{ color: "#555", fontSize: 10, fontWeight: 600, flexShrink: 0, width: 12 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: "#bbb", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.title}
                  </p>
                  <p style={{ color: "#666", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.artist || "Unknown artist"} · {t.pro_count ?? t.transition_count}× in pro sets
                  </p>
                </div>
                <span style={{ color: "#666", fontSize: 9, flexShrink: 0 }}>Not imported</span>
              </div>
            ))}
          </div>
        ) : tlFetchStatus.error === "no_matches" ? (
          <p style={{ color: "#555", fontSize: 10, lineHeight: 1.5, marginBottom: 8 }}>
            Found pro sets with this track, but none of the next tracks are in your library yet. Import more music or check the not-imported list after refresh.
          </p>
        ) : tlFetchStatus.error === "track_not_found" ? (
          <p style={{ color: "#555", fontSize: 10, lineHeight: 1.5, marginBottom: 8 }}>
            This track wasn't found on 1001tracklists yet — it may be too new.
          </p>
        ) : (
          <p style={{ color: "#555", fontSize: 10, lineHeight: 1.5, marginBottom: 8 }}>
            No pro data yet. Click below to search 1001tracklists for sets containing this track.
          </p>
        )}

        {proDjStatus?.configured && (
          <button
            type="button"
            onClick={() => fetchProDjData()}
            disabled={tlFetching || !selectedEntry}
            title="Search 1001tracklists for professional sets containing this track"
            style={{
              marginTop: proInLibrary.length > 0 ? 8 : 0,
              background: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? "rgba(91,155,213,0.12)" : "transparent",
              border: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? "1px solid rgba(91,155,213,0.35)" : "none",
              borderRadius: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? 5 : 0,
              padding: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? "6px 10px" : 0,
              color: tlFetching ? "#555" : "#5b9bd5",
              fontSize: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? 10 : 9,
              fontWeight: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? 600 : 500,
              cursor: tlFetching ? "default" : "pointer",
              textDecoration: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? "none" : "underline",
              textUnderlineOffset: 2,
              width: proInLibrary.length === 0 && proNotInLibrary.length === 0 ? "100%" : "auto",
            }}
          >
            {tlFetching
              ? (tlFetchStatus.phase === "scanning" && tlFetchStatus.total
                ? `Scanning ${tlFetchStatus.scanned ?? 0}/${tlFetchStatus.total}…`
                : "Searching…")
              : tlFetched || proTransitions.length > 0
                ? "Refresh pro DJ data"
                : "Search 1001tracklists"}
          </button>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid #1a1a1a" }} />

      {/* Transition into this track from the previous one in your set */}
      {prevEntry && (
        <div>
          <p style={{ color: "#888", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            Mixing In From #{pos} · {displayTitle(prevEntry)}
          </p>
          <p style={{ color: "#555", fontSize: 9, marginBottom: 6, lineHeight: 1.4 }}>
            How well the previous track in your set flows into this one.
          </p>
          {inEdge ? <EdgeDetail edge={inEdge} /> : <p style={{ color: "#555", fontSize: 10 }}>Scoring…</p>}
          {pos > 0 && (
            <button
              type="button"
              onClick={() => useSetBuilderStore.getState().selectTransition(pos - 1)}
              style={{
                marginTop: 10, width: "100%",
                background: "transparent", border: "1px solid #444",
                borderRadius: 5, padding: "7px 10px",
                color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
                textAlign: "left",
              }}
            >
              Insights →
            </button>
          )}
        </div>
      )}

      {/* Transition out to the next track in your set */}
      {nextEntry && (
        <div>
          <p style={{ color: "#888", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            Mixing Out To #{pos + 2} · {displayTitle(nextEntry)}
          </p>
          <p style={{ color: "#555", fontSize: 9, marginBottom: 6, lineHeight: 1.4 }}>
            How well this track flows into the next one already in your set.
          </p>
          {outEdge ? <EdgeDetail edge={outEdge} /> : <p style={{ color: "#555", fontSize: 10 }}>Scoring…</p>}

          {pos >= 0 && pos < sorted.length - 1 && (
            <button
              type="button"
              onClick={() => useSetBuilderStore.getState().selectTransition(pos)}
              style={{
                marginTop: 10, width: "100%",
                background: "transparent", border: "1px solid #444",
                borderRadius: 5, padding: "7px 10px",
                color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
                textAlign: "left",
              }}
            >
              Insights →
            </button>
          )}
        </div>
      )}

      {/* Lone track note */}
      {!prevEntry && !nextEntry && nextSuggestions.length > 0 && (
        <p style={{ color: "#2a2a2a", fontSize: 10, lineHeight: 1.5 }}>
          Add one of the suggestions above to see transition analysis.
        </p>
      )}
    </div>
  );
}

function EdgeDetail({ edge }: { edge: FlowEdge }) {
  return (
    <div style={{ background: "#2a2a2a", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {edge.overall != null && (
          <MetricChip label={compatLabel(edge.overall)} value={`${Math.round(edge.overall * 100)}%`} />
        )}
        {edge.bpm_delta != null && (
          <MetricChip label="BPM Δ" value={`±${edge.bpm_delta.toFixed(0)}`} />
        )}
        {edge.key_compat != null && (
          <MetricChip label="Harmonic" value={`${Math.round(edge.key_compat * 100)}%`} />
        )}
        {edge.lufs_delta != null && edge.lufs_delta > 2 && (
          <MetricChip label="Gain Δ" value={`${edge.lufs_delta.toFixed(1)} dB`} />
        )}
      </div>
      <p style={{ color: "#fff", fontSize: 12, lineHeight: 1.6 }}>{transitionTip(edge)}</p>
    </div>
  );
}

function formatStepAction(action: string): string {
  return action.replace(/_/g, " ");
}

function stepActionDetail(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes("high_pass")) {
    return "Roll off low frequencies on the outgoing track so the incoming mix has room to land.";
  }
  if (lower.includes("fade_in")) {
    return "Gradually bring the incoming track into the blend.";
  }
  if (lower.includes("bass_swap")) {
    return "Hand off sub-bass from the outgoing deck to the incoming track.";
  }
  if (lower.includes("remove")) {
    return "Fully remove the outgoing track from the mix.";
  }
  return `Perform ${formatStepAction(action)} at this point in the transition.`;
}

function TransitionPanel({
  transitionIndex, sorted, entryMap, flowEdges,
}: {
  transitionIndex: number;
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
}) {
  const fromCard = sorted[transitionIndex];
  const toCard = sorted[transitionIndex + 1];
  const fromEntry = fromCard ? entryMap.get(fromCard.entryId) : null;
  const toEntry = toCard ? entryMap.get(toCard.entryId) : null;
  const edge = fromEntry && toEntry
    ? flowEdges.find(e => e.from_id === fromEntry.id && e.to_id === toEntry.id)
    : null;

  const [transitionPlan, setTransitionPlan] = useState<TransitionPlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [genResult, setGenResult] = useState<GenerationResultData | null>(null);

  useEffect(() => {
    setSelectedStep(null);
    if (!fromEntry || !toEntry) { setTransitionPlan(null); return; }
    setPlanLoading(true);
    apiClient.select.planTransition(fromEntry.id, toEntry.id)
      .then(setTransitionPlan)
      .catch(() => setTransitionPlan(null))
      .finally(() => setPlanLoading(false));
  }, [fromEntry?.id, toEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!fromEntry || !toEntry) {
    return <p style={{ color: "#3a3a3a", fontSize: 12 }}>Transition not found.</p>;
  }

  const activeStep = selectedStep != null ? transitionPlan?.steps?.[selectedStep] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* A → B header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <TrackThumb entry={fromEntry} size={48} />
        <span style={{ color: "#444", fontSize: 14 }}>→</span>
        <TrackThumb entry={toEntry} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 14, margin: 0, lineHeight: 1.3 }}>
            #{transitionIndex + 1} {displayTitle(fromEntry)}
          </p>
          <p style={{ color: "#ccc", fontSize: 12, margin: "2px 0" }}>into</p>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 14, margin: 0, lineHeight: 1.3 }}>
            #{transitionIndex + 2} {displayTitle(toEntry)}
          </p>
        </div>
      </div>

      {edge ? <EdgeDetail edge={edge} /> : <p style={{ color: "#ccc", fontSize: 12 }}>Scoring…</p>}

      {/* Insights */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <p style={{ color: "#fff", fontSize: 13, fontWeight: 600, margin: 0 }}>
            Insights
          </p>
          <FieldTooltip text="Exact bar to blend, which EQ to move, when to swap bass — not just 'BPM matches.' Odeon listens to both tracks: Music Flamingo maps intros, outros, drops, and vocal timing; MOSS-Audio-8B turns that into step-by-step mix moves. Beat-sync can't catch a mid-drop clash or two vocals colliding — this does, because it reads the actual audio. Full AI runs on your RunPod GPU; without it, the same structure data drives rule-based planning." />
        </div>
        {planLoading ? (
          <p style={{ color: "#ccc", fontSize: 12 }}>Planning…</p>
        ) : transitionPlan?.steps ? (
          <div style={{ background: "#2a2a2a", borderRadius: 6, padding: "10px 12px" }}>
            <p style={{ color: "#fff", fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>{transitionPlan.reason}</p>
            <p style={{ color: "#ccc", fontSize: 11, marginBottom: 8 }}>
              {transitionPlan.strategy} · {transitionPlan.transition_length_bars} bars
            </p>
            {transitionPlan.steps.map((step, i) => {
              const active = selectedStep === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedStep(active ? null : i)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    fontSize: 12, color: "#fff", padding: "8px 4px",
                    border: "none",
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopStyle: "solid",
                    borderTopColor: "#333",
                    background: active ? "rgba(0,195,255,0.1)" : "transparent",
                    borderRadius: 4, cursor: "pointer",
                  }}
                >
                  Bar {step.bar}:{" "}
                  <span style={{ fontWeight: active ? 700 : 500 }}>
                    {formatStepAction(step.action)}
                  </span>
                  {step.freq_hz && <span style={{ color: "#ccc" }}> @ {step.freq_hz}Hz</span>}
                </button>
              );
            })}

            {activeStep && (
              <div style={{
                marginTop: 8, padding: "10px 12px",
                background: "#333", borderRadius: 5,
                border: "1px solid rgba(0,195,255,0.25)",
              }}>
                <p style={{ color: "#fff", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Bar {activeStep.bar} — {formatStepAction(activeStep.action)}
                </p>
                <p style={{ color: "#fff", fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                  {stepActionDetail(activeStep.action)}
                </p>
                {activeStep.freq_hz && (
                  <p style={{ color: "#ccc", fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                    Frequency: {activeStep.freq_hz} Hz
                  </p>
                )}
                {activeStep.duration_bars != null && (
                  <p style={{ color: "#ccc", fontSize: 11, marginTop: 4, marginBottom: 0 }}>
                    Duration: {activeStep.duration_bars} bar{activeStep.duration_bars !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={async () => {
                  const r = await apiClient.select.generateBridge(fromEntry.id, toEntry.id);
                  setGenResult(r);
                }}
                style={{ flex: 1, background: "transparent", border: "1px solid #555", borderRadius: 4, padding: "6px 8px", color: "#fff", fontSize: 11, cursor: "pointer" }}
              >Generate Bridge</button>
              <button
                onClick={async () => {
                  const r = await apiClient.select.generateRiser(fromEntry.id);
                  setGenResult(r);
                }}
                style={{ flex: 1, background: "transparent", border: "1px solid #555", borderRadius: 4, padding: "6px 8px", color: "#fff", fontSize: 11, cursor: "pointer" }}
              >Generate Riser</button>
            </div>
            {genResult?.job_id && (
              <audio controls src={apiClient.select.generatedAudioUrl(genResult.job_id)} style={{ width: "100%", marginTop: 8, height: 32 }} />
            )}
          </div>
        ) : (
          <p style={{ color: "#ccc", fontSize: 12 }}>RunPod required for transition planning.</p>
        )}
      </div>
    </div>
  );
}

function TrackThumb({ entry, size }: { entry: CatalogEntry; size: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 5, overflow: "hidden",
      flexShrink: 0, background: "#2a2a2a",
    }}>
      {entry.has_artwork ? (
        <img
          src={apiClient.select.artworkUrl(entry.id)}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#444", fontSize: size * 0.35 }}>♪</span>
        </div>
      )}
    </div>
  );
}

// ─── SetBuilderCanvas ─────────────────────────────────────────────────────────

const CANVAS_PAD = 1200;

interface WireDrag {
  fromCardId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function SetBuilderCanvas({
  flowEdges,
}: {
  flowEdges: FlowEdge[];
}) {
  const { cards, selectedCardId, selectedTransitionIndex, moveCard, removeCard, selectCard, selectTransition, connectAfter } = useSetBuilderStore();
  const entries = useSelectStore(s => s.entries);
  const entryMap = new Map(entries.map(e => [e.id, e]));
  const sorted = [...cards].sort((a, b) => a.order - b.order);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panTarget = useRef({ x: 0, y: 0 });
  const panCurrent = useRef({ x: 0, y: 0 });
  const panRaf = useRef(0);
  const dragPan = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panCursor, setPanCursor] = useState<"default" | "grab" | "grabbing">("default");
  const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);
  const [wireTargetId, setWireTargetId] = useState<string | null>(null);
  const inputPortRefs = useRef(new Map<string, HTMLDivElement>());
  const outputPortRefs = useRef(new Map<string, HTMLDivElement>());

  const contentW = Math.max(1200, cards.length ? Math.max(...cards.map(c => c.x + CARD_W + 60)) : 1200);
  const contentH = Math.max(700, cards.length ? Math.max(...cards.map(c => c.y + ARTWORK_SIZE + CARD_CONTENT_H + 60)) : 700);
  const worldW = contentW + CANVAS_PAD;
  const worldH = contentH + CANVAS_PAD;

  const applyTransform = useCallback(() => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${panCurrent.current.x}px, ${panCurrent.current.y}px, 0)`;
    }
  }, []);

  const startPanLoop = useCallback(() => {
    if (panRaf.current) return;
    const tick = () => {
      const dx = panTarget.current.x - panCurrent.current.x;
      const dy = panTarget.current.y - panCurrent.current.y;
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) {
        panCurrent.current = { ...panTarget.current };
        applyTransform();
        panRaf.current = 0;
        return;
      }
      panCurrent.current.x += dx * 0.2;
      panCurrent.current.y += dy * 0.2;
      applyTransform();
      panRaf.current = requestAnimationFrame(tick);
    };
    panRaf.current = requestAnimationFrame(tick);
  }, [applyTransform]);

  const nudgePan = useCallback((dx: number, dy: number) => {
    panTarget.current = {
      x: panTarget.current.x + dx,
      y: panTarget.current.y + dy,
    };
    startPanLoop();
  }, [startPanLoop]);

  // Cmd/Ctrl + wheel — capture phase so macOS webview doesn't eat it for zoom
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const rect = vp.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) return;

      e.preventDefault();
      e.stopPropagation();

      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 20
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? vp.clientHeight * 0.9
          : 1;

      nudgePan(e.deltaX * scale, e.deltaY * scale);
    };

    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", onWheel, { capture: true });
  }, [nudgePan]);

  // Space = hand tool; hold Space + drag to pan
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      setSpaceHeld(true);
      setPanCursor("grab");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
      dragPan.current = null;
      setPanCursor("default");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    applyTransform();
  }, [applyTransform, worldW, worldH]);

  useEffect(() => () => {
    if (panRaf.current) cancelAnimationFrame(panRaf.current);
  }, []);

  const portCenter = useCallback((el: HTMLDivElement | undefined, worldEl: HTMLDivElement | null) => {
    if (!el || !worldEl) return null;
    const r = el.getBoundingClientRect();
    const w = worldEl.getBoundingClientRect();
    return { x: r.left + r.width / 2 - w.left, y: r.top + r.height / 2 - w.top };
  }, []);

  const findInputPortAt = useCallback((clientX: number, clientY: number) => {
    for (const [cardId, el] of inputPortRefs.current) {
      const r = el.getBoundingClientRect();
      const pad = 10;
      if (
        clientX >= r.left - pad && clientX <= r.right + pad
        && clientY >= r.top - pad && clientY <= r.bottom + pad
      ) {
        return cardId;
      }
    }
    return null;
  }, []);

  const onWireStart = useCallback((cardId: string, e: React.PointerEvent) => {
    const out = outputPortRefs.current.get(cardId);
    const center = portCenter(out, worldRef.current);
    if (!center) return;
    setWireDrag({
      fromCardId: cardId,
      startX: center.x,
      startY: center.y,
      endX: center.x,
      endY: center.y,
    });
    const onMove = (ev: PointerEvent) => {
      const w = worldRef.current;
      if (!w) return;
      const wr = w.getBoundingClientRect();
      setWireDrag(prev => prev ? {
        ...prev,
        endX: ev.clientX - wr.left,
        endY: ev.clientY - wr.top,
      } : null);
      setWireTargetId(findInputPortAt(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => {
      const targetId = findInputPortAt(ev.clientX, ev.clientY);
      if (targetId && targetId !== cardId) connectAfter(cardId, targetId);
      setWireDrag(null);
      setWireTargetId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [connectAfter, findInputPortAt, portCenter]);

  const onViewportPointerDown = useCallback((e: React.PointerEvent) => {
    const handPan = spaceHeld || e.button === 1;
    if (!handPan) return;
    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    dragPan.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: panTarget.current.x,
      panY: panTarget.current.y,
    };
    setPanCursor("grabbing");
  }, [spaceHeld]);

  const onViewportPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragPan.current) return;
    panTarget.current = {
      x: dragPan.current.panX + (e.clientX - dragPan.current.startX),
      y: dragPan.current.panY + (e.clientY - dragPan.current.startY),
    };
    panCurrent.current = { ...panTarget.current };
    applyTransform();
  }, [applyTransform]);

  const onViewportPointerUp = useCallback(() => {
    dragPan.current = null;
    setPanCursor(spaceHeld ? "grab" : "default");
  }, [spaceHeld]);

  // Build edge map keyed on from→to for lookup at card level
  const edgeByTo = new Map(flowEdges.map(e => [e.to_id, e]));

  return (
    <div
      ref={viewportRef}
      onClick={() => { selectCard(null); selectTransition(null); }}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={onViewportPointerUp}
      onPointerCancel={onViewportPointerUp}
      onContextMenu={e => { if (spaceHeld) e.preventDefault(); }}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "#0e0e0e", minHeight: 0,
        touchAction: "none",
        cursor: panCursor,
      }}
    >
      {cards.length === 0 && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12, pointerEvents: "none", zIndex: 2,
        }}>
          <span style={{ fontSize: 64, opacity: 0.04 }}>⊿</span>
          <p style={{ color: "#2a2a2a", fontSize: 14 }}>Click tracks in the library to add them to your set</p>
          <p style={{ color: "#222", fontSize: 11 }}>Drag ● on a card to connect · ⌘+scroll or Space+drag to pan</p>
        </div>
      )}

      <div
        ref={worldRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: worldW,
          height: worldH,
          willChange: "transform",
        }}
      >
        <div style={{ position: "relative", width: contentW, height: contentH }}>
          <ConnectionLines
            cards={cards}
            flowEdges={flowEdges}
            selectedTransitionIndex={selectedTransitionIndex}
            onSelectTransition={selectTransition}
          />

          {wireDrag && (
            <svg
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 15, overflow: "visible" }}
            >
              <path
                d={`M ${wireDrag.startX} ${wireDrag.startY} C ${(wireDrag.startX + wireDrag.endX) / 2} ${wireDrag.startY}, ${(wireDrag.startX + wireDrag.endX) / 2} ${wireDrag.endY}, ${wireDrag.endX} ${wireDrag.endY}`}
                stroke="#00c3ff"
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                opacity={0.85}
              />
            </svg>
          )}

          {sorted.map((card) => {
            const entry = entryMap.get(card.entryId);
            if (!entry) return null;
            const flow = edgeByTo.get(card.entryId) ?? null;
            return (
              <SetTrackCard
                key={card.id}
                card={card}
                entry={entry}
                selected={card.id === selectedCardId}
                flow={flow}
                disableDrag={spaceHeld || !!wireDrag}
                isWireTarget={wireTargetId === card.id}
                inputPortRef={el => { if (el) inputPortRefs.current.set(card.id, el); else inputPortRefs.current.delete(card.id); }}
                outputPortRef={el => { if (el) outputPortRefs.current.set(card.id, el); else outputPortRefs.current.delete(card.id); }}
                onWireStart={onWireStart}
                onCanvasPan={onViewportPointerDown}
                onSelect={() => selectCard(card.id)}
                onMove={(x, y) => moveCard(card.id, x, y)}
                onRemove={() => removeCard(card.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ResearchView (entry point) ───────────────────────────────────────────────

export function ResearchView() {
  const {
    setName, setSetName, clearSet, cards, selectedCardId, timelineSelectedCardId, reorder,
    viewMode, setViewMode, selectedTransitionIndex, selectTransition, selectCard,
    selectTimelineCard, clearTimelinePositions, removeCard,
  } = useSetBuilderStore();
  const entries = useSelectStore(s => s.entries);
  const [editingName, setEditingName] = useState(false);
  const [suggestMode, setSuggestMode] = useState(false);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const [isAutoOrdering, setIsAutoOrdering] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const entryMap = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const sorted = useMemo(() => [...cards].sort((a, b) => a.order - b.order), [cards]);
  const selectedCard = cards.find(c => c.id === selectedCardId) ?? null;
  const timelineSelectedCard = cards.find(c => c.id === timelineSelectedCardId) ?? null;

  useLayoutEffect(() => {
    if (editingName) nameRef.current?.select();
  }, [editingName]);

  // Refresh flow edges + record transitions whenever card order changes
  useEffect(() => {
    if (sorted.length < 2) { setFlowEdges([]); return; }
    const ids = sorted.map(c => c.entryId);
    apiClient.select.setFlow(ids).then(setFlowEdges).catch(console.error);

    // Record every adjacent pair as a user transition (builds our proprietary graph)
    for (let i = 0; i < ids.length - 1; i++) {
      apiClient.select.recordTransition(ids[i], ids[i + 1]).catch(() => {});
    }
  }, [sorted.map(c => c.entryId).join("→")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-order: greedy compatibility sort from API
  const autoOrder = useCallback(async () => {
    if (cards.length < 2 || isAutoOrdering) return;
    setIsAutoOrdering(true);
    try {
      clearTimelinePositions();
      const orderedIds = await apiClient.select.autoOrder(cards.map(c => c.entryId));
      // Reorder cards by mapping entryId → new order index
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      for (const card of cards) {
        const newOrder = orderMap.get(card.entryId) ?? card.order;
        reorder(card.id, newOrder);
      }
    } catch (e) {
      console.error("auto-order failed", e);
    } finally {
      setIsAutoOrdering(false);
    }
  }, [cards, isAutoOrdering, reorder, clearTimelinePositions]);

  // Turn off suggest mode when selection clears
  useEffect(() => {
    if (!selectedCardId) setSuggestMode(false);
  }, [selectedCardId]);

  const activeTransitionIndex = selectedTransitionIndex ?? 0;

  // Close track analysis panel with Escape; Delete/Backspace removes selected node
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Escape") {
        if (viewMode === "nodes") {
          selectCard(null);
          selectTransition(null);
        }
        selectTimelineCard(null);
        return;
      }

      if (viewMode !== "nodes" || !selectedCardId || typing) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      removeCard(selectedCardId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, selectedCardId, removeCard, selectTimelineCard, selectCard, selectTransition]);

  // Clear timeline selection when leaving Studio view
  useEffect(() => {
    if (viewMode !== "arrangement") selectTimelineCard(null);
  }, [viewMode, selectTimelineCard]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0e0e0e" }}>
      {/* Top bar */}
      <div style={{
        height: 48, background: "#1c1c1c", borderBottom: "1px solid #2a2a2a",
        display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0,
      }}>
        {editingName ? (
          <input
            ref={nameRef}
            defaultValue={setName}
            onBlur={e => { setSetName(e.target.value || "New Set"); setEditingName(false); }}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={{
              background: "transparent", border: "none", borderBottom: "1px solid #00c3ff",
              color: "#fff", fontWeight: 700, fontSize: 15, outline: "none", minWidth: 200,
            }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            title="Click to rename set"
            style={{
              background: "none", border: "none", color: "#fff",
              fontWeight: 700, fontSize: 15, cursor: "text", padding: 0,
            }}
          >
            {setName}
          </button>
        )}

        {/* View mode toggle */}
        <div style={{
          display: "flex", background: "#111", borderRadius: 5, border: "1px solid #2a2a2a", overflow: "hidden",
        }}>
          {([
            { id: "nodes" as const, label: "⊞ Nodes" },
            { id: "arrangement" as const, label: "⊟ Studio" },
            { id: "booth" as const, label: "◎ Booth" },
          ]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => {
                setViewMode(id);
                if (id === "arrangement" && selectedTransitionIndex == null && sorted.length >= 2) {
                  const pos = selectedCard
                    ? sorted.findIndex(c => c.id === selectedCard.id)
                    : 0;
                  selectTransition(Math.min(Math.max(0, pos), sorted.length - 2));
                }
              }}
              style={{
                background: viewMode === id ? "rgba(0,195,255,0.15)" : "transparent",
                border: "none", padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                color: viewMode === id ? "#00c3ff" : "#555",
                letterSpacing: "0.03em",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        {cards.length > 0 && (
          <span style={{ color: "#4a4a4a", fontSize: 12 }}>
            {cards.length} track{cards.length !== 1 ? "s" : ""}
            {sorted.length > 0 && ` · ${fmtDuration(sorted.reduce((s, c) => s + (entryMap.get(c.entryId)?.duration_seconds ?? 0), 0))}`}
          </span>
        )}

        {cards.length >= 3 && (
          <button
            onClick={autoOrder}
            disabled={isAutoOrdering}
            style={{
              background: "rgba(0,195,255,0.1)", border: "1px solid rgba(0,195,255,0.3)",
              borderRadius: 4, color: "#00c3ff", fontSize: 11, padding: "4px 10px", cursor: "pointer",
              opacity: isAutoOrdering ? 0.5 : 1,
            }}
          >
            {isAutoOrdering ? "Ordering…" : "⟲ Auto-order"}
          </button>
        )}

        <button
          onClick={() => { clearSet(); setFlowEdges([]); setSuggestMode(false); }}
          style={{
            background: "none", border: "1px solid #333", borderRadius: 4,
            color: "#6a6a6a", fontSize: 12, padding: "4px 10px", cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LibrarySidebar
          suggestMode={suggestMode}
          selectedEntryId={selectedCard ? selectedCard.entryId : null}
          onSuggestMode={() => setSuggestMode(v => !v)}
        />

        {viewMode === "nodes" ? (
          <SetBuilderCanvas flowEdges={flowEdges} />
        ) : viewMode === "booth" && sorted.length >= 2 ? (
          <BoothPanel sorted={sorted} entryMap={entryMap} />
        ) : sorted.length >= 2 ? (
          <StudioWithBoothPanel
            sorted={sorted}
            entryMap={entryMap}
            flowEdges={flowEdges}
            transitionIndex={Math.min(activeTransitionIndex, sorted.length - 2)}
            onSelectTransition={selectTransition}
          />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
            Add tracks to your set, then switch to Studio or Booth view
          </div>
        )}

        {viewMode === "arrangement" && timelineSelectedCard && (
          <AiPanel
            variant="track"
            cards={cards}
            entryMap={entryMap}
            selectedCard={timelineSelectedCard}
            selectedTransitionIndex={selectedTransitionIndex}
            flowEdges={flowEdges}
            onAutoOrder={autoOrder}
            onClose={() => selectTimelineCard(null)}
          />
        )}

        <ResizableRightSidebar>
          {viewMode === "arrangement" && sorted.length >= 2 ? (
            <SetSequencePanel
              sorted={sorted}
              entryMap={entryMap}
              transitionIndex={Math.min(activeTransitionIndex, sorted.length - 2)}
              onSelectTransition={selectTransition}
            />
          ) : (
            <AiPanel
              cards={cards}
              entryMap={entryMap}
              selectedCard={selectedCard}
              selectedTransitionIndex={selectedTransitionIndex}
              flowEdges={flowEdges}
              onAutoOrder={autoOrder}
              embedded
            />
          )}
        </ResizableRightSidebar>
      </div>
    </div>
  );
}
