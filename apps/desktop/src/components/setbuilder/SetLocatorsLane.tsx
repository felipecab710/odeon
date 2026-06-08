/**
 * Ableton-style locator flags on the arrangement timeline ruler.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { SetLocator } from "../../stores/setLocatorStore";
import { beginUndoGesture, endUndoGesture } from "../../stores/undoStore";

interface Props {
  locators: SetLocator[];
  pixelsPerSecond: number;
  totalSec: number;
  rulerHeight: number;
  selectedId: string | null;
  renamingId: string | null;
  keyMapMode: boolean;
  onSelect: (id: string) => void;
  onSeek: (timeSec: number) => void;
  onMove: (id: string, timeSec: number) => void;
  onRename: (id: string, name: string) => void;
  onContextMenu: (id: string | null, x: number, y: number, timeSec: number) => void;
  onAssignKey?: (id: string) => void;
  onCancelRenaming?: () => void;
}

export const SetLocatorsLane = memo(function SetLocatorsLane({
  locators,
  pixelsPerSecond,
  totalSec,
  rulerHeight,
  selectedId,
  renamingId,
  keyMapMode,
  onSelect,
  onSeek,
  onMove,
  onRename,
  onContextMenu,
  onAssignKey,
  onCancelRenaming,
}: Props) {
  const dragRef = useRef<{ id: string; startX: number; startSec: number } | null>(null);
  const skipClickRef = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || pixelsPerSecond <= 0) return;
    if (Math.abs(e.clientX - drag.startX) > 3) skipClickRef.current = true;
    const deltaSec = (e.clientX - drag.startX) / pixelsPerSecond;
    const next = Math.max(0, Math.min(totalSec, drag.startSec + deltaSec));
    onMove(drag.id, next);
  }, [pixelsPerSecond, totalSec, onMove]);

  const onPointerUp = useCallback(() => {
    if (dragRef.current) endUndoGesture();
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (!skipClickRef.current) return;
    window.setTimeout(() => { skipClickRef.current = false; }, 0);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  return (
    <>
      {locators.map((loc) => {
        const left = loc.timeSec * pixelsPerSecond;
        const selected = loc.id === selectedId;
        const renaming = loc.id === renamingId;
        return (
          <div
            key={loc.id}
            style={{
              position: "absolute",
              left,
              top: 0,
              zIndex: 24,
              pointerEvents: "auto",
              cursor: keyMapMode ? "crosshair" : "ew-resize",
            }}
            onPointerDown={e => {
              if (renaming || keyMapMode) return;
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              skipClickRef.current = false;
              beginUndoGesture();
              dragRef.current = { id: loc.id, startX: e.clientX, startSec: loc.timeSec };
              onSelect(loc.id);
              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", onPointerUp);
            }}
            onClick={e => {
              e.stopPropagation();
              if (skipClickRef.current) return;
              if (keyMapMode) {
                onAssignKey?.(loc.id);
                return;
              }
              onSeek(loc.timeSec);
            }}
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(loc.id, e.clientX, e.clientY, loc.timeSec);
            }}
          >
            <div style={{
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: `10px solid ${selected ? "#5ec8e8" : "#c8c850"}`,
              marginLeft: -5,
            }} />
            {renaming ? (
              <RenameInput
                initial={loc.name}
                onCommit={name => onRename(loc.id, name)}
                onCancel={() => onCancelRenaming?.()}
              />
            ) : (
              <span style={{
                position: "absolute",
                left: 6,
                top: 2,
                fontSize: 8,
                fontWeight: 700,
                color: selected ? "#5ec8e8" : "#ddd",
                whiteSpace: "nowrap",
                userSelect: "none",
                textShadow: "0 1px 2px rgba(0,0,0,0.8)",
              }}>
                {loc.name}
                {loc.keyBinding ? ` [${loc.keyBinding}]` : ""}
              </span>
            )}
            <div style={{
              position: "absolute",
              left: 0,
              top: rulerHeight,
              width: 1,
              height: 2000,
              background: selected ? "rgba(94,200,232,0.35)" : "rgba(200,200,80,0.2)",
              pointerEvents: "none",
            }} />
          </div>
        );
      })}
    </>
  );
});

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") onCommit(value.trim() || initial);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onCommit(value.trim() || initial)}
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 6,
        top: 0,
        width: 100,
        fontSize: 9,
        fontWeight: 700,
        background: "#222",
        border: "1px solid #5ec8e8",
        color: "#fff",
        borderRadius: 2,
        padding: "1px 4px",
      }}
    />
  );
}
