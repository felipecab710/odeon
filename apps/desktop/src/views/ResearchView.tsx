import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelectStore } from "../stores/selectStore";
import { useSetBuilderStore, type SetCard } from "../stores/setBuilderStore";
import type { CatalogEntry } from "@odeon/shared";
import {
  apiClient,
  type SuggestResult,
  type FlowEdge,
  type SemanticResult,
  type TransitionResult,
  type SearchStatus,
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
  const { entries, collections, filter, setFilter, loadEntries, loadCollections } =
    useSelectStore();
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
      {/* Search mode tabs */}
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
              ? 'Describe the vibe: "dark minimal 126 BPM"...'
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
                ? `CLAP active · ${searchStatus.clap_embedded_tracks} tracks embedded`
                : "Metadata mode · install laion-clap for full AI search"}
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
  card, entry, selected, flow, onSelect, onMove, onRemove,
}: {
  card: SetCard;
  entry: CatalogEntry;
  selected: boolean;
  flow?: FlowEdge | null;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onRemove: () => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; cardX: number; cardY: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, cardX: card.x, cardY: card.y };
    onSelect();
  }, [card.x, card.y, onSelect]);

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
          onClick={onRemove}
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.75)", border: "none", borderRadius: "50%",
            width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#afafaf", fontSize: 12,
            opacity: selected ? 1 : 0, transition: "opacity .15s",
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
      </div>

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

// ─── ConnectionLines ──────────────────────────────────────────────────────────

function ConnectionLines({ cards, flowEdges }: { cards: SetCard[]; flowEdges: FlowEdge[] }) {
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

    paths.push(
      <g key={`${a.id}-${b.id}`}>
        <circle cx={ax} cy={ay} r={5} fill={strokeColor} opacity={0.4} />
        <path
          d={`M ${ax} ${ay} C ${cx} ${ay}, ${cx} ${by}, ${bx} ${by}`}
          stroke={strokeColor}
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          opacity={0.5}
        />
      </g>
    );
  }

  return (
    <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} width="100%" height="100%">
      {paths}
    </svg>
  );
}

// ─── AiPanel (persistent right sidebar) ──────────────────────────────────────

type AiTab = "health" | "transitions" | "selected";

