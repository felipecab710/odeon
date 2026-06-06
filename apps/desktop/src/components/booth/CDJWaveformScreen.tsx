/**
 * CDJ-3000X display — Pioneer screen layout with live RGB waveforms.
 * Uses Select's WaveformRenderer; chrome matches CDJ-3000 reference UI.
 */
import { useEffect, useRef } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import { apiClient } from "../../lib/apiClient";
import {
  OverviewWaveform,
  ZoomedWaveform,
  type WaveformHandle,
} from "../select/WaveformRenderer";
import { CDJTrackNavigator } from "./CDJTrackNavigator";
import { ThreeBandOverview, hasOverview } from "./ThreeBandOverview";

const SCREEN_BG = "#000000";
const SCREEN_W = 320;
const SCREEN_H = 223;
/** Inset UI from display edges — black bezel padding (Pioneer reference) */
const SCREEN_PAD = 10;
const W = SCREEN_W - SCREEN_PAD * 2;

const HEADER_H = 30;
const TOP_OVERVIEW_H = 17;
const MAIN_WAVE_SECTION_H = 54;
const MAIN_WAVE_H = 36;
const FOOTER_H = 48;

interface Props {
  cache: WaveformCache | null;
  entry: CatalogEntry | null;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  deckIndex: number;
  title: string;
  pitchPercent: number;
  bpm: number;
  key: string;
  hotCueSlots: boolean[];
  hotCueTimes: (number | null)[];
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  const ms = Math.floor((s % 1) * 1000).toString().padStart(3, "0");
  return `${m}:${sec}.${ms}`;
}

function barCounters(beatTimes: number[] | null | undefined, pos: number, bpm: number) {
  const beatDur = bpm > 0 ? 60 / bpm : 0.5;
  const barDur = beatDur * 4;
  let phraseBars = 0;
  let beatBars = 0;
  if (beatDur > 0) {
    const nextPhrase = Math.ceil((pos + 0.001) / barDur) * barDur;
    phraseBars = Math.max(0, (nextPhrase - pos) / barDur);
    const nextBeat = Math.ceil((pos + 0.001) / beatDur) * beatDur;
    beatBars = Math.max(0, (nextBeat - pos) / barDur);
  }
  if (beatTimes?.length) {
    const next = beatTimes.find((b) => b > pos);
    if (next) beatBars = Math.max(0, (next - pos) / barDur);
  }
  return {
    phrase: phraseBars.toFixed(1),
    beat: beatBars.toFixed(1),
  };
}

function CdJPlayhead({ thick }: { thick?: boolean }) {
  return (
    <div style={{
      position: "absolute", left: "50%", top: 0, bottom: 0,
      width: thick ? 2 : 1, marginLeft: thick ? -1 : -0.5,
      background: "#ff2222", zIndex: 5, pointerEvents: "none",
    }}>
      {thick && (
        <>
          <div style={{
            position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
            borderTop: "6px solid #ff2222",
          }} />
          <div style={{
            position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
            borderBottom: "5px solid #fff",
          }} />
        </>
      )}
    </div>
  );
}

