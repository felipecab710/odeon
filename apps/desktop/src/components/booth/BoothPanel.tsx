/**
 * Booth twin panel — embedded in Research view as "Booth" mode.
 */
import { useCallback } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { useTransportStore } from "../../stores/transportStore";
import { useBoothStore } from "../../stores/boothStore";
import { useBoothSimulation } from "../../hooks/useBoothSimulation";
import { applyAllDeckMixesBySlot, defaultDeckMix, type DeckMix } from "../../lib/deckMixEngine";
import { BoothTwin } from "./BoothTwin";
import { BoothMinimap } from "./BoothMinimap";
import { formatTimeline, computeSetLayout } from "../setbuilder/setTimelineLayout";

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
}

export function BoothPanel({ sorted, entryMap }: Props) {
  const isPlaying = useTransportStore(s => s.isPlaying);
  const playheadSec = useTransportStore(s => s.positionSeconds);
  const togglePlayPause = useTransportStore(s => s.togglePlayPause);
  const stop = useTransportStore(s => s.stop);
  const seek = useTransportStore(s => s.seek);
  const mode = useBoothStore(s => s.mode);
  const setMode = useBoothStore(s => s.setMode);
  const setInteractiveChannels = useBoothStore(s => s.setInteractiveChannels);
  const currentTransitionIndex = useBoothStore(s => s.currentTransitionIndex);
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const engineReady = useTransportStore(s => s.engineReady);

  const { syncing, syncError } = useBoothSimulation(true, sorted, entryMap);
  const canPlay = engineTracksReady && !syncing;

  const layout = computeSetLayout(sorted, entryMap);
  const totalDur = layout.totalSec;

  const onCrossfaderChange = useCallback((pos: number) => {
    const { channels } = useBoothStore.getState();
    const mixes: Record<number, DeckMix> = {};
    channels.forEach(ch => {
      if (!ch.entryId) return;
      mixes[ch.channelIndex] = {
        ...defaultDeckMix(),
        trimDb: ch.trimDb,
        faderDb: ch.faderDb,
        low: ch.low,
        mid: ch.mid,
        high: ch.high,
        filter: ch.filter,
        cfAssign: ch.cfAssign,
        cue: ch.cue,
        solo: ch.solo,
        mute: ch.mute,
        showAutomation: true,
      };
    });
    applyAllDeckMixesBySlot(mixes, pos);
  }, []);

  const getTimelineStart = useCallback((entryId: string) => {
    const lane = layout.lanes.find(l => l.card.entryId === entryId);
    return lane?.startSec ?? 0;
  }, [layout]);

  const switchMode = useCallback((m: "simulation" | "interactive") => {
    setMode(m);
    if (m === "simulation") setInteractiveChannels(null);
    else setInteractiveChannels([...useBoothStore.getState().channels]);
  }, [setMode, setInteractiveChannels]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <BoothMinimap
        sorted={sorted}
        entryMap={entryMap}
        playheadSec={playheadSec}
        transitionIndex={currentTransitionIndex}
        onSeek={seek}
      />

      {/* Transport */}
      <div style={{
        height: 40, flexShrink: 0, background: "#141414", borderBottom: "1px solid #222",
        display: "flex", alignItems: "center", padding: "0 12px", gap: 10,
      }}>
        <button
          onClick={() => { if (canPlay) void togglePlayPause(); }}
          disabled={!canPlay}
          title={!canPlay ? (syncing ? "Loading tracks…" : syncError ?? "Engine not ready") : undefined}
          style={{
            background: "#333", border: "1px solid #444", borderRadius: 4,
            color: !canPlay ? "#444" : isPlaying ? "#ffeb3b" : "#ccc",
            fontSize: 14, width: 36, height: 30,
            cursor: canPlay ? "pointer" : "not-allowed",
            opacity: canPlay ? 1 : 0.5,
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          onClick={() => stop()}
          style={{
            background: "#2a2a2a", border: "1px solid #333", borderRadius: 4,
            color: "#888", fontSize: 10, padding: "0 8px", height: 30, cursor: "pointer",
          }}
        >
          ■
        </button>

        <span style={{ fontSize: 11, color: "#ffeb3b", fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 48 }}>
          {formatTimeline(playheadSec)}
        </span>
        <span style={{ fontSize: 10, color: "#666" }}>/ {formatTimeline(totalDur)}</span>

        <input
          type="range"
          min={0}
          max={totalDur}
          step={0.1}
          value={playheadSec}
          onChange={e => seek(Number(e.target.value))}
          style={{ flex: 1, accentColor: "#ffeb3b" }}
        />

        {(syncing || syncError || !engineReady) && (
          <span style={{ fontSize: 9, color: syncError ? "#f44336" : "#888" }}>
            {syncing ? "Loading set…" : syncError ?? (!engineReady ? "Starting engine…" : "")}
          </span>
        )}

        <div style={{ display: "flex", background: "#111", borderRadius: 4, overflow: "hidden", border: "1px solid #333" }}>
          {(["simulation", "interactive"] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                background: mode === m ? "#ff980022" : "transparent",
                border: "none", padding: "5px 12px", fontSize: 9, fontWeight: 700,
                color: mode === m ? "#ff9800" : "#555", cursor: "pointer",
              }}
            >
              {m === "simulation" ? "◎ Watch" : "◎ Drive"}
            </button>
          ))}
        </div>
      </div>

      <BoothTwin
        entryMap={entryMap}
        interactive={mode === "interactive"}
        onCrossfaderChange={onCrossfaderChange}
        getTimelineStart={getTimelineStart}
      />
    </div>
  );
}
