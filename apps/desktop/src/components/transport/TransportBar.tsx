/**
 * TransportBar — Pro Tools–style counter + edit selection + cursor inspection.
 */
import { useEffect, useRef, useState } from "react";
import { useTransportStore } from "../../stores/transportStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useEditSelectionStore, selectionLengthSeconds } from "../../stores/editSelectionStore";
import { useCursorLevel } from "../../hooks/useCursorLevel";
import { formatCursorDb } from "../../lib/cursorLevel";
import {
  formatPosition,
  formatDuration,
  formatBarsBeats,
  formatMinSec,
  TIMEBASE_LABELS,
  TIMEBASE_MENU_ORDER,
  type MeterConfig,
  type Timebase,
} from "../../lib/timeFormat";
import { sessionDurationSeconds } from "../../lib/timelineUtils";

const BAR_BG      = "#262626";
const PILL_BG     = "#1a1a1a";
const PILL_BORDER = "#2a2a2a";
const ICON        = "#b0b0b0";
const TEXT        = "#e0e0e0";
const MUTED       = "#888";
const RECORD      = "#e04545";
const COUNTIN     = "#7c6aad";
const PLAY_TRI    = "#c8c8c8";
const LCD_GREEN   = "#33ee33";
const PILL_OUTER_H = 40;
const PILL_PAD_X   = 14;
const ICON_SIZE    = 28;
const MENU_BG      = "#3a4555";
const MENU_HILITE   = "#4a6fa5";
const MENU_BORDER   = "#2a3340";

function Pill({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: PILL_OUTER_H,
        padding: `0 ${PILL_PAD_X}px`,
        boxSizing: "border-box",
        borderRadius: 4,
        background: PILL_BG,
        border: `1px solid ${PILL_BORDER}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function IconBtn({
  title, onClick, disabled, children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: ICON_SIZE,
        height: ICON_SIZE,
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        padding: 0,
        borderRadius: 3,
      }}
    >
      {children}
    </button>
  );
}

function TimebaseMenuItem({
  label, selected, onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "5px 10px",
        border: "none",
        background: selected ? MENU_HILITE : "transparent",
        color: "#fff",
        fontSize: 12,
        fontFamily: "system-ui, sans-serif",
        textAlign: "left",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "#4a5568";
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <span style={{ width: 14, fontSize: 11, flexShrink: 0 }}>
        {selected ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

function subCounterValue(
  seconds: number,
  mainTimebase: Timebase,
  meter: MeterConfig,
): string {
  if (mainTimebase === "min-sec") return formatBarsBeats(seconds, meter);
  return formatMinSec(seconds);
}

/** Large green LCD counter with Pro Tools–style timebase dropdown. */
function MainCounter({
  value,
  subValue,
  timebase,
  showSubCounter,
  onSelectTimebase,
  onToggleSubCounter,
}: {
  value: string;
  subValue: string;
  timebase: Timebase;
  showSubCounter: boolean;
  onSelectTimebase: (tb: Timebase) => void;
  onToggleSubCounter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 108 }}>
        <span style={{
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1,
          color: LCD_GREEN,
          fontFamily: "'Courier New', Courier, monospace",
          letterSpacing: "0.06em",
          textShadow: "0 0 8px rgba(51,238,51,0.3)",
        }}>
          {value}
        </span>
        {showSubCounter && (
          <span style={{
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1,
            color: MUTED,
            fontFamily: "'Courier New', Courier, monospace",
            letterSpacing: "0.04em",
          }}>
            {subValue}
          </span>
        )}
      </div>
      <button
        type="button"
        title={`Timebase: ${TIMEBASE_LABELS[timebase]}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          border: "none",
          background: open ? "#333" : "transparent",
          cursor: "pointer",
          padding: "2px 4px",
          borderRadius: 3,
          color: MUTED,
          fontSize: 9,
        }}
      >
        <span style={{ fontSize: 8, lineHeight: 1 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            minWidth: 168,
            background: MENU_BG,
            border: `1px solid ${MENU_BORDER}`,
            borderRadius: 4,
            boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
            padding: "4px 0",
            overflow: "hidden",
          }}
        >
          {TIMEBASE_MENU_ORDER.map((tb) => (
            <TimebaseMenuItem
              key={tb}
              label={TIMEBASE_LABELS[tb]}
              selected={timebase === tb}
              onSelect={() => {
                onSelectTimebase(tb);
                setOpen(false);
              }}
            />
          ))}

          <div style={{ height: 1, background: MENU_BORDER, margin: "4px 0" }} />

          <TimebaseMenuItem
            label="Show Sub Counter"
            selected={showSubCounter}
            onSelect={() => {
              onToggleSubCounter();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Small labeled counter field (Start / End / Length / Cursor). */
function CounterField({
  label, value, valueColor = TEXT, mono = true,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 72 }}>
      <span style={{
        fontSize: 8,
        color: MUTED,
        fontFamily: "system-ui, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        lineHeight: 1,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        color: valueColor,
        fontFamily: mono ? "'Courier New', Courier, monospace" : "system-ui, sans-serif",
        letterSpacing: mono ? "0.04em" : undefined,
        whiteSpace: "nowrap",
      }}>
        {value}
      </span>
    </div>
  );
}

