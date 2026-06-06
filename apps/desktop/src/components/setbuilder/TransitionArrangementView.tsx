/**
 * Studio-style set arrangement — full timeline, stacked overlapping lanes,
 * automation curves on waveforms, per-deck EQ strips. Like DJ.Studio for set building.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import {
  apiClient,
  type FlowEdge,
  type TransitionPlanData,
} from "../../lib/apiClient";
import { loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import {
  type DeckMix,
  defaultDeckMix,
  applyDeckMixToEngine,
  applyAllDeckMixes,
} from "../../lib/deckMixEngine";
import {
  transitionGainCurve,
  transitionFilterCurve,
} from "../../lib/boothCurves";
import { useSetEngineSync } from "../../lib/useSetEngineSync";
import { useTransportStore } from "../../stores/transportStore";
import { StudioWaveformCanvas } from "./StudioWaveformCanvas";
import { DJMLaneStrip } from "./DJMLaneStrip";
import { DJMCrossfader } from "./DJMCrossfader";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import {
  LANE_HEIGHT, LANE_STRIP_W, RULER_H, MINIMAP_H, PX_PER_SEC,
  HEADER_H, AUTO_H, WAVE_H,
  STUDIO_BG, STUDIO_BG_DEEP, STUDIO_SIDEBAR, STUDIO_RULER, STUDIO_GRID,
  computeSetLayout, formatTimeline, type LaneLayout,
} from "./setTimelineLayout";

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
  transitionIndex: number;
  onSelectTransition: (index: number) => void;
}

const CAMELOT: Record<string, string> = {
  "C maj":"8B","C min":"5A","C# maj":"3B","C# min":"12A",
  "D maj":"10B","D min":"7A","D# maj":"5B","D# min":"2A",
  "E maj":"12B","E min":"9A","F maj":"7B","F min":"4A",
  "F# maj":"2B","F# min":"11A","G maj":"9B","G min":"6A",
  "G# maj":"4B","G# min":"1A","A maj":"11B","A min":"8A",
  "A# maj":"6B","A# min":"3A","B maj":"1B","B min":"10A",
};

// DJ.Studio deck accent colors
const LANE_COLORS = ["#c8e650", "#b39ddb", "#4fc3f7", "#ffab40", "#f48fb1", "#fff176"];
function camelot(k?: string | null) { return k ? CAMELOT[k] ?? k : "—"; }
function trackTitle(e: CatalogEntry) {
  return e.title || e.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

// ─── Automation overlay on waveform ──────────────────────────────────────────

function AutomationOverlay({ width, height, isOutgoing, showGain, showFilter }: {
  width: number; height: number; isOutgoing: boolean;
  showGain: boolean; showFilter: boolean;
}) {
  const samples = 32;
  const mid = height / 2;
  const gainPts: string[] = [];
  const filtPts: string[] = [];

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const x = t * width;
    const g = transitionGainCurve(t, isOutgoing);
    const f = transitionFilterCurve(t, isOutgoing);
    gainPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${(mid - g * (mid - 2)).toFixed(1)}`);
    filtPts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${(mid + f * (mid - 2)).toFixed(1)}`);
  }

  const nodes = [0.35, 0.5, 0.65].map(t => ({
    x: t * width,
    y: mid - transitionGainCurve(t, isOutgoing) * (mid - 2),
  }));

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {showGain && (
        <>
          <path d={gainPts.join(" ")} fill="none" stroke="#ffffff" strokeWidth={1.5} />
          {nodes.map((n, i) => (
            <rect key={i} x={n.x - 3} y={n.y - 3} width={6} height={6}
              fill="#fff" stroke="#333" strokeWidth={0.5} />
          ))}
        </>
      )}
      {showFilter && isOutgoing && (
        <path d={filtPts.join(" ")} fill="none" stroke="#ffeb3b" strokeWidth={1.5} />
      )}
    </svg>
  );
}

// ─── Single track block on timeline ───────────────────────────────────────────

function TrackBlock({ lane, color, mix, cache, isSelected, transitionWidth, transitionLeft }: {
  lane: LaneLayout;
  color: string;
  mix: DeckMix;
  cache: WaveformCache | null;
  isSelected: boolean;
  transitionWidth?: number;
  transitionLeft?: number;
}) {
  const w = Math.max(lane.widthPx, 80);
  const inTransition = transitionWidth != null && transitionLeft != null && transitionWidth > 0;
  const transLocalLeft = inTransition ? Math.max(0, transitionLeft! - lane.leftPx) : 0;
  const transLocalW = inTransition ? Math.min(transitionWidth!, w - transLocalLeft) : 0;
  const isOutgoing = inTransition && transitionLeft! < lane.leftPx + w * 0.55;

  return (
    <div style={{
      position: "absolute",
      left: lane.leftPx,
      top: lane.laneY,
      width: w,
      opacity: mix.mute ? 0.4 : 1,
      zIndex: 10,
    }}>
      {/* Colored header bar — DJ.Studio style */}
      <div style={{
        height: HEADER_H,
        display: "flex", alignItems: "center", gap: 5,
        padding: "0 6px",
        background: color,
        borderRadius: "2px 2px 0 0",
        boxShadow: isSelected ? `0 0 0 1px ${color}` : "none",
      }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: "#1a1a1a",
          background: "rgba(0,0,0,0.15)", padding: "0 4px", borderRadius: 2,
        }}>
          {camelot(lane.entry.key)}
        </span>
        <span style={{
          fontSize: 9, color: "#1a1a1a", fontWeight: 600,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
        }}>
          {trackTitle(lane.entry)}
        </span>
      </div>

      {/* Automation lane — above waveform */}
      <div style={{
        height: AUTO_H, position: "relative",
        background: STUDIO_BG_DEEP,
        borderLeft: `1px solid ${STUDIO_GRID}`,
        borderRight: `1px solid ${STUDIO_GRID}`,
      }}>
        {mix.showAutomation && inTransition && transLocalW > 0 && (
          <div style={{ position: "absolute", left: transLocalLeft, top: 0, width: transLocalW, height: AUTO_H }}>
            <AutomationOverlay
              width={transLocalW}
              height={AUTO_H}
              isOutgoing={isOutgoing}
              showGain
              showFilter
            />
          </div>
        )}
      </div>

      {/* Thin waveform strip */}
      <div style={{
        height: WAVE_H, overflow: "hidden",
        borderLeft: `1px solid ${STUDIO_GRID}`,
        borderRight: `1px solid ${STUDIO_GRID}`,
        borderBottom: `1px solid ${STUDIO_GRID}`,
        borderRadius: "0 0 2px 2px",
      }}>
        <StudioWaveformCanvas
          cache={cache}
          width={Math.floor(w)}
          height={WAVE_H}
          accent={color}
        />
      </div>
    </div>
  );
}

