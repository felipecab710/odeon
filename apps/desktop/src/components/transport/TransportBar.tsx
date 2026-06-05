/**
 * TransportBar — Ardour-style two-row transport.
 *
 * Row 1: Transport buttons · Punch In/Out · LED position displays · J=BPM · TS: 4/4 · Clock · Status
 * Row 2: Rec mode · Loop · A/B selector
 */
import { useState } from "react";
import { useTransportStore } from "../../stores/transportStore";
import { useProjectStore } from "../../stores/projectStore";
import type { ABMode } from "../../stores/transportStore";

// ── Time maths ────────────────────────────────────────────────────────────────
function toBarsBeats(seconds: number, bpm: number, num = 4) {
  const beatDur = 60 / bpm;
  const barDur  = beatDur * num;
  const bar     = Math.floor(seconds / barDur) + 1;
  const beat    = Math.floor((seconds % barDur) / beatDur) + 1;
  const tick    = Math.floor(((seconds % beatDur) / beatDur) * 1920);
  return `${String(bar).padStart(3,"0")}|${String(beat).padStart(2,"0")}|${String(tick).padStart(4,"0")}`;
}
function toTimecode(seconds: number) {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = Math.floor(seconds % 60);
  const fr  = Math.floor((seconds % 1) * 30); // ~30fps
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}:${String(fr).padStart(2,"0")}`;
}
function formatBpm(bpm: number) {
  return bpm.toFixed(3);
}

// ── LED display ───────────────────────────────────────────────────────────────
function LedDisplay({ value, label, wide = false }: { value: string; label?: string; wide?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {label && <span style={{ fontSize: 8, color: "#555", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>}
      <div
        className="font-mono tabular-nums flex items-center justify-center rounded-sm px-2"
        style={{
          background: "#000",
          color: "#00e000",
          border: "1px solid #1a2a1a",
          fontSize: wide ? 18 : 15,
          height: 28,
          minWidth: wide ? 160 : 120,
          letterSpacing: "0.05em",
          textShadow: "0 0 8px #00e00088",
          fontFamily: "'Courier New', 'Lucida Console', monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Transport icon button ─────────────────────────────────────────────────────
function TBtn({
  label, onClick, active = false, danger = false,
  disabled = false, title = "",
}: {
  label: string; onClick?: () => void; active?: boolean; danger?: boolean;
  disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center rounded transition-colors select-none"
      style={{
        width: 26, height: 22,
        background: active ? (danger ? "#c0392b" : "#2ecc71") : "#2a2a2a",
        border: `1px solid ${active ? (danger ? "#992b22" : "#27ae60") : "#3a3a3a"}`,
        color: active ? "#000" : disabled ? "#444" : "#bbb",
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ── Punch button ──────────────────────────────────────────────────────────────
function PunchBtn({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-center rounded font-semibold transition-colors"
      style={{
        padding: "0 8px", height: 22,
        background: active ? "#c0392b" : "#2a2a2a",
        border: `1px solid ${active ? "#992b22" : "#3a3a3a"}`,
        color: active ? "#fff" : "#888",
        fontSize: 10,
      }}
    >
      {label}
    </button>
  );
}

// ── Small label+value ─────────────────────────────────────────────────────────
function InfoChip({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div
      className="flex items-center gap-1 px-2 h-6 rounded cursor-default"
      style={{ background: "#1e1e1e", border: "1px solid #2a2a2a" }}
      onClick={onClick}
    >
      <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>{label}</span>
      <span style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const AB_MODES: { value: ABMode; label: string }[] = [
  { value: "reference",       label: "Reference" },
  { value: "my-mix",          label: "My Mix" },
  { value: "matched-preview", label: "Matched Preview" },
];

export function TransportBar() {
  const {
    isPlaying, positionSeconds, bpm, isLoopEnabled,
    abMode, webAudioReady, engineReady,
    play, stop, seek, toggleLoop, setAbMode,
  } = useTransportStore();
  const project = useProjectStore((s) => s.project);

  const [punchIn,  setPunchIn]  = useState(false);
  const [punchOut, setPunchOut] = useState(false);
  const [recMode,  setRecMode]  = useState("Layered");

  const canPlay   = webAudioReady || (project?.tracks.length ?? 0) > 0;
  const barsBeat  = toBarsBeats(positionSeconds, bpm);
  const timecode  = toTimecode(positionSeconds);

  const handleRewind = () => seek(Math.max(0, positionSeconds - 5));
  const handleFF     = () => seek(positionSeconds + 5);
  const handleToStart = () => { stop(); };

  return (
    <div
      className="flex-shrink-0 border-b select-none"
      style={{ background: "#222222", border: "1px solid #2e2e2e" }}
    >
      {/* ── Row 1 — main transport ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5">

        {/* Transport buttons */}
        <div className="flex items-center gap-0.5">
          <TBtn label="⏮" onClick={handleToStart} title="Go to start" />
          <TBtn label="⏪" onClick={handleRewind} title="Rewind 5s" />
          <TBtn label="▶" onClick={() => !isPlaying && play()} active={isPlaying} disabled={!canPlay} title="Play" />
          <TBtn label="■" onClick={() => stop()} title="Stop" />
          <TBtn label="⏩" onClick={handleFF} title="Forward 5s" />
        </div>

        <div style={{ width: 1, height: 20, background: "#333" }} />

        {/* Punch In / Out */}
        <div className="flex items-center gap-0.5">
          <span style={{ fontSize: 9, color: "#555" }}>Punch:</span>
          <PunchBtn label="In"  active={punchIn}  onToggle={() => setPunchIn(v => !v)} />
          <PunchBtn label="Out" active={punchOut} onToggle={() => setPunchOut(v => !v)} />
        </div>

        <div style={{ width: 1, height: 20, background: "#333" }} />

        {/* LED position counters — the heart of the transport */}
        <LedDisplay value={barsBeat} label="Bars|Beats|Ticks" wide />
        <LedDisplay value={timecode} label="Timecode" wide />

        <div style={{ width: 1, height: 20, background: "#333" }} />

        {/* Tempo + TS + Clock */}
        <InfoChip label="♩=" value={formatBpm(bpm)} />
        <InfoChip label="TS:" value={`${project?.time_signature_numerator ?? 4}/${project?.time_signature_denominator ?? 4}`} />
        <InfoChip label="" value="INT/M-Clk" />

        <div className="flex-1" />

        {/* Engine / latency status */}
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 9, color: "#444", fontFamily: "monospace" }}>
            {engineReady ? "I/O Latency: <1 ms" : "Web Audio"}
          </span>
          <span style={{ fontSize: 9, color: "#444", fontFamily: "monospace" }}>PDC: 0</span>
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded"
            style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: webAudioReady ? "#2ecc71" : "#555" }}
            />
            <span style={{ fontSize: 9, color: webAudioReady ? "#2ecc71" : "#555", fontFamily: "monospace" }}>
              {webAudioReady ? "Web Audio" : engineReady ? "Engine" : "No Audio"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Row 2 — sub-controls ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 pb-1.5">
        {/* Internal clock indicator */}
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 px-2 h-5 rounded text-xs"
            style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#666" }}
          >
            <span style={{ fontSize: 9 }}>Int.</span>
          </button>
          <div style={{ width: 48, height: 5, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", left: "40%", top: "50%", transform: "translate(-50%,-50%)", width: 8, height: 8, background: "#4a4a4a", border: "1px solid #333", borderRadius: 1 }} />
          </div>
          <button className="flex items-center px-1.5 h-5 rounded text-xs" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#666", fontSize: 9 }}>VS</button>
          <button className="flex items-center px-1.5 h-5 rounded text-xs" style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#666", fontSize: 9 }}>Stop</button>
        </div>

        <div style={{ width: 1, height: 14, background: "#2a2a2a" }} />

        {/* Rec mode */}
        <div className="flex items-center gap-1">
          <span style={{ fontSize: 9, color: "#555" }}>Rec:</span>
          <select
            value={recMode}
            onChange={(e) => setRecMode(e.target.value)}
            className="h-5 rounded px-1 text-xs appearance-none"
            style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#888", fontSize: 9, cursor: "pointer" }}
          >
            {["Layered", "Non-Layered", "Snd on Snd"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div style={{ width: 1, height: 14, background: "#2a2a2a" }} />

        {/* Loop */}
        <button
          onClick={toggleLoop}
          className="flex items-center px-2 h-5 rounded font-semibold transition-colors"
          style={{
            background: isLoopEnabled ? "#1a3a1a" : "#1e1e1e",
            border: `1px solid ${isLoopEnabled ? "#27ae60" : "#2a2a2a"}`,
            color: isLoopEnabled ? "#2ecc71" : "#666",
            fontSize: 9,
          }}
        >
          LOOP
        </button>

        <div style={{ width: 1, height: 14, background: "#2a2a2a" }} />

        {/* A/B mode selector */}
        <div className="flex items-center gap-1">
          <span style={{ fontSize: 9, color: "#555" }}>A/B</span>
          {AB_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setAbMode(m.value)}
              disabled={m.value === "matched-preview"}
              className="flex items-center px-2 h-5 rounded font-medium transition-colors"
              style={{
                fontSize: 9,
                background: abMode === m.value ? "#1a3a5c" : "#1e1e1e",
                border: `1px solid ${abMode === m.value ? "#4A90D9" : "#2a2a2a"}`,
                color: abMode === m.value ? "#4A90D9" : m.value === "matched-preview" ? "#3a3a3a" : "#666",
                cursor: m.value === "matched-preview" ? "not-allowed" : "pointer",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
