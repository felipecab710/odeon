import { useEffect, useId, useRef } from "react";
import { useTransportStore } from "../../stores/transportStore";
import { VisualPlayPosition } from "../../lib/visualPlayPosition";

const SIZE = 97;
const CX = SIZE / 2;
const CY = SIZE / 2;
const WHITE_R = 31;
const WHITE_W = 6.5;
const RED_R = 27.5;
const RED_W = 2.8;
const ART_R = 22;

/** Shared marker geometry — black on white ring, orange on red ring, same radial line */
const MARKER_W = 8;
const MARKER_X = CX - MARKER_W / 2;
const BLACK_H = WHITE_W + 0.6;
const BLACK_TOP = CY - WHITE_R - WHITE_W / 2;
const ORANGE_SZ = 3.8;
const ORANGE_TOP = BLACK_TOP + BLACK_H - 1.1;

function firstCueSec(hotCueTimes: (number | null)[], hotCueSlots: boolean[]): number {
  for (let i = 0; i < hotCueTimes.length; i++) {
    if (hotCueSlots[i] && hotCueTimes[i] != null) return hotCueTimes[i]!;
  }
  return 0;
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export function JogWheelCenterDisplay({
  deckIndex,
  timelineStartSec,
  durationSec,
  isLoaded,
  isPlaying,
  loopActive,
  artworkUrl,
  artist,
  title,
  hotCueSlots,
  hotCueTimes,
}: {
  deckIndex: number;
  timelineStartSec: number;
  durationSec: number;
  isLoaded: boolean;
  isPlaying: boolean;
  loopActive: boolean;
  artworkUrl: string | null;
  artist: string;
  title: string;
  hotCueSlots: boolean[];
  hotCueTimes: (number | null)[];
}) {
  const uid = useId().replace(/:/g, "");
  const glowId = `jog-glow-${uid}`;
  const wingId = `jog-wing-${uid}`;
  const artClipId = `jog-art-${uid}`;
  const artFillId = `jog-artfill-${uid}`;

  const visualRef = useRef(new VisualPlayPosition());
  const playheadRef = useRef<SVGGElement>(null);
  const cueRef = useRef<SVGGElement>(null);

  const cueSec = firstCueSec(hotCueTimes, hotCueSlots);
  const isMaster = deckIndex === 0;

  const slipLit = loopActive;
  const vinylLit = !isPlaying && isLoaded;
  const syncLit = isPlaying && isLoaded;
  const masterLit = isMaster && isLoaded;

  const dur = durationSec > 0 ? durationSec : 1;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const { positionSeconds, isPlaying: transportPlaying } = useTransportStore.getState();
      const localPos = Math.max(0, positionSeconds - timelineStartSec);
      visualRef.current.sync(localPos, transportPlaying);
      const pos = visualRef.current.interpolate();
      const playAngle = (pos / dur) * 360;
      const cueAngle = (cueSec / dur) * 360;

      playheadRef.current?.setAttribute(
        "transform",
        `rotate(${playAngle} ${CX} ${CY})`,
      );
      cueRef.current?.setAttribute(
        "transform",
        `rotate(${cueAngle} ${CX} ${CY})`,
      );

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timelineStartSec, dur, cueSec]);

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ display: "block", pointerEvents: "none" }}
    >
      <defs>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={wingId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1835" />
          <stop offset="28%" stopColor="#122a52" />
          <stop offset="50%" stopColor="#1a3d72" />
          <stop offset="72%" stopColor="#122a52" />
          <stop offset="100%" stopColor="#0a1835" />
        </linearGradient>
        <clipPath id={artClipId}>
          <circle cx={CX} cy={CY} r={ART_R} />
        </clipPath>
        <radialGradient id={artFillId} cx="35%" cy="30%">
          <stop offset="0%" stopColor="#3a3a3a" />
          <stop offset="70%" stopColor="#111" />
        </radialGradient>
      </defs>

      {/* Deep navy side wings — behind rings */}
      <rect x={0} y={35} width={18} height={27} rx={0.5} fill={`url(#${wingId})`} opacity={0.9} />
      <rect x={SIZE - 18} y={35} width={18} height={27} rx={0.5} fill={`url(#${wingId})`} opacity={0.9} />

      {/* Static white progress ring */}
      <circle
        cx={CX} cy={CY} r={WHITE_R}
        fill="none" stroke="#ececec" strokeWidth={WHITE_W}
      />

      {/* Static red inner ring */}
      <circle
        cx={CX} cy={CY} r={RED_R}
        fill="none" stroke="#cc1520" strokeWidth={RED_W}
        filter={`url(#${glowId})`}
      />

      {/* Rotating playhead — black block on white ring */}
      {isLoaded && (
        <g ref={playheadRef} transform={`rotate(0 ${CX} ${CY})`}>
          <rect
            x={MARKER_X}
            y={BLACK_TOP}
            width={MARKER_W}
            height={BLACK_H}
            rx={0.3}
            fill="#0a0a0a"
          />
        </g>
      )}

      {/* Rotating cue — orange block on red ring, geometry meets black when aligned */}
      {isLoaded && (
        <g ref={cueRef} transform={`rotate(0 ${CX} ${CY})`}>
          <rect
            x={CX - ORANGE_SZ / 2}
            y={ORANGE_TOP}
            width={ORANGE_SZ}
            height={ORANGE_SZ}
            fill="#d45810"
          />
        </g>
      )}

      {/* Album art */}
      {artworkUrl ? (
        <image
          href={artworkUrl}
          x={CX - ART_R}
          y={CY - ART_R}
          width={ART_R * 2}
          height={ART_R * 2}
          clipPath={`url(#${artClipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <circle cx={CX} cy={CY} r={ART_R} fill={`url(#${artFillId})`} />
      )}

      {/* Track info */}
      {isLoaded && (
        <>
          <ellipse cx={CX} cy={CY + 2} rx={20} ry={9} fill="rgba(0,0,0,0.45)" />
          <text
            x={CX} y={CY - 1}
            textAnchor="middle"
            fill="#f5d020"
            fontSize={5.2}
            fontWeight={700}
            fontFamily="Inter, Helvetica Neue, Arial, sans-serif"
            letterSpacing="0.04em"
          >
            {truncate(artist || "—", 14)}
          </text>
          <text
            x={CX} y={CY + 6}
            textAnchor="middle"
            fill="#f0f0f0"
            fontSize={4.2}
            fontWeight={700}
            fontFamily="Inter, Helvetica Neue, Arial, sans-serif"
            letterSpacing="0.02em"
          >
            {truncate(title || "—", 18)}
          </text>
        </>
      )}

      {/* Outer status labels */}
      <text x={CX} y={7.5} textAnchor="middle" fill="#8a8a8a" fontSize={3.6} fontWeight={600}
        fontFamily="Inter, Helvetica Neue, Arial, sans-serif" letterSpacing="0.12em">
        MODE
      </text>
      <text x={CX} y={SIZE - 3} textAnchor="middle" fill="#8a8a8a" fontSize={3.6} fontWeight={600}
        fontFamily="Inter, Helvetica Neue, Arial, sans-serif" letterSpacing="0.08em">
        BEAT SYNC
      </text>

      <text x={11} y={20} textAnchor="middle" fill={slipLit ? "#ff2a2a" : "#5a2020"}
        fontSize={4.8} fontWeight={700} fontFamily="Inter, Helvetica Neue, Arial, sans-serif">
        SLIP
      </text>
      <text x={SIZE - 11} y={20} textAnchor="middle" fill={vinylLit ? "#3d9eff" : "#1a3355"}
        fontSize={4.8} fontWeight={700} fontFamily="Inter, Helvetica Neue, Arial, sans-serif">
        VINYL
      </text>
      <text x={11} y={SIZE - 10} textAnchor="middle" fill={syncLit ? "#f0f0f0" : "#555"}
        fontSize={4.8} fontWeight={700} fontFamily="Inter, Helvetica Neue, Arial, sans-serif">
        SYNC
      </text>
      <text x={SIZE - 11} y={SIZE - 10} textAnchor="middle" fill={masterLit ? "#f0c020" : "#5a4810"}
        fontSize={4.8} fontWeight={700} fontFamily="Inter, Helvetica Neue, Arial, sans-serif">
        MASTER
      </text>

      {/* Arc separators */}
      <path
        d={`M ${CX - 22} 11 A 22 22 0 0 1 ${CX - 14} 8`}
        fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.5}
      />
      <path
        d={`M ${CX + 14} 8 A 22 22 0 0 1 ${CX + 22} 11`}
        fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.5}
      />
      <path
        d={`M ${CX - 22} ${SIZE - 11} A 22 22 0 0 0 ${CX - 14} ${SIZE - 8}`}
        fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.5}
      />
      <path
        d={`M ${CX + 14} ${SIZE - 8} A 22 22 0 0 0 ${CX + 22} ${SIZE - 11}`}
        fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.5}
      />
    </svg>
  );
}
