/** Pioneer DJM-style fader cap — matte black body, white position stripe. */
export function PioneerFaderCap({
  topPct,
  capHeight = 10,
  inset = 1,
}: {
  topPct: number;
  capHeight?: number;
  inset?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: -inset,
        right: -inset,
        top: `${topPct}%`,
        height: capHeight,
        transform: "translateY(-50%)",
        background:
          "linear-gradient(180deg, #5a5a5a 0%, #2a2a2a 18%, #141414 50%, #1e1e1e 82%, #444 100%)",
        borderRadius: 2,
        border: "1px solid #3a3a3a",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 5px rgba(0,0,0,0.75)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 2,
          right: 2,
          top: "50%",
          height: 1,
          transform: "translateY(-50%)",
          background: "linear-gradient(90deg, transparent, #f0f0f0 15%, #fff 50%, #f0f0f0 85%, transparent)",
          boxShadow: "0 0 2px rgba(255,255,255,0.35)",
        }}
      />
    </div>
  );
}
