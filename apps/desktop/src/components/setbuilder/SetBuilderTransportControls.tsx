/**
 * Compact Studio-style transport — play, pause, stop, loop + time counter.
 * Lives in the Set Builder top bar next to the view-mode tabs.
 */
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { useTransportStore } from "../../stores/transportStore";
import { computeSetLayout, formatTimeline } from "./setTimelineLayout";

const PILL_BG = "#111";
const PILL_BORDER = "#2a2a2a";
const ICON = "#b0b0b0";
const PLAY_TRI = "#c8c8c8";
const RECORD = "#e04545";
const TEXT = "#e0e0e0";
const ICON_SIZE = 24;

function IconBtn({
  title,
  onClick,
  disabled,
  children,
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

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  engineSyncing: boolean;
  syncError: string | null;
}

export function SetBuilderTransportControls({
  sorted,
  entryMap,
  engineSyncing,
  syncError,
}: Props) {
  const isPlaying = useTransportStore(s => s.isPlaying);
  const playheadSec = useTransportStore(s => s.positionSeconds);
  const isLoopEnabled = useTransportStore(s => s.isLoopEnabled);
  const engineTracksReady = useTransportStore(s => s.engineTracksReady);
  const engineReady = useTransportStore(s => s.engineReady);
  const play = useTransportStore(s => s.play);
  const pause = useTransportStore(s => s.pause);
  const stop = useTransportStore(s => s.stop);
  const toggleLoop = useTransportStore(s => s.toggleLoop);

  const layout = computeSetLayout(sorted, entryMap);
  const totalSec = layout.totalSec;
  const canPlay = engineReady && engineTracksReady && !engineSyncing && !syncError && sorted.length >= 2;

  const disabledTitle =
    syncError ??
    (engineSyncing ? "Loading tracks…" : !engineReady ? "Audio engine not running" : "Engine not ready");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 8px",
        borderRadius: 5,
        background: PILL_BG,
        border: `1px solid ${PILL_BORDER}`,
      }}
    >
      <IconBtn title="Return to start" onClick={() => void stop()}>
        <span style={{ fontSize: 11, color: ICON, lineHeight: 1 }}>|◀</span>
      </IconBtn>

      {isPlaying ? (
        <IconBtn title="Pause (Space)" onClick={() => void pause()}>
          <div style={{ display: "flex", gap: 2 }}>
            <div style={{ width: 3, height: 10, background: PLAY_TRI, borderRadius: 1 }} />
            <div style={{ width: 3, height: 10, background: PLAY_TRI, borderRadius: 1 }} />
          </div>
        </IconBtn>
      ) : (
        <IconBtn
          title={canPlay ? "Play (Space)" : disabledTitle}
          onClick={() => canPlay && void play()}
          disabled={!canPlay}
        >
          <div
            style={{
              width: 0,
              height: 0,
              marginLeft: 2,
              borderTop: "6px solid transparent",
              borderBottom: "6px solid transparent",
              borderLeft: `9px solid ${canPlay ? PLAY_TRI : "#555"}`,
            }}
          />
        </IconBtn>
      )}

      <IconBtn title="Stop" onClick={() => void stop()}>
        <div style={{ width: 10, height: 10, background: ICON, borderRadius: 1 }} />
      </IconBtn>

      <IconBtn title="Record (coming soon)" disabled>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: RECORD, opacity: 0.45 }} />
      </IconBtn>

      <IconBtn title="Loop" onClick={toggleLoop}>
        <span style={{ fontSize: 13, color: isLoopEnabled ? TEXT : ICON, lineHeight: 1 }}>↻</span>
      </IconBtn>

      <div style={{ width: 1, height: 16, background: PILL_BORDER, flexShrink: 0 }} />

      <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        <span style={{ color: "#ffeb3b", fontWeight: 700 }}>{formatTimeline(playheadSec)}</span>
        <span style={{ color: "#666" }}> / {formatTimeline(totalSec)}</span>
      </span>

      {engineSyncing && !syncError && (
        <span style={{ fontSize: 9, color: "#888" }}>Loading…</span>
      )}
      {syncError && (
        <span
          style={{
            fontSize: 9,
            color: "#f44336",
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={syncError}
        >
          {syncError}
        </span>
      )}
    </div>
  );
}