function ScreenBox({ label, value, w }: { label: string; value: string; w?: number }) {
  return (
    <div style={{
      border: "1px solid #aaa", borderRadius: 1, padding: "1px 3px",
      width: w, textAlign: "center", lineHeight: 1.1,
    }}>
      <div style={{ fontSize: 4, color: "#aaa", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#fff" }}>{value}</div>
    </div>
  );
}

export function CDJWaveformScreen({
  cache, entry, positionSec, durationSec, isPlaying,
  deckIndex, title, pitchPercent, bpm, key,
  hotCueSlots, hotCueTimes,
}: Props) {
  const zoomRef = useRef<WaveformHandle>(null);
  const topOverRef = useRef<WaveformHandle>(null);
  const lastSync = useRef(0);

  const dur = cache?.duration_seconds || durationSec || 0;
  const beatTimes = entry?.beat_times ?? null;
  const origBpm = entry?.bpm ?? bpm;
  const counters = barCounters(beatTimes, positionSec, bpm);
  const pitchStr = pitchPercent >= 0
    ? `+ ${pitchPercent.toFixed(2)}`
    : `- ${Math.abs(pitchPercent).toFixed(2)}`;
  const artworkUrl = entry?.has_artwork && entry?.id
    ? apiClient.select.artworkUrl(entry.id) : null;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      zoomRef.current?.sync(positionSec, now, dur, isPlaying);
      topOverRef.current?.sync(positionSec, now, dur, isPlaying);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positionSec, dur, isPlaying]);

  useEffect(() => {
    const now = performance.now();
    if (now - lastSync.current < 16) return;
    lastSync.current = now;
    zoomRef.current?.sync(positionSec, now, dur, isPlaying);
    topOverRef.current?.sync(positionSec, now, dur, isPlaying);
  }, [positionSec, isPlaying, dur]);

  return (
    <div style={{
      width: SCREEN_W, height: SCREEN_H,
      background: SCREEN_BG, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        left: SCREEN_PAD, top: SCREEN_PAD,
        width: W, height: SCREEN_H - SCREEN_PAD * 2,
        color: "#fff",
        fontFamily: "Inter, Helvetica Neue, Arial, sans-serif",
        overflow: "hidden",
      }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        height: HEADER_H, display: "flex", alignItems: "center",
        padding: "0 4px", gap: 4, borderBottom: "1px solid #1a1a1a",
      }}>
        <span style={{ fontSize: 6, color: "#888", width: 6 }}>{deckIndex + 1}</span>
        <div style={{
          width: 22, height: 22, background: "#1a4fd6", borderRadius: 2,
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", flexShrink: 0, fontSize: 4, fontWeight: 700,
          lineHeight: 1.1, color: "#fff",
        }}>
          <span style={{ fontSize: 7 }}>⬆</span>
          USB1
        </div>
        {artworkUrl ? (
          <img src={artworkUrl} alt="" style={{
            width: 22, height: 22, objectFit: "cover", borderRadius: 1, flexShrink: 0,
          }} />
        ) : (
          <div style={{
            width: 22, height: 22, background: "#333", borderRadius: 1, flexShrink: 0,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 7, fontWeight: 600, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <span style={{ color: "#4af" }}>✓</span> {title}
          </div>
          <div style={{ fontSize: 6, color: "#ccc", marginTop: 1 }}>
            {fmtDur(dur)}&nbsp;&nbsp;{origBpm.toFixed(1)}&nbsp;&nbsp;{key}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: "#888" }}>👁</span>
          {["BEAT LOOP", "KEY SHIFT", "BEAT JUMP"].map((lbl) => (
            <div key={lbl} style={{
              fontSize: 4, fontWeight: 600, color: "#ccc",
              background: "#1a1a1a", border: "1px solid #333",
              borderRadius: 2, padding: "2px 3px", whiteSpace: "nowrap",
            }}>
              {lbl}
            </div>
          ))}
          <span style={{ fontSize: 7, color: "#666" }}>ⓘ</span>
          <span style={{ fontSize: 7, color: "#666" }}>◉</span>
          <span style={{ fontSize: 7, color: "#666" }}>⌁</span>
        </div>
      </div>

      {/* ── Top overview strip ─────────────────────────────────── */}
      <div style={{
        height: TOP_OVERVIEW_H, position: "relative",
        borderBottom: "1px solid #111",
      }}>
        <div style={{
          position: "absolute", left: 4, top: 2, zIndex: 2,
          display: "flex", gap: 6, fontSize: 5, fontWeight: 600, lineHeight: 1,
        }}>
          <span style={{ color: "#e8a020" }}>{counters.phrase} Bars</span>
          <span style={{ color: "#ff4444" }}>{counters.beat} Bars</span>
        </div>
        <div style={{ position: "absolute", right: 4, top: 3, zIndex: 2 }}>
          <span style={{
            fontSize: 5, fontWeight: 700, color: "#fff",
            background: "#2a8a3a", padding: "1px 3px", borderRadius: 1,
          }}>D</span>
        </div>
        {hasOverview(cache) ? (
          <ThreeBandOverview
            cache={cache}
            width={W}
            height={TOP_OVERVIEW_H}
            bg={SCREEN_BG}
            baseline={0.7}
            reflect={0.5}
          />
        ) : (
          <OverviewWaveform
            ref={topOverRef}
            cache={cache}
            width={W}
            height={TOP_OVERVIEW_H}
            bg={SCREEN_BG}
            mode="rgb"
            hidePlayhead
          />
        )}
        {dur > 0 && (
          <div style={{
            position: "absolute", left: (positionSec / dur) * W, top: 0, bottom: 0,
            width: 1, background: "#ff2222", zIndex: 3, pointerEvents: "none",
          }} />
        )}
      </div>

      {/* ── Main scrolling waveform (short band — Pioneer reference) ─ */}
      <div style={{
        height: MAIN_WAVE_SECTION_H, position: "relative",
        borderBottom: "1px solid #111",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ position: "relative", width: W, height: MAIN_WAVE_H }}>
          <ZoomedWaveform
            ref={zoomRef}
            cache={cache}
            width={W}
            height={MAIN_WAVE_H}
            bg={SCREEN_BG}
            mode="rgb"
            beatTimes={beatTimes}
            zoomSeconds={8}
            hidePlayhead
          />
          <CdJPlayhead thick />
        </div>
        <div style={{
          position: "absolute", bottom: 2, right: 4,
          fontSize: 4, color: "#4af", fontWeight: 600, zIndex: 5,
        }}>
          ZOOM / GRID
        </div>
        <div style={{
          position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 20, fontSize: 4, color: "#888", zIndex: 5,
        }}>
          <span>8</span>
          <span>16</span>
        </div>
      </div>

      {/* ── Footer data row ────────────────────────────────────── */}
      <div style={{
        height: FOOTER_H, display: "grid",
        gridTemplateColumns: "72px 1fr 62px",
        padding: "3px 4px", gap: 2,
        borderBottom: "1px solid #111",
      }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <ScreenBox label="PLAYER" value={String(deckIndex + 1)} w={36} />
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 5, color: "#888" }}>▼</span>
            <ScreenBox label="TRACK" value={String((deckIndex + 1) * 7 + 18)} w={36} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 1 }}>
            <div style={{
              background: "#0099ee", borderRadius: 2, padding: "2px 4px",
              fontSize: 5, fontWeight: 700, color: "#fff",
            }}>
              GATE CUE
            </div>
            <span style={{ fontSize: 4, color: "#888" }}>SMART CUE</span>
          </div>
        </div>

        {/* Center column */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{ fontSize: 4, color: "#888", letterSpacing: 0.5 }}>REMAIN / TIME</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <div style={{
              fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums",
              letterSpacing: -0.5, lineHeight: 1,
            }}>
              {fmtClock(positionSec)}
            </div>
            <span style={{ fontSize: 5, color: "#888" }}>SINGLE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <span style={{ fontSize: 4, color: "#888" }}>TEMPO</span>
            <div style={{
              border: "1px solid #aaa", borderRadius: 1, padding: "0 3px",
              fontSize: 5, color: "#fff",
            }}>±16</div>
            <span style={{ fontSize: 9, fontWeight: 600 }}>{pitchStr}%</span>
          </div>
        </div>

        {/* Right column */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end",
          justifyContent: "space-between",
        }}>
          <ScreenBox label="BPM" value={bpm.toFixed(1)} w={48} />
        </div>
      </div>

      {/* ── Track navigation strip (full-track seek bar) ───────── */}
      <CDJTrackNavigator
        cache={cache}
        width={W}
        positionSec={positionSec}
        durationSec={dur}
        isPlaying={isPlaying}
        key={key}
        pitchPercent={pitchPercent}
        hotCueSlots={hotCueSlots}
        hotCueTimes={hotCueTimes}
      />
      </div>
    </div>
  );
}
