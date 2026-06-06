/** Scale the full Pioneer booth to fit the viewport while preserving pixel layout. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FIGMA_CDJ_SIZE } from "./figmaCdjAssets";
import { DJM_WIDTH } from "./SchematicDJM";

const BOOTH_NATURAL_WIDTH = FIGMA_CDJ_SIZE.width * 4 + DJM_WIDTH; // 4× CDJ + DJM-V10
export const BOOTH_FACEPLATE_HEIGHT = FIGMA_CDJ_SIZE.height;

export function BoothScale({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width - 24;
      setScale(Math.min(1, w / BOOTH_NATURAL_WIDTH));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        flex: 1, overflow: "auto",
        display: "flex", justifyContent: "center", alignItems: "flex-start",
        padding: "6px 0",
        background: "radial-gradient(ellipse 90% 60% at 50% 20%, #1e1e1e 0%, #0a0a0a 70%)",
      }}
    >
      <div style={{
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        display: "flex",
        gap: 0,
        alignItems: "flex-end",
        minHeight: BOOTH_FACEPLATE_HEIGHT + 72,
        padding: "72px 12px 8px",
        background: "linear-gradient(180deg, #161616 0%, #0c0c0c 100%)",
        borderRadius: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        {children}
      </div>
    </div>
  );
}
