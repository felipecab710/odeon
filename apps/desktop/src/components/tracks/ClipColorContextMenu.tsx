import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CLIP_COLOR_PRESETS } from "../../lib/clipColorPresets";

export interface ClipColorMenuState {
  x: number;
  y: number;
  trackId: string;
}

interface ClipColorContextMenuProps {
  menu: ClipColorMenuState | null;
  currentColor: string;
  onSelect: (trackId: string, color: string) => void;
  onClose: () => void;
}

export function ClipColorContextMenu({
  menu,
  currentColor,
  onSelect,
  onClose,
}: ClipColorContextMenuProps) {
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 25000,
        background: "#2e2e2e",
        border: "1px solid #1a1a1a",
        borderRadius: 2,
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        padding: "6px 8px",
        minWidth: 120,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{
        fontSize: 9, fontWeight: 600, color: "#888",
        textTransform: "uppercase", letterSpacing: 0.6,
        marginBottom: 6, paddingLeft: 2,
      }}>
        Clip Color
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {CLIP_COLOR_PRESETS.map((preset) => {
          const active = preset.color.toLowerCase() === currentColor.toLowerCase();
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onSelect(menu.trackId, preset.color);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "4px 6px",
                border: active ? "1px solid #888" : "1px solid transparent",
                borderRadius: 3,
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{
                width: 28,
                height: 14,
                borderRadius: 2,
                border: "1px solid rgba(0,0,0,0.5)",
                background: preset.color,
                flexShrink: 0,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
              }} />
              <span style={{ fontSize: 11, color: "#e0e0e0" }}>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
