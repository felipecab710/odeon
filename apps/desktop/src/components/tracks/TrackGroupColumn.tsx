import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { GROUP_COL_W } from "../../lib/timelineUtils";
import { useTrackGroupStore } from "../../stores/trackGroupStore";
import type { GroupDragPreview } from "../../stores/trackGroupStore";

export interface TrackRowLayout {
  id: string;
  top: number;
  height: number;
}

interface ContextMenu {
  x: number;
  y: number;
  groupId: string;
}

const GROUP_PILL_INSET = 4;
const MIN_DRAG_PX = 6;

function yInColumn(clientY: number, colEl: HTMLElement): number {
  const rect = colEl.getBoundingClientRect();
  return clientY - rect.top;
}

function rowsOverlappingRange(rows: TrackRowLayout[], top: number, bottom: number): TrackRowLayout[] {
  return rows.filter((r) => r.top < bottom && r.top + r.height > top);
}

function snapRangeToTracks(rows: TrackRowLayout[], top: number, bottom: number) {
  const overlapping = rowsOverlappingRange(rows, top, bottom);
  if (!overlapping.length) return null;
  const snapTop = Math.min(...overlapping.map((r) => r.top));
  const snapBottom = Math.max(...overlapping.map((r) => r.top + r.height));
  return {
    trackIds: overlapping.map((r) => r.id),
    top: snapTop,
    height: snapBottom - snapTop,
  };
}

function previewRect(preview: GroupDragPreview) {
  const top = Math.min(preview.start, preview.current);
  const height = Math.abs(preview.current - preview.start);
  return { top, height: Math.max(height, 1) };
}

export function TrackGroupColumn({
  rows,
  height,
  trackAreaHeight,
}: {
  rows: TrackRowLayout[];
  height: number;
  trackAreaHeight: number;
}) {
  const groups = useTrackGroupStore((s) => s.groups);
  const dragPreview = useTrackGroupStore((s) => s.dragPreview);
  const createGroup = useTrackGroupStore((s) => s.createGroup);
  const setDragPreview = useTrackGroupStore((s) => s.setDragPreview);
  const openEditDialog = useTrackGroupStore((s) => s.openEditDialog);

  const colRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const clampY = useCallback((y: number) => {
    return Math.max(0, Math.min(trackAreaHeight, y));
  }, [trackAreaHeight]);

  const handleStripMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !rows.length) return;
    e.preventDefault();
    e.stopPropagation();

    const col = colRef.current;
    if (!col) return;

    const startY = clampY(yInColumn(e.clientY, col));
    dragging.current = true;
    dragStartY.current = startY;
    setDragPreview({ axis: "y", start: startY, current: startY });

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !colRef.current) return;
      const cy = clampY(yInColumn(ev.clientY, colRef.current));
      setDragPreview({ axis: "y", start: dragStartY.current, current: cy });
    };

    const onUp = (ev: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;

      const col = colRef.current;
      const endY = col ? clampY(yInColumn(ev.clientY, col)) : dragStartY.current;
      setDragPreview(null);

      const { top, height: h } = previewRect({ axis: "y", start: dragStartY.current, current: endY });
      if (h < MIN_DRAG_PX) {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        return;
      }

      const snapped = snapRangeToTracks(rows, top, top + h);
      if (snapped && snapped.trackIds.length > 0) {
        const groupId = createGroup(snapped.trackIds);
        if (groupId) openEditDialog(groupId);
      }

      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleGroupContextMenu = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, groupId });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const livePreview = dragPreview?.axis === "y" ? previewRect(dragPreview) : null;

  const groupSpans = groups.map((g) => {
    const memberRows = rows.filter((r) => g.trackIds.includes(r.id));
    if (!memberRows.length) return null;
    const top = Math.min(...memberRows.map((r) => r.top));
    const bottom = Math.max(...memberRows.map((r) => r.top + r.height));
    return { group: g, top, height: bottom - top };
  }).filter(Boolean) as { group: typeof groups[0]; top: number; height: number }[];

  const pillStyle = (top: number, h: number, color: string, active: boolean): CSSProperties => ({
    position: "absolute",
    left: GROUP_PILL_INSET,
    right: GROUP_PILL_INSET,
    top,
    height: h,
    background: active ? color : `${color}88`,
    borderRadius: 4,
    border: "1px solid rgba(0,0,0,0.35)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
    opacity: active ? 1 : 0.6,
    pointerEvents: "auto",
  });

  return (
    <>
      <div
        ref={colRef}
        className="relative flex-shrink-0"
        style={{
          width: GROUP_COL_W,
          height,
          background: "#000",
          borderRight: "1px solid #2a2a2a",
          boxShadow: "1px 0 0 #3a3a3a",
          cursor: "crosshair",
        }}
        onMouseDown={handleStripMouseDown}
        title="Drag to create a track group"
      >
        {/* Live drag preview — follows cursor pixel-for-pixel */}
        {livePreview && livePreview.height >= 1 && (
          <div
            className="pointer-events-none"
            style={{
              ...pillStyle(livePreview.top, livePreview.height, "#E8A598", true),
              zIndex: 3,
              opacity: 0.75,
            }}
          />
        )}

        {/* Committed group pills — snapped to track bounds */}
        {groupSpans.map(({ group, top, height: h }) => (
          <div
            key={group.id}
            className="flex items-center justify-center select-none"
            style={{
              ...pillStyle(top, h, group.color, group.active),
              zIndex: 4,
              cursor: "context-menu",
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
            onDoubleClick={() => openEditDialog(group.id)}
            title={`Group ${group.name} — right-click to edit`}
          >
            <span
              style={{
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                transform: "rotate(180deg)",
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(255,255,255,0.85)",
                letterSpacing: 0.5,
                userSelect: "none",
                textShadow: "0 1px 1px rgba(0,0,0,0.4)",
              }}
            >
              {group.name}
            </span>
          </div>
        ))}
      </div>

      {contextMenu && createPortal(
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 25000,
            background: "#2e2e2e",
            border: "1px solid #1a1a1a",
            borderRadius: 2,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            minWidth: 140,
            padding: "4px 0",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              openEditDialog(contextMenu.groupId);
              setContextMenu(null);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: "5px 12px",
              border: "none",
              background: "transparent",
              color: "#e0e0e0",
              fontSize: 11,
              textAlign: "left",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#3a3a3a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            Edit Group…
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