function AiPanel({
  cards, entryMap, selectedCard, flowEdges, onAutoOrder,
}: {
  cards: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  selectedCard: SetCard | null;
  flowEdges: FlowEdge[];
  onAutoOrder: () => void;
}) {
  const [tab, setTab] = useState<AiTab>("health");
  const sorted = useMemo(() => [...cards].sort((a, b) => a.order - b.order), [cards]);
  const selectedEntry = selectedCard ? entryMap.get(selectedCard.entryId) : null;

  // Auto-switch tab when a card is selected
  useEffect(() => {
    if (selectedCard) setTab("selected");
  }, [selectedCard?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function TabButton({ id, label }: { id: AiTab; label: string }) {
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          flex: 1, background: "none", border: "none", borderBottom: tab === id ? "2px solid #00c3ff" : "2px solid transparent",
          color: tab === id ? "#00c3ff" : "#555", fontSize: 11, fontWeight: 600, padding: "6px 4px",
          cursor: "pointer", transition: "all .15s",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <aside style={{
      width: 270, minWidth: 270,
      background: "#1a1a1a",
      borderLeft: "1px solid #2a2a2a",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Panel title */}
      <div style={{
        padding: "12px 14px 0",
        background: "linear-gradient(135deg, rgba(0,195,255,0.06) 0%, transparent 60%)",
      }}>
        <p style={{
          fontWeight: 700, fontSize: 12, letterSpacing: "0.05em",
          background: "linear-gradient(to right, #62ffe8, #bcbcbc)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: 10,
        }}>
          AI SET ANALYSIS
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #222", marginBottom: 0 }}>
          <TabButton id="health" label="Health" />
          <TabButton id="transitions" label="Flow" />
          <TabButton id="selected" label="Selected" />
        </div>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px" }}>
        {tab === "health" && (
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

        {tab === "transitions" && (
          <TransitionsTab sorted={sorted} entryMap={entryMap} flowEdges={flowEdges} />
        )}

        {tab === "selected" && (
          <SelectedTab
            selectedEntry={selectedEntry}
            selectedCard={selectedCard}
            sorted={sorted}
            entryMap={entryMap}
            flowEdges={flowEdges}
            cards={cards}
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
          style={{
            background: "rgba(0,195,255,0.1)", border: "1px solid rgba(0,195,255,0.3)",
            borderRadius: 6, padding: "8px 12px", color: "#00c3ff", fontSize: 11, fontWeight: 600,
            cursor: "pointer", transition: "all .15s", textAlign: "center",
          }}
        >
          ⟲ Auto-order by compatibility
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
      background: "#111", border: "1px solid #222", borderRadius: 6,
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
        background: copied ? "rgba(74,222,128,0.1)" : "#111",
        border: `1px solid ${copied ? "#4ade80" : "#333"}`,
        borderRadius: 6, padding: "8px 12px",
        color: copied ? "#4ade80" : "#6a6a6a",
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        transition: "all .15s", textAlign: "center",
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
        const color = compatColor(edge?.overall);

        return (
          <div key={`${card.id}-${next.id}`} style={{
            background: "#111", border: `1px solid ${color}33`,
            borderRadius: 8, padding: "10px 12px",
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
                  <ScorePill label={compatLabel(edge.overall)} value={`${Math.round(edge.overall * 100)}%`} color={color} />
                )}
                {edge.bpm_delta != null && (
                  <ScorePill label="BPM" value={`±${edge.bpm_delta.toFixed(0)}`} color={edge.bpm_delta <= 4 ? "#4ade80" : edge.bpm_delta <= 10 ? "#facc15" : "#f87171"} />
                )}
                {edge.key_compat != null && (
                  <ScorePill label="Key" value={`${camelot(edge.from_key)}→${camelot(edge.to_key)}`} color={compatColor(edge.key_compat)} />
                )}
              </div>
            )}

            {/* Transition tip */}
            {edge && (
              <p style={{ color: "#555", fontSize: 10, lineHeight: 1.5 }}>
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

function ScorePill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{
      background: `${color}12`, border: `1px solid ${color}33`,
      borderRadius: 4, padding: "2px 6px",
      fontSize: 10, color, fontWeight: 600,
    }}>{label}: {value}</span>
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
  const [tlFetching, setTlFetching] = useState(false);
  const [tlFetched, setTlFetched] = useState(false);

  // Auto-load 5 "play next" suggestions whenever a card is selected
  useEffect(() => {
    if (!selectedEntry) { setNextSuggestions([]); setDjTransitions([]); setTlFetched(false); return; }
    const excludeIds = cards.map(c => c.entryId);
    setLoadingNext(true);
    Promise.all([
      apiClient.select.suggestNext(selectedEntry.id, excludeIds, 5),
      apiClient.select.getTransitions(selectedEntry.id, excludeIds, 5),
    ]).then(([suggestions, transitions]) => {
      setNextSuggestions(suggestions);
      setDjTransitions(transitions);
    }).catch(() => {}).finally(() => setLoadingNext(false));
  }, [selectedEntry?.id, cards.map(c => c.entryId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedEntry || !selectedCard) {
    return <p style={{ color: "#3a3a3a", fontSize: 12, marginTop: 8 }}>Click a card on the canvas to see its analysis.</p>;
  }

  const pos = sorted.findIndex(c => c.id === selectedCard.id);
  const prevCard = pos > 0 ? sorted[pos - 1] : null;
  const nextCard = pos < sorted.length - 1 ? sorted[pos + 1] : null;
  const prevEntry = prevCard ? entryMap.get(prevCard.entryId) : null;
  const nextEntry = nextCard ? entryMap.get(nextCard.entryId) : null;

  const inEdge = flowEdges.find(e => e.from_id === prevCard?.entryId && e.to_id === selectedCard.entryId);
  const outEdge = flowEdges.find(e => e.from_id === selectedCard.entryId && e.to_id === nextCard?.entryId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Track info */}
      <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: "10px 12px" }}>
        <p style={{ color: "#e6e6e6", fontWeight: 700, fontSize: 13, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          #{selectedCard.order + 1} {displayTitle(selectedEntry)}
        </p>
        <p style={{ color: "#5a5a5a", fontSize: 11, marginBottom: 8 }}>{selectedEntry.artist || "—"}</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {selectedEntry.bpm && <Chip label={`${Math.round(selectedEntry.bpm)} BPM`} />}
          {selectedEntry.key && <Chip label={`${camelot(selectedEntry.key)}`} color="#00c3ff" />}
          {selectedEntry.duration_seconds && <Chip label={fmtDuration(selectedEntry.duration_seconds)} />}
          {selectedEntry.integrated_lufs != null && <Chip label={`${selectedEntry.integrated_lufs.toFixed(1)} LUFS`} />}
        </div>
      </div>

      {/* ── 5 "Play next" suggestions — the core DJ question ─────────────────── */}
      <div>
        <p style={{ color: "#4a4a4a", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", marginBottom: 8 }}>
          PLAY NEXT — TOP 5 FROM YOUR LIBRARY
        </p>

        {loadingNext ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ height: 50, background: "#111", borderRadius: 6, opacity: 0.4 + i * 0.1 }} />
            ))}
          </div>
        ) : nextSuggestions.length === 0 ? (
          <p style={{ color: "#2a2a2a", fontSize: 11 }}>No library tracks to suggest — import more music.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nextSuggestions.map((s, i) => {
              const color = compatColor(s.overall);
              const pct = Math.round(s.overall * 100);
              const inSet = cards.some(c => c.entryId === s.entry_id);
              return (
                <div
                  key={s.entry_id}
                  style={{
                    background: "#0e0e0e",
                    border: `1px solid ${color}28`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: inSet ? 0.45 : 1,
                  }}
                >
                  {/* rank */}
                  <span style={{ color: "#2a2a2a", fontSize: 10, fontWeight: 800, flexShrink: 0, width: 10 }}>
                    {i + 1}
                  </span>

                  {/* track info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: "#d0d0d0", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
                      {s.title}
                    </p>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                      {s.bpm && <span style={{ color: "#4a4a4a", fontSize: 9 }}>{Math.round(s.bpm)} BPM</span>}
                      {s.key && <span style={{ color: "#00c3ff", fontSize: 9, opacity: 0.7 }}>{camelot(s.key)}</span>}
                      {s.bpm_delta != null && (
                        <span style={{ color: s.bpm_delta <= 4 ? "#4ade80" : s.bpm_delta <= 10 ? "#facc15" : "#f87171", fontSize: 9 }}>
                          ±{s.bpm_delta.toFixed(0)} BPM
                        </span>
                      )}
                    </div>
                  </div>

                  {/* score + add */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{ color, fontWeight: 800, fontSize: 12 }}>{pct}%</span>
                    {!inSet && (
                      <button
                        onClick={() => addCard(s.entry_id)}
                        title="Add to set"
                        style={{
                          background: `${color}18`, border: `1px solid ${color}44`,
                          borderRadius: 3, padding: "2px 6px",
                          color, fontSize: 9, fontWeight: 700, cursor: "pointer",
                        }}
                      >
                        + Add
                      </button>
                    )}
                    {inSet && <span style={{ color: "#00c3ff", fontSize: 9 }}>✓ in set</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: "#2a2a2a", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
          Ranked by key harmony · BPM proximity · loudness match.
        </p>
      </div>

      {/* ── Real DJ Transition Graph ─────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <p style={{ color: "#4a4a4a", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em" }}>
            DJ TRANSITION DATA
          </p>
          <button
            onClick={async () => {
              if (!selectedEntry || tlFetching) return;
              setTlFetching(true);
              try {
                await apiClient.select.fetch1001TL(selectedEntry.id);
                setTlFetched(true);
                // Reload after a delay
                setTimeout(async () => {
                  const t = await apiClient.select.getTransitions(selectedEntry.id, cards.map(c => c.entryId), 5).catch(() => []);
                  setDjTransitions(t);
                  setTlFetching(false);
                }, 8000);
              } catch { setTlFetching(false); }
            }}
            disabled={tlFetching || !selectedEntry}
            title="Fetch from 1001tracklists.com — finds DJ sets containing this track and learns what was played next"
            style={{
              background: tlFetched ? "rgba(74,222,128,0.1)" : "#111",
              border: `1px solid ${tlFetched ? "#4ade80" : "#2a2a2a"}`,
              borderRadius: 4, padding: "3px 8px",
              color: tlFetching ? "#3a3a3a" : tlFetched ? "#4ade80" : "#555",
              fontSize: 9, fontWeight: 700, cursor: tlFetching ? "default" : "pointer",
            }}
          >
            {tlFetching ? "Fetching…" : tlFetched ? "✓ Fetched" : "Fetch 1001TL"}
          </button>
        </div>

        {djTransitions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {djTransitions.map((t, i) => (
              <div key={t.entry_id} style={{
                background: "#0a0a0a",
                border: "1px solid #1a1a1a",
                borderLeft: "3px solid #a78bfa",
                borderRadius: 5, padding: "6px 8px",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ color: "#2a2a2a", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: "#c0c0c0", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.title}
                  </p>
                  <div style={{ display: "flex", gap: 4 }}>
                    {t.bpm && <span style={{ color: "#3a3a3a", fontSize: 9 }}>{Math.round(t.bpm)} BPM</span>}
                    {t.key && <span style={{ color: "#00c3ff", fontSize: 9, opacity: 0.6 }}>{camelot(t.key)}</span>}
                    <span style={{ color: "#a78bfa", fontSize: 9 }}>
                      {t.transition_count}× {t.source === "1001tl" ? "1001TL" : "you"}
                    </span>
                  </div>
                </div>
                {!cards.some(c => c.entryId === t.entry_id) && (
                  <button
                    onClick={() => addCard(t.entry_id)}
                    style={{
                      background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)",
                      borderRadius: 3, padding: "2px 5px", color: "#a78bfa",
                      fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    }}
                  >+ Add</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 6, padding: "10px 12px" }}>
            <p style={{ color: "#2a2a2a", fontSize: 10, lineHeight: 1.6 }}>
              No DJ transition data yet for this track.
            </p>
            <p style={{ color: "#1e1e1e", fontSize: 9, marginTop: 4, lineHeight: 1.5 }}>
              Click "Fetch 1001TL" to search what professional DJs played after this track in their sets. Every transition you make in Odeon is also recorded automatically.
            </p>
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid #1a1a1a" }} />

      {/* Transition IN */}
      {prevEntry && (
        <div>
          <p style={{ color: "#4a4a4a", fontSize: 10, fontWeight: 600, marginBottom: 6, letterSpacing: "0.05em" }}>
            ← FROM #{pos} {displayTitle(prevEntry).slice(0, 22)}…
          </p>
          {inEdge ? <EdgeDetail edge={inEdge} /> : <p style={{ color: "#2a2a2a", fontSize: 10 }}>Scoring…</p>}
        </div>
      )}

      {/* Transition OUT */}
      {nextEntry && (
        <div>
          <p style={{ color: "#4a4a4a", fontSize: 10, fontWeight: 600, marginBottom: 6, letterSpacing: "0.05em" }}>
            → TO #{pos + 2} {displayTitle(nextEntry).slice(0, 22)}…
          </p>
          {outEdge ? <EdgeDetail edge={outEdge} /> : <p style={{ color: "#2a2a2a", fontSize: 10 }}>Scoring…</p>}
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
  const color = compatColor(edge.overall);
  return (
    <div style={{ background: "#111", border: `1px solid ${color}33`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {edge.overall != null && (
          <ScorePill label={compatLabel(edge.overall)} value={`${Math.round(edge.overall * 100)}%`} color={color} />
        )}
        {edge.bpm_delta != null && (
          <ScorePill label="BPM Δ" value={`±${edge.bpm_delta.toFixed(0)}`} color={edge.bpm_delta <= 4 ? "#4ade80" : edge.bpm_delta <= 10 ? "#facc15" : "#f87171"} />
        )}
        {edge.key_compat != null && (
          <ScorePill label="Harmonic" value={`${Math.round(edge.key_compat * 100)}%`} color={compatColor(edge.key_compat)} />
        )}
        {edge.lufs_delta != null && edge.lufs_delta > 2 && (
          <ScorePill label="Gain Δ" value={`${edge.lufs_delta.toFixed(1)} dB`} color={edge.lufs_delta < 4 ? "#facc15" : "#f87171"} />
        )}
      </div>
      <p style={{ color: "#555", fontSize: 10, lineHeight: 1.6 }}>{transitionTip(edge)}</p>
    </div>
  );
}

// ─── SetBuilderCanvas ─────────────────────────────────────────────────────────

function SetBuilderCanvas({
  flowEdges,
}: {
  flowEdges: FlowEdge[];
}) {
  const { cards, selectedCardId, moveCard, removeCard, selectCard } = useSetBuilderStore();
  const entries = useSelectStore(s => s.entries);
  const entryMap = new Map(entries.map(e => [e.id, e]));
  const sorted = [...cards].sort((a, b) => a.order - b.order);

  // Build edge map keyed on from→to for lookup at card level
  const edgeByTo = new Map(flowEdges.map(e => [e.to_id, e]));

  return (
    <div
      onClick={() => selectCard(null)}
      style={{
        flex: 1, position: "relative", overflow: "auto",
        background: "#0e0e0e", minHeight: 0,
      }}
    >
      {cards.length === 0 && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12, pointerEvents: "none",
        }}>
          <span style={{ fontSize: 64, opacity: 0.04 }}>⊿</span>
          <p style={{ color: "#2a2a2a", fontSize: 14 }}>Click tracks in the library to add them to your set</p>
        </div>
      )}

      <div style={{
        position: "relative",
        width: Math.max(1200, ...cards.map(c => c.x + CARD_W + 60)),
        height: Math.max(700, ...cards.map(c => c.y + ARTWORK_SIZE + CARD_CONTENT_H + 60)),
      }}>
        <ConnectionLines cards={cards} flowEdges={flowEdges} />

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
              onSelect={() => selectCard(card.id)}
              onMove={(x, y) => moveCard(card.id, x, y)}
              onRemove={() => removeCard(card.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── ResearchView (entry point) ───────────────────────────────────────────────

export function ResearchView() {
  const { setName, setSetName, clearSet, cards, selectedCardId, reorder } = useSetBuilderStore();
  const entries = useSelectStore(s => s.entries);
  const [editingName, setEditingName] = useState(false);
  const [suggestMode, setSuggestMode] = useState(false);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);
  const [isAutoOrdering, setIsAutoOrdering] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const entryMap = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const sorted = useMemo(() => [...cards].sort((a, b) => a.order - b.order), [cards]);
  const selectedCard = cards.find(c => c.id === selectedCardId) ?? null;

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
  }, [sorted.map(c => c.entryId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-order: greedy compatibility sort from API
  const autoOrder = useCallback(async () => {
    if (cards.length < 2 || isAutoOrdering) return;
    setIsAutoOrdering(true);
    try {
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
  }, [cards, isAutoOrdering, reorder]);

  // Turn off suggest mode when selection clears
  useEffect(() => {
    if (!selectedCardId) setSuggestMode(false);
  }, [selectedCardId]);

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

        <SetBuilderCanvas flowEdges={flowEdges} />

        <AiPanel
          cards={cards}
          entryMap={entryMap}
          selectedCard={selectedCard}
          flowEdges={flowEdges}
          onAutoOrder={autoOrder}
        />
      </div>
    </div>
  );
}
