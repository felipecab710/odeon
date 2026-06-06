/**
 * Full Pioneer booth layout — 2× CDJ | DJM-A9 | 2× CDJ
 */
import { useCallback, useMemo } from "react";
import type { CatalogEntry } from "@odeon/shared";
import { useBoothStore } from "../../stores/boothStore";
import {
  patchChannelField,
  toggleChannelFlag,
  setCfAssign,
} from "../../lib/boothInteractive";
import {
  driveClearHotcue,
  driveCueToStart,
  driveJumpHotcue,
  driveSetHotcue,
  driveToggleLoop,
} from "../../lib/boothDriveActions";
import { BoothScale } from "./BoothScale";
import { SchematicCDJ } from "./SchematicCDJ";
import { SchematicDJM, type ChannelHandlers } from "./SchematicDJM";

interface Props {
  entryMap: Map<string, CatalogEntry>;
  interactive?: boolean;
  onCrossfaderChange?: (pos: number) => void;
  getTimelineStart?: (entryId: string) => number;
}

export function BoothTwin({
  entryMap, interactive, onCrossfaderChange, getTimelineStart,
}: Props) {
  const {
    decks, channels, mixer, simulationActive,
    currentTransitionIndex, transitionStrategy, mossReason, playheadSec,
    setInteractiveChannels, patchMixer,
  } = useBoothStore();

  const entryFor = (entryId: string | null) =>
    entryId ? entryMap.get(entryId) ?? null : null;

  const applyChannels = useCallback((next: typeof channels) => {
    setInteractiveChannels(next);
    useBoothStore.getState().setSnapshot({ channels: next });
  }, [setInteractiveChannels]);

  const channelHandlers: ChannelHandlers | undefined = useMemo(() => {
    if (!interactive) return undefined;
    const cf = mixer.crossfaderPos;
    return {
      onTrim: (ch, v) => applyChannels(patchChannelField(channels, ch, "trimDb", v, cf)),
      onEq: (ch, band, v) => applyChannels(patchChannelField(channels, ch, band, v, cf)),
      onFader: (ch, db) => applyChannels(patchChannelField(channels, ch, "faderDb", db, cf)),
      onCue: ch => applyChannels(toggleChannelFlag(channels, ch, "cue", cf)),
      onSolo: ch => applyChannels(toggleChannelFlag(channels, ch, "solo", cf, false)),
      onMute: ch => applyChannels(toggleChannelFlag(channels, ch, "mute", cf, false)),
      onCfAssign: (ch, a) => applyChannels(setCfAssign(channels, ch, a, cf)),
    };
  }, [interactive, channels, mixer.crossfaderPos, applyChannels]);

  const handleCf = useCallback((pos: number) => {
    patchMixer({ crossfaderPos: pos });
    onCrossfaderChange?.(pos);
  }, [patchMixer, onCrossfaderChange]);

  const deckDriveHandlers = useCallback((deckIndex: number) => {
    const deck = decks[deckIndex];
    if (!interactive || !deck.isLoaded || !deck.entryId) {
      return {};
    }
    const timelineStart = getTimelineStart?.(deck.entryId) ?? 0;
    const barSec = deck.bpm > 0 ? (60 / deck.bpm) * 4 : 2;

    return {
      onHotcue: (slot: number, shift: boolean) => {
        if (shift && deck.hotCueSlots[slot]) {
          void driveClearHotcue(deckIndex, slot);
        } else if (deck.hotCueSlots[slot]) {
          void driveJumpHotcue(deckIndex, slot);
        } else {
          void driveSetHotcue(deckIndex, slot, deck.positionSec);
        }
      },
      onCue: () => { void driveCueToStart(deckIndex, timelineStart); },
      onLoopToggle: () => {
        const next = !deck.loopActive;
        const loopIn = deck.positionSec;
        const loopOut = Math.min(deck.durationSec, loopIn + barSec * 4);
        void driveToggleLoop(deckIndex, next, loopIn, loopOut);
      },
    };
  }, [interactive, decks, getTimelineStart]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: "radial-gradient(ellipse at 50% 0%, #141414 0%, #080808 70%)",
      overflow: "hidden",
    }}>
      {/* Status bar */}
      <div style={{
        height: 32, flexShrink: 0, background: "#111", borderBottom: "1px solid #222",
        display: "flex", alignItems: "center", padding: "0 12px", gap: 10, fontSize: 9,
      }}>
        <span style={{ color: simulationActive ? "#4caf50" : "#666", fontWeight: 700 }}>
          {simulationActive ? "● LIVE" : "○ STANDBY"}
        </span>
        {!simulationActive && (
          <span style={{ color: "#555", fontSize: 8 }}>press ▶ to simulate</span>
        )}
        {currentTransitionIndex != null && (
          <span style={{ color: "#6495ed", fontWeight: 600 }}>
            T{currentTransitionIndex + 1}→{currentTransitionIndex + 2}
            {transitionStrategy ? ` · ${transitionStrategy.replace(/_/g, " ")}` : ""}
          </span>
        )}
        {mossReason && (
          <span style={{ color: "#888", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {mossReason}
          </span>
        )}
        <span style={{ color: "#555", marginLeft: "auto" }}>
          {Math.floor(playheadSec / 60)}:{Math.floor(playheadSec % 60).toString().padStart(2, "0")}
        </span>
      </div>

      <BoothScale>
        <SchematicCDJ
          deck={decks[0]} entry={entryFor(decks[0].entryId)} accent="#c8e650"
          timelineStartSec={decks[0].entryId ? getTimelineStart?.(decks[0].entryId) ?? 0 : 0}
          interactive={interactive} {...deckDriveHandlers(0)}
        />
        <SchematicCDJ
          deck={decks[1]} entry={entryFor(decks[1].entryId)} accent="#b39ddb"
          timelineStartSec={decks[1].entryId ? getTimelineStart?.(decks[1].entryId) ?? 0 : 0}
          interactive={interactive} {...deckDriveHandlers(1)}
        />
        <SchematicDJM
          channels={channels}
          mixer={mixer}
          interactive={interactive}
          channelHandlers={channelHandlers}
          onCrossfaderChange={handleCf}
        />
        <SchematicCDJ
          deck={decks[2]} entry={entryFor(decks[2].entryId)} accent="#4fc3f7"
          timelineStartSec={decks[2].entryId ? getTimelineStart?.(decks[2].entryId) ?? 0 : 0}
          interactive={interactive} {...deckDriveHandlers(2)}
        />
        <SchematicCDJ
          deck={decks[3]} entry={entryFor(decks[3].entryId)} accent="#ffab40"
          timelineStartSec={decks[3].entryId ? getTimelineStart?.(decks[3].entryId) ?? 0 : 0}
          interactive={interactive} {...deckDriveHandlers(3)}
        />
      </BoothScale>
    </div>
  );
}
