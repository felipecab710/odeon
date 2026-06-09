/** Pro Tools–style clip colour presets (from reference screenshot). */

export interface ClipColorPreset {
  id: string;
  label: string;
  color: string;
}

export const CLIP_COLOR_PRESETS: readonly ClipColorPreset[] = [
  { id: "teal",   label: "Teal",   color: "#2D5A5A" },
  { id: "steel",  label: "Steel",  color: "#264D66" },
  { id: "royal",  label: "Royal",  color: "#2B3A6D" },
  { id: "purple", label: "Purple", color: "#3A2B6D" },
] as const;

export const DEFAULT_CLIP_COLOR = CLIP_COLOR_PRESETS[0].color;

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Shift RGB channels by a factor (negative = darker). */
export function shadeHex(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const f = 1 + amount;
  return toHex(rgb[0] * f, rgb[1] * f, rgb[2] * f);
}

/** Horizontal gradient matching Pro Tools clip lighting. */
export function clipGradient(color: string): string {
  const left = shadeHex(color, -0.14);
  const right = shadeHex(color, 0.1);
  return `linear-gradient(90deg, ${left} 0%, ${color} 52%, ${right} 100%)`;
}

export function isPresetColor(color: string): boolean {
  return CLIP_COLOR_PRESETS.some((p) => p.color.toLowerCase() === color.toLowerCase());
}

export function resolveClipColor(trackColor: string | undefined): string {
  if (trackColor && /^#[0-9a-fA-F]{6}$/.test(trackColor)) return trackColor;
  return DEFAULT_CLIP_COLOR;
}

/** Active bus group color wins when color sharing is enabled (Pro Tools linked color). */
export function resolveTrackClipColor(
  trackColor: string | undefined,
  group: { active: boolean; color: string; sharing: { color: boolean } } | null,
): string {
  if (group?.active && group.sharing.color && group.color) {
    return resolveClipColor(group.color);
  }
  return resolveClipColor(trackColor);
}

/** Waveform fill + outline — darker shades of the clip hue (Ableton-style). */
export function waveformColorsFromClip(hex: string): { fill: string; outline: string } {
  return {
    fill: shadeHex(hex, -0.26),
    outline: shadeHex(hex, -0.36),
  };
}

/** Audacity-style clip body — saturated hue, subtle vertical depth. */
export function arrangementClipBackground(hex: string): string {
  const top = shadeHex(hex, 0.06);
  const mid = hex;
  const bot = shadeHex(hex, -0.1);
  return `linear-gradient(180deg, ${top} 0%, ${mid} 55%, ${bot} 100%)`;
}

/** Readable label colour on a saturated clip block. */
export function contrastingTextOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#f5f5f5";
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum > 150 ? "#1a1a1a" : "#f8f8f8";
}

/** Bus/group palette — same presets as clip colour menu. */
export const BUS_COLOR_PALETTE = CLIP_COLOR_PRESETS.map((p) => p.color);