export function TransportBar() {
  const {
    isPlaying, positionSeconds, cursorSeconds, cursorTrackId,
    mainTimebase, showSubCounter, bpm, isLoopEnabled, clickTrackEnabled,
    engineTracksReady, play, pause, stop, toggleLoop, toggleClickTrack,
    setMainTimebase, toggleShowSubCounter,
  } = useTransportStore();
  const project = useProjectStore((s) => s.project);
  const selectedTrackId = useSelectionStore((s) => s.selectedTrackId);
  const { startSeconds, endSeconds, syncSessionEnd } = useEditSelectionStore();
  const tracks = project?.tracks ?? [];

  const [countIn, setCountIn] = useState(false);

  const sessionSec = sessionDurationSeconds(tracks);
  useEffect(() => {
    if (sessionSec > 0) syncSessionEnd(sessionSec);
  }, [sessionSec, syncSessionEnd]);

  const meter: MeterConfig = {
    bpm,
    numerator: project?.time_signature_numerator ?? 4,
    denominator: project?.time_signature_denominator ?? 4,
  };

  const sampleRate = project?.sample_rate ?? 48000;
  const canPlay = engineTracksReady || tracks.length > 0;
  const playhead   = formatPosition(positionSeconds, mainTimebase, meter, sampleRate);
  const selStart   = formatPosition(startSeconds, mainTimebase, meter, sampleRate);
  const selEnd     = formatPosition(endSeconds, mainTimebase, meter, sampleRate);
  const selLength  = formatDuration(selectionLengthSeconds(startSeconds, endSeconds), mainTimebase, meter, sampleRate);
  const cursorPos  = formatBarsBeats(cursorSeconds, meter);
  const cursorDb   = useCursorLevel(tracks, cursorSeconds, cursorTrackId, selectedTrackId);
  const ts = `${meter.numerator}/${meter.denominator}`;
  const key = "C maj";

  const handleToStart = () => { stop(); };

  return (
    <div
      className="flex-shrink-0 select-none"
      style={{
        background: BAR_BG,
        borderBottom: `1px solid ${PILL_BORDER}`,
        display: "flex",
        justifyContent: "center",
        padding: "10px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

        {/* ── Playback controls ─────────────────────────────────────────── */}
        <Pill style={{ gap: 6 }}>
          <IconBtn title="Return to start" onClick={handleToStart}>
            <span style={{ fontSize: 12, color: ICON, lineHeight: 1 }}>|◀</span>
          </IconBtn>

          {isPlaying ? (
            <IconBtn title="Pause (Space)" onClick={() => void pause()}>
              <div style={{ display: "flex", gap: 3 }}>
                <div style={{ width: 3, height: 12, background: PLAY_TRI, borderRadius: 1 }} />
                <div style={{ width: 3, height: 12, background: PLAY_TRI, borderRadius: 1 }} />
              </div>
            </IconBtn>
          ) : (
            <IconBtn title="Play (Space)" onClick={() => void play()} disabled={!canPlay}>
              <div style={{
                width: 0, height: 0, marginLeft: 3,
                borderTop: "7px solid transparent",
                borderBottom: "7px solid transparent",
                borderLeft: `11px solid ${PLAY_TRI}`,
              }} />
            </IconBtn>
          )}

          <IconBtn title="Record">
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: RECORD }} />
          </IconBtn>

          <IconBtn title="Loop" onClick={toggleLoop}>
            <span style={{ fontSize: 15, color: isLoopEnabled ? TEXT : ICON, lineHeight: 1 }}>↻</span>
          </IconBtn>
        </Pill>

        {/* ── Main counter + tempo + meter ───────────────────────────────── */}
        <Pill style={{ gap: 14 }}>
          <MainCounter
            value={playhead}
            subValue={subCounterValue(positionSeconds, mainTimebase, meter)}
            timebase={mainTimebase}
            showSubCounter={showSubCounter}
            onSelectTimebase={setMainTimebase}
            onToggleSubCounter={toggleShowSubCounter}
          />

          <span style={{
            fontSize: 14,
            fontWeight: 500,
            color: TEXT,
            fontFamily: "system-ui, sans-serif",
            minWidth: 40,
          }}>
            {bpm.toFixed(1)}
          </span>

          <div style={{ width: 1, height: ICON_SIZE, background: PILL_BORDER, flexShrink: 0 }} />

          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            minWidth: 36,
            lineHeight: 1.1,
          }}>
            <span style={{ fontSize: 12, color: TEXT, fontFamily: "system-ui, sans-serif" }}>{ts}</span>
            <span style={{ fontSize: 11, color: MUTED, fontFamily: "system-ui, sans-serif" }}>{key}</span>
          </div>
        </Pill>

        {/* ── Edit selection: Start · End · Length ─────────────────────── */}
        <Pill style={{ gap: 14, padding: `0 ${PILL_PAD_X - 2}px` }}>
          <CounterField label="Start"  value={selStart} />
          <div style={{ width: 1, height: 28, background: PILL_BORDER, flexShrink: 0 }} />
          <CounterField label="End"    value={selEnd} />
          <div style={{ width: 1, height: 28, background: PILL_BORDER, flexShrink: 0 }} />
          <CounterField label="Length" value={selLength} />
        </Pill>

        {/* ── Cursor inspection (always Bars|Beats + lane dB) ──────────── */}
        <Pill style={{ gap: 8, padding: `0 ${PILL_PAD_X - 2}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, color: MUTED, lineHeight: 1 }} title="Bars|Beats">♪</span>
            <CounterField label="Cursor" value={cursorPos} valueColor={LCD_GREEN} />
          </div>
          <div style={{ width: 1, height: ICON_SIZE, background: PILL_BORDER, flexShrink: 0 }} />
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            color: cursorDb !== null && cursorDb > -89 ? LCD_GREEN : MUTED,
            fontFamily: "'Courier New', monospace",
            whiteSpace: "nowrap",
            minWidth: 56,
            textAlign: "right",
            textShadow: cursorDb !== null && cursorDb > -89 ? "0 0 6px rgba(51,238,51,0.35)" : undefined,
          }}>
            {formatCursorDb(cursorDb)}
          </span>
        </Pill>

        {/* ── Count-in · metronome ──────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            title="Count-in"
            onClick={() => setCountIn((v) => !v)}
            style={{
              width: PILL_OUTER_H,
              height: PILL_OUTER_H,
              boxSizing: "border-box",
              borderRadius: 4,
              border: `1px solid ${countIn ? "#9a8ac4" : PILL_BORDER}`,
              background: countIn ? COUNTIN : PILL_BG,
              color: countIn ? "#fff" : COUNTIN,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "system-ui, sans-serif",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            1234
          </button>

          <button
            type="button"
            title="Metronome"
            onClick={() => toggleClickTrack()}
            style={{
              width: PILL_OUTER_H,
              height: PILL_OUTER_H,
              boxSizing: "border-box",
              borderRadius: 4,
              border: `1px solid ${clickTrackEnabled ? "#555" : PILL_BORDER}`,
              background: clickTrackEnabled ? "#2a2a2a" : PILL_BG,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <svg width="18" height="22" viewBox="0 0 22 26" fill="none">
              <path d="M11 2 L20 22 H2 Z" stroke={clickTrackEnabled ? TEXT : ICON} strokeWidth="1.5" fill="none" />
              <line x1="11" y1="8" x2="16" y2="18" stroke={clickTrackEnabled ? TEXT : ICON} strokeWidth="1.5" />
              <rect x="9" y="22" width="4" height="3" rx="1" fill={clickTrackEnabled ? TEXT : ICON} />
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}
