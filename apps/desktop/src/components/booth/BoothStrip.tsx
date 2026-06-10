/**
 * Compact Pioneer booth strip — embedded under the Studio timeline.
 * Visual mirror only (audio stays on useSetEngineSync in TransitionArrangementView).
 */
import { useCallback, useEffect, useMemo } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import { useBoothStore } from "../../stores/boothStore";
import { BoothTwin } from "./BoothTwin";
import { computeSetLayout } from "../setbuilder/setTimelineLayout";

const COLLAPSED_BAR_H = 28;

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  transitionIndex: number;
  /** Parent shell controls height (resize drag). */
  fillParent?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function BoothStrip({
  sorted,
  entryMap,
  transitionIndex: _transitionIndex,
  fillParent = false,
  collapsed = false,
  onToggleCollapse,
}: Props) {
  const currentTransitionIndex = useBoothStore(s => s.currentTransitionIndex);
  const setMode = useBoothStore(s => s.setMode);
  const setInteractiveChannels = useBoothStore(s => s.setInteractiveChannels);

  useEffect(() => {
    setMode("simulation");
    setInteractiveChannels(null);
  }, [setMode, setInteractiveChannels]);

  const layout = useMemo(() => computeSetLayout(sorted, entryMap), [sorted, entryMap]);

  const getTimelineStart = useCallback((entryId: string) => {
    const lane = layout.lanes.find(l => l.card.entryId === entryId);
    return lane?.startSec ?? 0;
  }, [layout]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        title="Show Pioneer Booth"
        style={{
          height: COLLAPSED_BAR_H,
          flexShrink: 0,
          width: "100%",
          background: "#141414",
          borderTop: "1px solid #2a2a2a",
          borderBottom: "none",
          borderLeft: "none",
          borderRight: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer",
          zIndex: 15,
          padding: 0,
        }}
      >
        <span style={{ color: "#fff", fontSize: 10, fontWeight: 500 }}>
          ▲ Show Pioneer Booth
        </span>
        {currentTransitionIndex != null && (
          <span style={{ color: "#888", fontSize: 9 }}>
            · T{currentTransitionIndex + 1}→{currentTransitionIndex + 2}
          </span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      height: fillParent ? "100%" : undefined,
      flex: fillParent ? 1 : undefined,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      borderTop: "2px solid #2a2a2a",
      background: "#0a0a0a",
      overflow: "hidden",
      zIndex: 10,
      minHeight: 0,
    }}>
      <div style={{
        height: 26,
        flexShrink: 0,
        background: "#141414",
        borderBottom: "1px solid #222",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 10,
      }}>
        <span style={{ color: "#fff", fontSize: 10, fontWeight: 500 }}>
          Pioneer Booth
        </span>
        <span style={{ color: "#888", fontSize: 9 }}>
          Drag Handle Above to Resize
        </span>
        {currentTransitionIndex != null && (
          <span style={{ color: "#888", fontSize: 9 }}>
            T{currentTransitionIndex + 1}→{currentTransitionIndex + 2}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Hide Pioneer Booth"
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 3,
            color: "#fff",
            fontSize: 9,
            fontWeight: 500,
            padding: "3px 6px",
            cursor: "pointer",
          }}
        >
          ▼ Hide
        </button>
      </div>

      <BoothTwin
        entryMap={entryMap}
        interactive={false}
        compact
        getTimelineStart={getTimelineStart}
      />
    </div>
  );
}
