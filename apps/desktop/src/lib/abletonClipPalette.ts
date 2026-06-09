/**
 * Ableton Live arrangement clip colour grid — 5 rows × 14 columns.
 * Last column is greyscale; auto-assigned lanes skip it.
 */

export const ABLETON_CLIP_PALETTE_ROWS: readonly (readonly string[])[] = [
  [
    "#ffb3b3", "#ffc9b3", "#ffdfb3", "#fff5b3", "#e5ffb3", "#c9ffb3", "#b3ffe5", "#b3fff5",
    "#b3e5ff", "#b3c9ff", "#c9b3ff", "#dfb3ff", "#ffb3f5", "#e8e8e8",
  ],
  [
    "#ff8080", "#ffa680", "#ffcc80", "#fff280", "#d9ff80", "#b3ff80", "#80ffcc", "#80fff2",
    "#80ccff", "#80a6ff", "#a680ff", "#cc80ff", "#ff80e6", "#c0c0c0",
  ],
  [
    "#e66666", "#e68c66", "#e6b366", "#e6d966", "#bfe666", "#99e666", "#66e6b3", "#66e6d9",
    "#66b3e6", "#668ce6", "#8c66e6", "#b366e6", "#e666c9", "#999999",
  ],
  [
    "#bf4040", "#bf6640", "#bf8c40", "#bfb340", "#8cbf40", "#66bf40", "#40bf8c", "#40bfbf",
    "#408cbf", "#4066bf", "#6640bf", "#8c40bf", "#bf408c", "#737373",
  ],
  [
    "#802626", "#804026", "#805926", "#807326", "#598026", "#408026", "#268059", "#268080",
    "#265980", "#264080", "#402680", "#592680", "#802659", "#4d4d4d",
  ],
] as const;

export const ABLETON_CLIP_PALETTE_FLAT: readonly string[] =
  ABLETON_CLIP_PALETTE_ROWS.flat();

/** Middle row defaults — muted but readable on dark arrangement bg. */
export function defaultClipColorForIndex(index: number): string {
  const row = ABLETON_CLIP_PALETTE_ROWS[2];
  return row[index % (row.length - 1)];
}

export function resolveCardClipColor(
  clipColor: string | undefined | null,
  laneIndex: number,
): string {
  if (clipColor && /^#[0-9a-fA-F]{6}$/.test(clipColor)) return clipColor;
  return defaultClipColorForIndex(laneIndex);
}
