/** CDJ-3000X jog wheel — metallic rim, dimples, center LCD, playhead needle. */
import { DECK_CHANNEL_COLORS, PIONEER } from "./pioneerTheme";

interface Props {
  deckIndex: number;
  jogAngle: number;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  isLoaded: boolean;
  title?: string;
  size?: number;
}

export function PioneerJogWheel({
  deckIndex, jogAngle, positionSec, durationSec,
  isPlaying, isLoaded, title, size = 168,
}: Props) {
  const chColor = DECK_CHANNEL_COLORS[deckIndex] ?? PIONEER.blue;
  const needleDeg = durationSec > 0 ? (positionSec / durationSec) * 360 : 0;
  const r = size / 2;
  const cx = r;
  const cy = r;

  // Dimple positions on outer grip ring
  const dimples = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const dr = r - 14;
    return { x: cx + Math.cos(a) * dr, y: cy + Math.sin(a) * dr };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.75))" }}
    >
      <defs>
        <radialGradient id={`platter-${deckIndex}`} cx="38%" cy="32%">
          <stop offset="0%" stopColor="#2e2e2e" />
          <stop offset="55%" stopColor="#141414" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
        <linearGradient id={`rim-${deckIndex}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8a8a8a" />
          <stop offset="35%" stopColor="#d0d0d0" />
          <stop offset="65%" stopColor="#707070" />
          <stop offset="100%" stopColor="#a0a0a0" />
        </linearGradient>
        <radialGradient id={`lcd-${deckIndex}`} cx="50%" cy="45%">
          <stop offset="0%" stopColor="#12121a" />
          <stop offset="100%" stopColor="#020204" />
        </radialGradient>
        <filter id={`glow-${deckIndex}`}>
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Outer silver rim */}
      <circle cx={cx} cy={cy} r={r - 2} fill={`url(#rim-${deckIndex})`} stroke="#555" strokeWidth={1} />

      {/* Dimples */}
      {dimples.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={2.2} fill="#1a1a1a" stroke="#444" strokeWidth={0.4} />
      ))}

      {/* Black platter — rotates with jog */}
      <g transform={`rotate(${jogAngle} ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r - 22} fill={`url(#platter-${deckIndex})`} stroke="#2a2a2a" strokeWidth={1} />
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i / 72) * Math.PI * 2;
          const inner = r - 36;
          const outer = r - 24;
          const major = i % 6 === 0;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * inner}
              y1={cy + Math.sin(a) * inner}
              x2={cx + Math.cos(a) * outer}
              y2={cy + Math.sin(a) * outer}
              stroke={major ? "#666" : "#333"}
              strokeWidth={major ? 1.2 : 0.5}
            />
          );
        })}
      </g>

      {/* Sync ring */}
      {isPlaying && isLoaded && (
        <circle
          cx={cx} cy={cy} r={r - 38}
          fill="none"
          stroke={chColor}
          strokeWidth={2}
          opacity={0.7}
          filter={`url(#glow-${deckIndex})`}
        />
      )}

      {/* Center LCD */}
      <circle cx={cx} cy={cy} r={38} fill={`url(#lcd-${deckIndex})`} stroke="#333" strokeWidth={1.5} />

      {/* Album art disc */}
      {isLoaded && (
        <>
          <circle cx={cx} cy={cy} r={30} fill={`url(#lcd-${deckIndex})`} />
          <circle cx={cx} cy={cy} r={28} fill={chColor} opacity={0.2} />
          <circle cx={cx} cy={cy} r={22} fill="#111" opacity={0.5} />
        </>
      )}

      {/* Vinyl position wedge — white arc */}
      <g transform={`rotate(${needleDeg} ${cx} ${cy})`}>
        <path
          d={`M ${cx} ${cy - 28} A 28 28 0 0 1 ${cx + 24} ${cy - 14} L ${cx} ${cy} Z`}
          fill="rgba(255,255,255,0.9)"
        />
        <path
          d={`M ${cx} ${cy - 28} A 28 28 0 0 1 ${cx + 24} ${cy - 14}`}
          fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.5}
        />
      </g>

      {/* Center hub */}
      <circle cx={cx} cy={cy} r={6} fill="#111" stroke="#444" strokeWidth={1} />

      {/* LCD text */}
      <text
        x={cx} y={cy + 22}
        textAnchor="middle"
        fill={isPlaying ? chColor : PIONEER.label}
        fontSize={7}
        fontWeight={700}
        fontFamily="Helvetica Neue, Arial, sans-serif"
        letterSpacing="0.08em"
      >
        {isLoaded ? (isPlaying ? "SYNC" : "VINYL") : "—"}
      </text>
      {title && isLoaded && (
        <text
          x={cx} y={cy + 32}
          textAnchor="middle"
          fill={PIONEER.label}
          fontSize={5}
          fontFamily="Helvetica Neue, Arial, sans-serif"
        >
          {title.slice(0, 12)}
        </text>
      )}
    </svg>
  );
}
