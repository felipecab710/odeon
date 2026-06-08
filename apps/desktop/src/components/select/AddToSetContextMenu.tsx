import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CatalogEntry } from "@odeon/shared";
import { useSetBuilderStore } from "../../stores/setBuilderStore";

interface AddToSetContextMenuProps {
  x: number;
  y: number;
  entry: CatalogEntry;
  onClose: () => void;
}

function displayTitle(entry: CatalogEntry): string {
  if (entry.title) return entry.title;
  const name = entry.file_name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8;
  const maxX = window.innerWidth - width - margin;
  const maxY = window.innerHeight - height - margin;
  return {
    left: Math.max(margin, Math.min(x, maxX)),
    top: Math.max(margin, Math.min(y, maxY)),
  };
}

export function AddToSetContextMenu({ x, y, entry, onClose }: AddToSetContextMenuProps) {
  const sets = useSetBuilderStore(s => s.sets);
  const addCard = useSetBuilderStore(s => s.addCard);
  const createSet = useSetBuilderStore(s => s.createSet);
  const isEntryInSet = useSetBuilderStore(s => s.isEntryInSet);
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Defer dismiss listeners so the opening right-click doesn't instantly close the menu.
    const timer = window.setTimeout(() => {
      const onMouseDown = (e: MouseEvent) => {
        const menu = menuRef.current;
        if (menu?.contains(e.target as Node)) return;
        onCloseRef.current();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onCloseRef.current();
      };
      const onScroll = () => onCloseRef.current();

      window.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("scroll", onScroll, true);

      cleanup = () => {
        window.removeEventListener("mousedown", onMouseDown, true);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, 0);

    let cleanup: (() => void) | undefined;
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [entry.id]);

  const title = displayTitle(entry);
  const pos = clampMenuPosition(x, y, 240, 220);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 25000,
        background: "#2e2e2e",
        border: "1px solid #1a1a1a",
        borderRadius: 4,
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        minWidth: 200,
        maxWidth: 280,
        padding: "4px 0",
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <div style={{
        padding: "6px 12px 2px",
        fontSize: 10,
        fontWeight: 700,
        color: "#888",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>
        Add to set
      </div>
      <div style={{
        padding: "0 12px 6px",
        fontSize: 11,
        color: "#aaa",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        borderBottom: "1px solid #3a3a3a",
        marginBottom: 4,
      }}>
        {title}
      </div>

      {sets.map(userSet => {
        const inSet = isEntryInSet(entry.id, userSet.id);
        return (
          <button
            key={userSet.id}
            type="button"
            disabled={inSet}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              addCard(entry.id, userSet.id);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 12px",
              border: "none",
              background: "transparent",
              color: inSet ? "#555" : "#ddd",
              fontSize: 12,
              textAlign: "left",
              cursor: inSet ? "default" : "pointer",
            }}
            onMouseEnter={e => {
              if (!inSet) (e.currentTarget as HTMLButtonElement).style.background = "#383838";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userSet.name}
            </span>
            <span style={{ fontSize: 10, color: "#666", flexShrink: 0 }}>
              {userSet.cards.length}
            </span>
            {inSet && <span style={{ fontSize: 10, color: "#00c3ff", flexShrink: 0 }}>✓</span>}
          </button>
        );
      })}

      <div style={{ borderTop: "1px solid #3a3a3a", marginTop: 4, paddingTop: 4 }}>
        <button
          type="button"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            const setId = createSet();
            addCard(entry.id, setId);
            onClose();
          }}
          style={{
            display: "block",
            width: "100%",
            padding: "6px 12px",
            border: "none",
            background: "transparent",
            color: "#00c3ff",
            fontSize: 12,
            textAlign: "left",
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "#383838";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          + New Set…
        </button>
      </div>
    </div>,
    document.body,
  );
}