// ─── Main Studio arrangement view ────────────────────────────────────────────

export function TransitionArrangementView({
  sorted, entryMap, flowEdges, transitionIndex, onSelectTransition,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [caches, setCaches] = useState<Record<string, WaveformCache | null>>({});
  const [mixes, setMixes] = useState<Record<number, DeckMix>>({});
  const [crossfaderPos, setCrossfaderPos] = useState(0.5);
  const [plans, setPlans] = useState<Record<number, TransitionPlanData | null>>({});

  const playheadSec = useTransportStore(s => s.positionSeconds);
  const isPlaying = useTransportStore(s => s.isPlaying);
  const togglePlayPause = useTransportStore(s => s.togglePlayPause);
  const seek = useTransportStore(s => s.seek);

  const layout = useMemo(
    () => computeSetLayout(sorted, entryMap),
    [sorted, entryMap],
  );

  const { syncing: engineSyncing } = useSetEngineSync(layout.lanes);
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const canPlay = engineTracksReady && !engineSyncing;

  const getMix = useCallback((i: number) => mixes[i] ?? defaultDeckMix(), [mixes]);

  const setMix = useCallback((i: number, m: DeckMix) => {
    setMixes(prev => {
      const next = { ...prev, [i]: m };
      const entryId = layout.lanes[i]?.card.entryId;
      if (entryId) applyDeckMixToEngine(entryId, m, crossfaderPos);
      return next;
    });
  }, [layout.lanes, crossfaderPos]);

  const handleMixChange = useCallback((i: number, m: DeckMix) => {
    // Exclusive cue — only one deck cued at a time
    if (m.cue && !getMix(i).cue) {
      setMixes(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const idx = Number(key);
          if (idx !== i && next[idx]?.cue) {
            next[idx] = { ...next[idx], cue: false };
            const eid = layout.lanes[idx]?.card.entryId;
            if (eid) applyDeckMixToEngine(eid, next[idx], crossfaderPos);
          }
        }
        next[i] = m;
        const entryId = layout.lanes[i]?.card.entryId;
        if (entryId) applyDeckMixToEngine(entryId, m, crossfaderPos);
        return next;
      });
    } else {
      setMix(i, m);
    }
  }, [getMix, setMix, layout.lanes, crossfaderPos]);

  const entryIds = sorted.map(c => c.entryId).join(",");

  // Push all mix states when crossfader moves
  useEffect(() => {
    applyAllDeckMixes(
      mixes,
      layout.lanes.map(l => l.card.entryId),
      crossfaderPos,
    );
  }, [crossfaderPos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load waveforms
  useEffect(() => {
    for (const lane of layout.lanes) {
      const id = lane.card.entryId;
      const fp = lane.entry.file_path;
      if (!fp) continue;
      setCaches(prev => {
        if (id in prev) return prev;
        loadWaveformCache(fp).then(c => {
          setCaches(p => ({ ...p, [id]: c }));
        }).catch(() => {
          setCaches(p => ({ ...p, [id]: null }));
        });
        return { ...prev, [id]: null };
      });
    }
  }, [entryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load transition plans
  useEffect(() => {
    for (const t of layout.transitions) {
      apiClient.select.planTransition(t.fromEntryId, t.toEntryId)
        .then(p => setPlans(prev => ({ ...prev, [t.index]: p })))
        .catch(() => setPlans(prev => ({ ...prev, [t.index]: null })));
    }
  }, [entryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to selected transition
  useEffect(() => {
    const t = layout.transitions[transitionIndex];
    if (!t || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, t.leftPx - 120);
  }, [transitionIndex, layout.transitions]);

  if (layout.lanes.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
        Add tracks to build your set arrangement
      </div>
    );
  }

  const timelineH = layout.lanes.length * LANE_HEIGHT;
  const totalDur = layout.totalSec;

  const rulerMarks: number[] = [];
  for (let s = 0; s <= totalDur; s += 15) rulerMarks.push(s);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: STUDIO_BG_DEEP }}>
      {/* Top bar — set overview */}
      <div style={{
        height: 28, flexShrink: 0, background: STUDIO_SIDEBAR, borderBottom: `1px solid ${STUDIO_GRID}`,
        display: "flex", alignItems: "center", padding: "0 12px", gap: 16, fontSize: 10,
      }}>
        <span style={{ color: "#999" }}>
          <span style={{ color: "#ffeb3b", fontWeight: 700 }}>{formatTimeline(playheadSec)}</span>
          {" / "}{formatTimeline(totalDur)}
        </span>
        <span style={{ color: "#666" }}>{sorted.length} tracks</span>
        {layout.lanes[0] && (
          <span style={{ color: "#90caf9" }}>
            {camelot(layout.lanes[0].entry.key)} · {Math.round(layout.lanes[0].entry.bpm ?? 128)} BPM
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => canPlay && togglePlayPause()}
          disabled={!canPlay}
          title={!canPlay ? (engineSyncing ? "Loading tracks…" : "Engine not ready") : undefined}
          style={{
            background: "#333", border: "1px solid #444", borderRadius: 3,
            color: !canPlay ? "#444" : isPlaying ? "#ffeb3b" : "#aaa",
            fontSize: 10, fontWeight: 700,
            padding: "2px 10px", cursor: canPlay ? "pointer" : "not-allowed",
            opacity: canPlay ? 1 : 0.5,
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
      </div>

      {/* Mini-map */}
      <div style={{
        height: MINIMAP_H, flexShrink: 0, background: STUDIO_SIDEBAR, borderBottom: `1px solid ${STUDIO_GRID}`,
        position: "relative", margin: "0 0 0 0",
      }}>
        <div style={{ position: "absolute", left: LANE_STRIP_W, right: 0, top: 4, bottom: 4, display: "flex" }}>
          {layout.lanes.map((lane, i) => (
            <div
              key={lane.card.id}
              onClick={() => {
                if (scrollRef.current) scrollRef.current.scrollLeft = lane.leftPx;
                if (i < layout.transitions.length) onSelectTransition(i);
              }}
              style={{
                position: "absolute",
                left: `${(lane.startSec / totalDur) * 100}%`,
                width: `${(lane.durationSec / totalDur) * 100}%`,
                height: "100%",
                background: LANE_COLORS[i % LANE_COLORS.length] + "44",
                border: transitionIndex === i || transitionIndex === i - 1
                  ? `1px solid ${LANE_COLORS[i % LANE_COLORS.length]}`
                  : "1px solid #222",
                borderRadius: 2, cursor: "pointer", minWidth: 4,
              }}
            />
          ))}
          {/* Viewport indicator */}
          <div style={{
            position: "absolute",
            left: `${(playheadSec / totalDur) * 100}%`,
            width: `${Math.min(30, (600 / layout.totalWidthPx) * 100)}%`,
            height: "100%",
            border: "1px solid #ffeb3b88",
            background: "#ffeb3b08",
            borderRadius: 2, pointerEvents: "none",
          }} />
        </div>
      </div>

      {/* Timeline body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Fixed lane strips */}
        <div style={{
          width: LANE_STRIP_W, flexShrink: 0, background: STUDIO_SIDEBAR,
          borderRight: `1px solid ${STUDIO_GRID}`, overflow: "hidden",
        }}>
          <div style={{ height: RULER_H, borderBottom: `1px solid ${STUDIO_GRID}`, background: STUDIO_RULER }} />
          {layout.lanes.map((lane, i) => (
            <DJMLaneStrip
              key={lane.card.id}
              index={i}
              entryId={lane.card.entryId}
              mix={getMix(i)}
              onChange={m => handleMixChange(i, m)}
              color={LANE_COLORS[i % LANE_COLORS.length]}
            />
          ))}
        </div>

        {/* Scrollable timeline */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: "auto", position: "relative", background: STUDIO_BG }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
            seek(x / PX_PER_SEC);
          }}
        >
          <div style={{ width: layout.totalWidthPx + 200, minHeight: timelineH + RULER_H, position: "relative" }}>
            {/* Time ruler */}
            <div style={{
              height: RULER_H, position: "sticky", top: 0, zIndex: 20,
              background: STUDIO_RULER, borderBottom: `1px solid ${STUDIO_GRID}`,
            }}>
              {rulerMarks.map(s => (
                <div key={s} style={{
                  position: "absolute", left: s * PX_PER_SEC, top: 0, height: "100%",
                  borderLeft: `1px solid ${STUDIO_GRID}`, paddingLeft: 4, paddingTop: 5,
                  fontSize: 8, color: "#888",
                }}>
                  {formatTimeline(s)}
                </div>
              ))}
            </div>

            {/* Grid lines */}
            <div style={{ position: "absolute", top: RULER_H, left: 0, right: 0, height: timelineH }}>
              {rulerMarks.map(s => (
                <div key={s} style={{
                  position: "absolute", left: s * PX_PER_SEC, top: 0, height: "100%",
                  borderLeft: `1px solid ${STUDIO_GRID}44`, pointerEvents: "none",
                }} />
              ))}
            </div>

            {/* Transition regions (blue boxes) */}
            {layout.transitions.map(t => {
              const edge = flowEdges.find(
                e => e.from_id === t.fromEntryId && e.to_id === t.toEntryId,
              );
              const isActive = t.index === transitionIndex;
              return (
                <div
                  key={t.index}
                  onClick={e => { e.stopPropagation(); onSelectTransition(t.index); }}
                  style={{
                    position: "absolute",
                    left: t.leftPx,
                    top: RULER_H + t.laneAY,
                    width: t.widthPx,
                    height: t.laneBY - t.laneAY + LANE_HEIGHT,
                    border: isActive ? "2px solid #ffeb3b" : "1px solid rgba(100,149,237,0.5)",
                    background: isActive ? "rgba(255,235,59,0.08)" : "rgba(100,149,237,0.06)",
                    borderRadius: 4, cursor: "pointer", zIndex: 3,
                    pointerEvents: "auto",
                  }}
                >
                  <div style={{
                    position: "absolute", top: -18, left: 4,
                    fontSize: 8, fontWeight: 700, color: isActive ? "#ffeb3b" : "#6495ed",
                    background: STUDIO_BG, padding: "1px 6px", borderRadius: 3,
                    whiteSpace: "nowrap",
                  }}>
                    {t.index + 1}→{t.index + 2}
                    {edge?.overall != null ? ` · ${Math.round(edge.overall * 100)}%` : ""}
                    {plans[t.index]?.strategy ? ` · ${plans[t.index]!.strategy!.replace(/_/g, " ")}` : ""}
                  </div>
                </div>
              );
            })}

            {/* Playhead */}
            <div style={{
              position: "absolute",
              left: playheadSec * PX_PER_SEC,
              top: RULER_H,
              height: timelineH,
              width: 2,
              background: "#fff",
              zIndex: 30,
              pointerEvents: "none",
            }}>
              <div style={{
                position: "absolute", top: -RULER_H, left: -5,
                width: 0, height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: "8px solid #fff",
              }} />
            </div>

            {/* Track blocks */}
            <div style={{ position: "absolute", top: RULER_H, left: 0, height: timelineH }}>
              {layout.lanes.map((lane, i) => {
                const outTrans = layout.transitions.find(t => t.index === i);
                const inTrans = layout.transitions.find(t => t.index === i - 1);
                let tW: number | undefined;
                let tL: number | undefined;
                if (outTrans) { tW = outTrans.widthPx; tL = outTrans.leftPx; }
                else if (inTrans) { tW = inTrans.widthPx; tL = inTrans.leftPx; }

                return (
                  <TrackBlock
                    key={lane.card.id}
                    lane={lane}
                    color={LANE_COLORS[i % LANE_COLORS.length]}
                    mix={getMix(i)}
                    cache={caches[lane.card.entryId] ?? null}
                    isSelected={i === transitionIndex || i === transitionIndex + 1}
                    transitionWidth={tW}
                    transitionLeft={tL}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <DJMCrossfader
        position={crossfaderPos}
        onChange={setCrossfaderPos}
        width={LANE_STRIP_W}
      />

      {/* Bottom tracklist */}
      <div style={{
        height: 110, flexShrink: 0, background: STUDIO_SIDEBAR, borderTop: `1px solid ${STUDIO_GRID}`,
        overflow: "auto",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `${LANE_STRIP_W}px 28px 1fr 64px 48px 48px 48px 56px`,
          gap: 0, fontSize: 8, color: "#666", fontWeight: 700,
          letterSpacing: "0.06em", borderBottom: `1px solid ${STUDIO_GRID}`,
          padding: "5px 0", position: "sticky", top: 0, background: STUDIO_SIDEBAR,
        }}>
          <span /><span>#</span><span>TITLE</span><span>TRANS</span>
          <span>VOL</span><span>BASS</span><span>FLT</span><span>KEY</span>
        </div>
        {layout.lanes.map((lane, i) => {
          const edge = i > 0
            ? flowEdges.find(f => f.from_id === layout.lanes[i - 1].card.entryId && f.to_id === lane.card.entryId)
            : null;
          const active = i === transitionIndex || i === transitionIndex + 1;
          return (
            <div
              key={lane.card.id}
              onClick={() => i > 0 && onSelectTransition(i - 1)}
              style={{
                display: "grid",
                gridTemplateColumns: `${LANE_STRIP_W}px 28px 1fr 64px 48px 48px 48px 56px`,
                padding: "4px 0", fontSize: 10, cursor: i > 0 ? "pointer" : "default",
                background: active ? "#ffeb3b0a" : "transparent",
                borderLeft: active ? `3px solid ${LANE_COLORS[i % LANE_COLORS.length]}` : "3px solid transparent",
              }}
            >
              <span />
              <span style={{ color: "#444", paddingLeft: 8 }}>{i + 1}</span>
              <span style={{ color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {trackTitle(lane.entry)}
              </span>
              <span style={{ color: edge ? (edge.overall! >= 0.7 ? "#4ade80" : "#facc15") : "#333" }}>
                {i === 0 ? "—" : edge ? `${Math.round((edge.overall ?? 0) * 100)}%` : "—"}
              </span>
              <span style={{ color: "#444" }}>—</span>
              <span style={{ color: "#444" }}>—</span>
              <span style={{ color: "#444" }}>—</span>
              <span style={{ color: "#00c3ff", opacity: 0.7 }}>{camelot(lane.entry.key)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
