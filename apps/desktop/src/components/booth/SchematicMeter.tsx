/** Pioneer-style LED ladder meter. */
import { useMemo } from "react";

function dbToSegments(db: number, maxSegs: number): number {
  const clamped = Math.max(-60, Math.min(6, db));
  const norm = (clamped + 60) / 66;
  return Math.round(norm * maxSegs);
}

function segColor(i: number, total: number, lit: boolean): string {
  if (!lit) return "#0c0c0c";
  const fromBottom = i / total;
  if (fromBottom < 0.45) return "#3ecf5e";
  if (fromBottom < 0.65) return "#9ae66e";
  if (fromBottom < 0.82) return "#f5c542";
  return "#f04e3e";
}

function segGlow(i: number, total: number, lit: boolean): string {
  if (!lit) return "none";
  const fromBottom = i / total;
  if (fromBottom >= 0.82) return "0 0 4px rgba(240,78,62,0.8)";
  if (fromBottom >= 0.65) return "0 0 3px rgba(245,197,66,0.6)";
  return "0 0 2px rgba(62,207,94,0.5)";
}

export function SchematicMeter({
  leftDb, rightDb, height = 80, segments = 12,
}: {
  leftDb: number; rightDb: number; height?: number; segments?: number;
}) {
  const lSegs = useMemo(() => dbToSegments(leftDb, segments), [leftDb, segments]);
  const rSegs = useMemo(() => dbToSegments(rightDb, segments), [rightDb, segments]);

  const bar = (count: number, segs: number) => (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 1, flex: 1 }}>
      {Array.from({ length: segs }, (_, i) => (
        <div key={i} style={{
          height: Math.max(2, (height - segs) / segs),
          borderRadius: 1,
          background: segColor(i, segs, i < count),
          boxShadow: segGlow(i, segs, i < count),
          border: i < count ? "none" : "1px solid #111",
        }} />
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 2, height, width: 14 }}>
      {bar(lSegs, segments)}
      {bar(rSegs, segments)}
    </div>
  );
}
