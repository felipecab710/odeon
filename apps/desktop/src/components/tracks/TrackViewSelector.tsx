import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TRACK_VIEW_OPTIONS,
  trackViewLabel,
  type TrackViewMode,
} from "../../lib/trackView";

const MENU_BG      = "#2e2e2e";
const MENU_HILITE  = "#4a4a4a";
const MENU_HOVER   = "#3a3a3a";
const MENU_BORDER  = "#1a1a1a";
const MENU_TEXT    = "#e0e0e0";
const MENU_MUTED   = "#666";
const MENU_Z       = 10000;

function MenuItem({
  label, selected, disabled, onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onSelect(); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "4px 8px",
        border: "none",
        background: selected ? MENU_HILITE : "transparent",
        color: disabled ? MENU_MUTED : MENU_TEXT,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
        borderRadius: 0,
      }}
      onMouseEnter={(e) => {
        if (!selected && !disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = MENU_HOVER;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = selected ? MENU_HILITE : "transparent";
      }}
    >
      <span style={{ width: 12, fontSize: 10, flexShrink: 0, color: MENU_TEXT }}>
        {selected ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

export function TrackViewSelector({
  mode,
  onChange,
}: {
  mode: TrackViewMode;
  onChange: (mode: TrackViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 140 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(140, rect.width),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePosition();

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, updatePosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: menuPos.top,
        left: menuPos.left,
        minWidth: menuPos.width,
        zIndex: MENU_Z,
        background: MENU_BG,
        border: `1px solid ${MENU_BORDER}`,
        borderRadius: 1,
        boxShadow: "0 6px 20px rgba(0,0,0,0.65)",
        padding: "2px 0",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {TRACK_VIEW_OPTIONS.map((opt) => (
        <MenuItem
          key={opt.id}
          label={opt.label}
          selected={mode === opt.id}
          disabled={opt.disabled}
          onSelect={() => {
            onChange(opt.id);
            setOpen(false);
          }}
        />
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Track view"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          height: 20,
          padding: "0 5px",
          border: "1px solid #3a3a3a",
          borderRadius: 1,
          background: open ? "#333" : "#2a2a2a",
          color: MENU_TEXT,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "system-ui, sans-serif",
          cursor: "pointer",
          textTransform: "lowercase",
        }}
      >
        <span className="truncate">{trackViewLabel(mode)}</span>
        <span style={{ fontSize: 7, color: MENU_MUTED, flexShrink: 0, marginLeft: 4 }}>▼</span>
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
