import { useId, type CSSProperties } from "react";

/**
 * CDJ-3000 jog wheel outer grip ring — dark platter with concave dimple holes.
 * Static outer grip — does not spin with playback.
 */
const VB = 309;
const CX = 154.5;
const CY = 154.5;
const OUTER_R = 154;
const INNER_R = 145.5;
const DIMPLE_R = 136;
const DIMPLE_COUNT = 36;
const DIMPLE_SIZE = 3.4;

const dimples = Array.from({ length: DIMPLE_COUNT }, (_, i) => {
  const rad = ((i / DIMPLE_COUNT) * 360 - 90) * (Math.PI / 180);
  return {
    x: CX + DIMPLE_R * Math.cos(rad),
    y: CY + DIMPLE_R * Math.sin(rad),
  };
});

export function JogWheelGripRing({
  size = VB,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  const uid = useId().replace(/:/g, "");
  const shadeId = `jog-shade-${uid}`;
  const dropId = `jog-drop-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        display: "block",
        ...style,
      }}
    >
      <defs>
        <radialGradient id={shadeId} cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#484848" />
          <stop offset="55%" stopColor="#2e2e2e" />
          <stop offset="100%" stopColor="#1e1e1e" />
        </radialGradient>
        <filter id={dropId} x="0" y="0" width="100%" height="100%">
          <feDropShadow dx="1.5" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.75" />
        </filter>
      </defs>

      {/* Outer edge + grip band */}
      <circle
        cx={CX} cy={CY} r={OUTER_R}
        fill={`url(#${shadeId})`}
        stroke="#5e5e5c"
        strokeWidth="0.8"
      />
      <circle cx={CX} cy={CY} r={INNER_R} fill="#262626" filter={`url(#${dropId})`} />

      {/* Concave dimples */}
      {dimples.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={DIMPLE_SIZE} fill="#1a1a1a" />
          <circle
            cx={d.x - 0.7} cy={d.y - 0.7} r={DIMPLE_SIZE * 0.45}
            fill="#404040" opacity="0.45"
          />
          <circle
            cx={d.x + 0.5} cy={d.y + 0.6} r={DIMPLE_SIZE * 0.35}
            fill="#101010" opacity="0.5"
          />
        </g>
      ))}
    </svg>
  );
}
