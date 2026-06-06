/**
 * Horizontally resizable right sidebar — imperative drag, no per-frame React updates.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { beginHorizontalResize } from "../../lib/domResize";

const DEFAULT_W = 270;
const MIN_W = 200;
const MAX_W = 560;
const STORAGE_KEY = "odeon-right-panel-width";

function readStoredWidth(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W;
  } catch {
    return DEFAULT_W;
  }
}

interface Props {
  children: ReactNode;
}

export function ResizableRightSidebar({ children }: Props) {
  const [width, setWidth] = useState(readStoredWidth);
  const asideRef = useRef<HTMLElement>(null);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = asideRef.current;
    if (!el) return;

    const startSize = el.getBoundingClientRect().width;

    beginHorizontalResize({
      startX: e.clientX,
      startSize,
      min: MIN_W,
      max: MAX_W,
      el,
      onCommit: (final) => {
        setWidth(final);
        try { localStorage.setItem(STORAGE_KEY, String(final)); } catch { /* ignore */ }
      },
    });
  }, []);

  return (
    <div style={{
      display: "flex",
      flexShrink: 0,
      height: "100%",
      maxWidth: "55%",
    }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        onMouseDown={startResize}
        style={{
          width: 8,
          flexShrink: 0,
          cursor: "ew-resize",
          touchAction: "none",
          background: "linear-gradient(90deg, transparent 0%, #2a2a2a 40%, #3a3a3a 50%, #2a2a2a 60%, transparent 100%)",
          borderLeft: "1px solid #333",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 3, height: 40, borderRadius: 2, background: "#555", pointerEvents: "none" }} />
      </div>

      <aside
        ref={asideRef}
        style={{
          width,
          minWidth: MIN_W,
          maxWidth: MAX_W,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#1a1a1a",
          borderLeft: "1px solid #2a2a2a",
          willChange: "width",
        }}
      >
        {children}
      </aside>
    </div>
  );
}
