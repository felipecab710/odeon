import { ABLETON_CLIP_PALETTE_ROWS } from "../../lib/abletonClipPalette";

interface Props {
  x: number;
  y: number;
  currentColor?: string;
  onPick: (color: string) => void;
  onClose: () => void;
}

export function ClipColorMenu({ x, y, currentColor, onPick, onClose }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 1100,
        background: "#1a1a1a",
        border: "1px solid #444",
        borderRadius: 4,
        padding: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, color: "#888", marginBottom: 4, paddingLeft: 2 }}>
        Clip colour
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {ABLETON_CLIP_PALETTE_ROWS.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 2 }}>
            {row.map(color => {
              const selected =
                currentColor?.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => {
                    onPick(color);
                    onClose();
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    padding: 0,
                    border: selected
                      ? "2px solid #fff"
                      : "1px solid rgba(0,0,0,0.45)",
                    borderRadius: 2,
                    background: color,
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
