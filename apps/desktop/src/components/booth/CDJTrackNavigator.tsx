/**
 * CDJ-3000X track navigation strip — full-track overview for seeking.
 *
 * Distinct from the top phrase overview: shows hot-cue markers, played-region
 * dimming, minute ruler, progress bar, and flanking BEAT JUMP / MT·KEY labels.
 */
import { useEffect, useRef } from "react";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import { TrackNavWaveform, type WaveformHandle } from "../select/WaveformRenderer";

const HOT_CUE_COLORS = [
  "#ff2244", "#00c8ea", "#22bb44", "#aa44ff",
  "#3ecf5e", "#ff7700", "#4455ff", "#ddcc00",
];
const HOT_CUE_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const SIDE_W = 34;
const HOT_CUE_H = 9;
const WAVE_H = 12;
const RULER_H = 8;

interface Props {
  cache: WaveformCache | null;
  width: number;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  key: string;
  pitchPercent: number;
  hotCueSlots: boolean[];
  hotCueTimes: (number | null)[];
}

function fmtMinLabel(s: number): string {
  return `${Math.floor(s / 60)}:00`;
}

export function CDJTrackNavigator({
  cache, width, positionSec, durationSec, isPlaying,
  key, pitchPercent, hotCueSlots, hotCueTimes,
}: Props) {
  const navRef = useRef<WaveformHandle>(null);
  const lastSync = useRef(0);
  const dur = cache?.duration_seconds || durationSec || 0;
  const navW = width - SIDE_W * 2;
  const playX = dur > 0 ? (positionSec / dur) * navW : 0;
  const progress = dur > 0 ? positionSec / dur : 0;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      navRef.current?.sync(positionSec, now, dur, isPlaying);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positionSec, dur, isPlaying]);

  useEffect(() => {
    const now = performance.now();
    if (now - lastSync.current < 16) return;
    lastSync.current = now;
    navRef.current?.sync(positionSec, now, dur, isPlaying);
  }, [positionSec, isPlaying, dur]);

  const timeMarkers: number[] = [];
  if (dur > 0) {
    for (let t = 60; t < dur; t += 60) timeMarkers.push(t);
  }

  return (
    <div style={{
      width, height: HOT_CUE_H + WAVE_H + RULER_H,
      display: "flex", alignItems: "stretch",
      background: "#000",
    }}>
      {/* Left — BEAT JUMP */}
      <div style={{
        width: SIDE_W, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingLeft: 2,
      }}>
        <span style={{
          fontSize: 4, fontWeight: 600, color: "#ccc",
          lineHeight: 1.2, textAlign: "center",
        }}>
          BEAT<br />JUMP 32
        </span>
      </div>

      {/* Center — hot cues + waveform + ruler */}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        {/* Hot cue pills */}
        <div style={{ height: HOT_CUE_H, position: "relative" }}>
          {dur > 0 && HOT_CUE_LABELS.map((label, i) => {
            if (!hotCueSlots[i]) return null;
            const t = hotCueTimes[i];
            if (t == null) return null;
            const x = (t / dur) * navW;
            return (
              <div
                key={label}
                style={{
                  position: "absolute", left: x - 5, top: 1,
                  width: 10, height: 7, borderRadius: 1,
                  background: HOT_CUE_COLORS[i],
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 5, fontWeight: 800, color: "#fff",
                  pointerEvents: "none", zIndex: 2,
                }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Full-track nav waveform */}
        <div style={{ height: WAVE_H, position: "relative" }}>
          <TrackNavWaveform
            ref={navRef}
            cache={cache}
            width={navW}
            height={WAVE_H}
            bg="#030306"
            mode="rgb"
          />
          {dur > 0 && (
            <>
              {/* Playhead line */}
              <div style={{
                position: "absolute", left: playX, top: 0, bottom: 0,
                width: 1, background: "#ff2222", zIndex: 3, pointerEvents: "none",
              }} />
              {/* Red triangle top */}
              <div style={{
                position: "absolute", left: playX - 4, top: -1,
                width: 0, height: 0, zIndex: 4, pointerEvents: "none",
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                borderTop: "5px solid #ff2222",
              }} />
              {/* White triangle bottom */}
              <div style={{
                position: "absolute", left: playX - 3, bottom: -1,
                width: 0, height: 0, zIndex: 4, pointerEvents: "none",
                borderLeft: "3px solid transparent",
                borderRight: "3px solid transparent",
                borderBottom: "4px solid #fff",
              }} />
            </>
          )}
        </div>

        {/* Minute ruler + progress bar */}
        <div style={{ height: RULER_H, position: "relative" }}>
          {/* Tick marks */}
          {dur > 0 && timeMarkers.map((t) => (
            <div key={t} style={{
              position: "absolute",
              left: (t / dur) * navW,
              top: 0, bottom: 3,
              width: 1, background: "#444",
              pointerEvents: "none",
            }} />
          ))}
          {dur > 0 && timeMarkers.map((t) => (
            <span key={`lbl-${t}`} style={{
              position: "absolute",
              left: (t / dur) * navW - 6,
              top: 1,
              fontSize: 4,
              color: "#666",
              pointerEvents: "none",
            }}>
              {fmtMinLabel(t)}
            </span>
          ))}
          {/* Red progress bar */}
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 2,
            background: "#1a1a1a",
          }}>
            <div style={{
              width: `${progress * 100}%`, height: "100%",
              background: "#ff2222",
            }} />
          </div>
        </div>
      </div>

      {/* Right — MT + KEY */}
      <div style={{
        width: SIDE_W, flexShrink: 0,
        display: "flex", flexDirection: "column",
        alignItems: "flex-end", justifyContent: "center",
        paddingRight: 3, gap: 1,
      }}>
        <span style={{
          fontSize: 5, fontWeight: 700,
          color: pitchPercent === 0 ? "#ff4444" : "#666",
        }}>
          MT
        </span>
        <span style={{ fontSize: 5, color: "#ccc", fontWeight: 600 }}>
          KEY {key}
        </span>
      </div>
    </div>
  );
}
