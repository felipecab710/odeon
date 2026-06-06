/**
 * Renders an automation curve across a timeline region.
 */
import { useMemo } from "react";
import {
  transitionGainCurve,
  transitionFilterCurve,
  transitionEqKillCurve,
  transitionCrossfaderPos,
} from "../../lib/boothCurves";
import type { AutomationParam } from "../../stores/studioAutomationStore";

function sampleCurve(
  param: AutomationParam,
  t: number,
  isOutgoing: boolean,
): number {
  switch (param) {
    case "trackVolume":
      return transitionGainCurve(t, isOutgoing);
    case "filter":
      return (transitionFilterCurve(t, isOutgoing) + 1) / 2;
    case "low": {
      const kill = transitionEqKillCurve(t, isOutgoing);
      return kill < 0 ? Math.max(0, 1 + kill / 12) : 1;
    }
    case "mid":
    case "high":
      return transitionGainCurve(t, isOutgoing);
    case "crossfader":
      return isOutgoing ? 1 - transitionCrossfaderPos(t) : transitionCrossfaderPos(t);
    default:
      return 1;
  }
}

interface Props {
  width: number;
  height: number;
  param: AutomationParam;
  isOutgoing: boolean;
  color?: string;
  showNodes?: boolean;
}

export function AutomationCurveCanvas({
  width,
  height,
  param,
  isOutgoing,
  color = "#e53935",
  showNodes = true,
}: Props) {
  const { path, nodes } = useMemo(() => {
    const samples = Math.max(16, Math.floor(width / 6));
    const pad = 4;
    const innerH = height - pad * 2;
    const pts: string[] = [];
    const nodePts: { x: number; y: number }[] = [];

    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const x = t * width;
      const v = sampleCurve(param, t, isOutgoing);
      const y = pad + innerH * (1 - v);
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }

    for (const t of [0.35, 0.5, 0.65]) {
      const x = t * width;
      const v = sampleCurve(param, t, isOutgoing);
      nodePts.push({ x, y: pad + innerH * (1 - v) });
    }

    return { path: pts.join(" "), nodes: nodePts };
  }, [width, height, param, isOutgoing]);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <line
          key={f}
          x1={0}
          y1={height * f}
          x2={width}
          y2={height * f}
          stroke="#333"
          strokeWidth={0.5}
        />
      ))}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      {showNodes && nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x}
          cy={n.y}
          r={3}
          fill={color}
          stroke="#111"
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}
