/** Pioneer DJ hardware design tokens — CDJ-3000X + DJM-A9 */
export const PIONEER = {
  faceplate: "#121212",
  faceplateHi: "#1c1c1c",
  faceplateEdge: "#2e2e2e",
  chrome: "linear-gradient(90deg, #3a3a3a 0%, #8a8a8a 50%, #3a3a3a 100%)",
  screenBg: "#030308",
  screenBezel: "#0a0a0a",
  label: "#8a8a8a",
  labelHi: "#c8c8c8",
  white: "#f0f0f0",
  orange: "#ff6d00",
  orangeGlow: "0 0 14px rgba(255,109,0,0.75), 0 0 4px rgba(255,109,0,0.9)",
  green: "#00e676",
  greenGlow: "0 0 14px rgba(0,230,118,0.7), 0 0 4px rgba(0,230,118,0.9)",
  blue: "#29b6f6",
  red: "#f44336",
  meterGreen: "#3ecf5e",
  meterAmber: "#f5c542",
  meterRed: "#f04e3e",
  knob: "#1a1a1a",
  knobRing: "#333",
  faderTrack: "#0a0a0a",
  font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  fontCondensed: '"Arial Narrow", "Helvetica Neue Condensed", sans-serif',
} as const;

export const DECK_CHANNEL_COLORS = ["#d4e157", "#b39ddb", "#4fc3f7", "#ffab40"] as const;
