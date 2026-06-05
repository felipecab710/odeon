import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { GROUP_COL_W } from "../../lib/timelineUtils";
import { useTrackGroupStore } from "../../stores/trackGroupStore";
import type { GroupDragPreview } from "../../stores/trackGroupStore";

export const MIXER_GROUP_ROW_H = GROUP_COL_W;

export interface MixerChannelLayout {
  id: string;
  left: number;
  width: number;
}

interface ContextMenu {
  x: number;
  y: number;
  groupId: string;
}

const GROUP_PILL_INSET = 4;
const MIN_DRAG_PX = 6;

function xInStrip(clientX: number, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  return clientX - rect.left;
}

function columnsOverlappingRange(cols: MixerChannelLayout[], left: number, right: number): MixerChannelLayout[] {
  return cols.filter((c) => c.left < right && c.left + c.width > left);
}

function snapRangeToChannels(cols: MixerChannelLayout[], left: number, right: number) {
  const overlapping = columnsOverlappingRange(cols, left, right);
  if (!overlapping.length) return null;
  const snapLeft = Math.min(...overlapping.map((c) => c.left));
  const snapRight = Math.max(...overlapping.map((c) => c.left + c.width));
  return {
    trackIds: overlapping.map((c) => c.id),
    left: snapLeft,
    width: snapRight - snapLeft,
  };
}

function previewRect(preview: GroupDragPreview) {
  const left = Math.min(preview.start, preview.current);
  const width = Math.abs(preview.current - preview.start);
  return { left, width: Math.max(width, 1) };
}

export function MixerGroupStrip({
  columns,
  width,
}: {
  columns: MixerChannelLayout[];
  width: number;
}) {
  const groups = useTrackGroupStore((s) => s.groups);
  const dragPreview = useTrackGroupStore((s) => s.dragPreview);
  const createGroup = useTrackGroupStore((s) => s.createGroup);
  const setDragPreview = useTrackGroupStore((s) => s.setDragPreview);
  const openEditDialog = useTrackGroupStore((s) => s.openEditDialog);

  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const clampX = useCallback((x: number) => Math.max(0, Math.min(width, x)), [width]);

  const handleStripMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !columns.length) return;
    e.preventDefault();
    e.stopPropagation();

    const el = stripRef.current;
    if (!el) return;

    const startX = clampX(xInStrip(e.clientX, el));
    dragging.current = true;
    dragStartX.current = startX;
    setDragPreview({ axis: "x", start: startX, current: startX });

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !stripRef.current) return;
      const cx = clampX(xInStrip(ev.clientX, stripRef.current));
      setDragPreview({ axis: "x", start: dragStartX.current, current: cx });
    };

    const onUp = (ev: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;

      const el = stripRef.current;
      const endX = el ? clampX(xInStrip(ev.clientX, el)) : dragStartX.current;
      setDragPreview(null);

      const { left, width: w } = previewRect({ axis: "x", start: dragStartX.current, current: endX });
      if (w < MIN_DRAG_PX) {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        return;
      }

      const snapped = snapRangeToChannels(columns, left, left + w);
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

  const livePreview =
    dragPreview?.axis === "x" ? previewRect(dragPreview) : null;

  const groupSpans = groups.map((g) => {
    const memberCols = columns.filter((c) => g.trackIds.includes(c.id));
    if (!memberCols.length) return null;
    const left = Math.min(...memberCols.map((c) => c.left));
    const right = Math.max(...memberCols.map((c) => c.left + c.width));
    return { group: g, left, width: right - left };
  }).filter(Boolean) as { group: typeof groups[0]; left: number; width: number }[];

  const pillStyle = (left: number, w: number, color: string, active: boolean): CSSProperties => ({
    position: "absolute",
    top: GROUP_PILL_INSET,
    bottom: GROUP_PILL_INSET,
    left,
    width: w,
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
        ref={stripRef}
        className="relative flex-shrink-0"
        style={{
          width,
          height: MIXER_GROUP_ROW_H,
          background: "#000",
          borderBottom: "1px solid #2a2a2a",
          boxShadow: "0 1px 0 #3a3a3a",
          cursor: "crosshair",
        }}
        onMouseDown={handleStripMouseDown}
        title="Drag to create a mixer group"
      >
        {livePreview && livePreview.width >= 1 && (
          <div
            className="pointer-events-none flex items-center justify-center"
            style={{
              ...pillStyle(livePreview.left, livePreview.width, "#E8A598", true),
              zIndex: 3,
              opacity: 0.75,
            }}
          />
        )}

        {groupSpans.map(({ group, left, width: w }) => (
          <div
            key={group.id}
            className="flex items-center justify-center select-none"
            style={{
              ...pillStyle(left, w, group.color, group.active),
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
