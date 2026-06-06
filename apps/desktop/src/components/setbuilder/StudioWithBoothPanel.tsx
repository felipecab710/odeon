/**
 * Studio split view — timeline editor on top, resizable Pioneer booth mirror at bottom.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { SetCard } from "../../stores/setBuilderStore";
import type { FlowEdge } from "../../lib/apiClient";
import { beginVerticalResize } from "../../lib/domResize";
import { TransitionArrangementView } from "./TransitionArrangementView";
import { BoothStrip } from "../booth/BoothStrip";
import { useBoothSimulation } from "../../hooks/useBoothSimulation";

const MIN_BOOTH_H = 100;
const DEFAULT_BOOTH_H = 300;
const STORAGE_H = "odeon-studio-booth-height";
const STORAGE_COLLAPSED = "odeon-studio-booth-collapsed";

interface Props {
  sorted: SetCard[];
  entryMap: Map<string, CatalogEntry>;
  flowEdges: FlowEdge[];
  transitionIndex: number;
  onSelectTransition: (index: number) => void;
}

function readStoredHeight(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_H));
    return Number.isFinite(v) && v >= MIN_BOOTH_H ? v : DEFAULT_BOOTH_H;
  } catch {
    return DEFAULT_BOOTH_H;
  }
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_COLLAPSED) === "1";
  } catch {
    return false;
  }
}

export function StudioWithBoothPanel({
  sorted,
  entryMap,
  flowEdges,
  transitionIndex,
  onSelectTransition,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boothShellRef = useRef<HTMLDivElement>(null);
  const [boothHeight, setBoothHeight] = useState(readStoredHeight);
  const [boothCollapsed, setBoothCollapsed] = useState(readStoredCollapsed);

  // Shared playhead loop — keeps Studio timeline and Pioneer booth in sync.
  useBoothSimulation(sorted.length >= 2, sorted, entryMap, {
    driveEngine: true,
    engineRoute: "set",
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_COLLAPSED, boothCollapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [boothCollapsed]);

  const toggleBooth = useCallback(() => setBoothCollapsed(v => !v), []);

  const maxBoothHeight = useCallback(() => {
    const el = containerRef.current;
    if (!el) return window.innerHeight * 0.85;
    return Math.max(MIN_BOOTH_H, el.clientHeight - 80);
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = boothShellRef.current;
    if (!el) return;

    const startSize = el.getBoundingClientRect().height;
    const maxH = maxBoothHeight();

    beginVerticalResize({
      startY: e.clientY,
      startSize,
      min: MIN_BOOTH_H,
      max: maxH,
      el,
      onCommit: (final) => {
        setBoothHeight(final);
        try { localStorage.setItem(STORAGE_H, String(final)); } catch { /* ignore */ }
      },
    });
  }, [maxBoothHeight]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <TransitionArrangementView
          sorted={sorted}
          entryMap={entryMap}
          flowEdges={flowEdges}
          transitionIndex={transitionIndex}
          onSelectTransition={onSelectTransition}
          boothVisible={!boothCollapsed}
          onToggleBooth={toggleBooth}
        />
      </div>

      {!boothCollapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Pioneer booth"
          onMouseDown={startResize}
          style={{
            height: 8,
            flexShrink: 0,
            cursor: "ns-resize",
            touchAction: "none",
            background: "linear-gradient(180deg, transparent 0%, #2a2a2a 40%, #3a3a3a 50%, #2a2a2a 60%, transparent 100%)",
            borderTop: "1px solid #333",
            borderBottom: "1px solid #1a1a1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}
        >
          <div style={{ width: 40, height: 3, borderRadius: 2, background: "#555", pointerEvents: "none" }} />
        </div>
      )}

      <div
        ref={boothShellRef}
        style={{
          height: boothCollapsed ? undefined : boothHeight,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minHeight: 0,
          willChange: boothCollapsed ? undefined : "height",
        }}
      >
        <BoothStrip
          sorted={sorted}
          entryMap={entryMap}
          transitionIndex={transitionIndex}
          fillParent={!boothCollapsed}
          collapsed={boothCollapsed}
          onToggleCollapse={toggleBooth}
        />
      </div>
    </div>
  );
}
