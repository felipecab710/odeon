/**
 * Interactive automation lane — click to add breakpoints, drag to adjust (Draw mode).
 * Shows a horizontal baseline at the current mixer value when no breakpoints exist.
 */
import { useCallback, useRef, useState } from "react";
import type { DeckMix } from "../../lib/deckMixEngine";
import {
  formatAutomationValue,
  getBaselineNorm,
  applyNormToMix,
  sampleKeyframes,
  sortKeyframes,
  type AutomationKeyframe,
} from "../../lib/automationMath";
import {
  useStudioAutomationStore,
  type AutomationParam,
  type AutomationEditMode,
} from "../../stores/studioAutomationStore";
import { beginUndoGesture, endUndoGesture } from "../../stores/undoStore";

const PAD = 4;
const NODE_R = 5;
const HIT_R = 8;
const BASELINE_HIT = 10;

interface Props {
  laneIndex: number;
  param: AutomationParam;
  color: string;
  width: number;
  height: number;
  startSec: number;
  durationSec: number;
  playheadSec?: number;
  editMode: AutomationEditMode;
  enabled: boolean;
  mix: DeckMix;
  onMixChange: (mix: DeckMix) => void;
}

function xToTime(x: number, width: number, startSec: number, durationSec: number): number {
  if (width <= 0) return startSec;
  return startSec + (x / width) * durationSec;
}

function timeToX(timeSec: number, width: number, startSec: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return ((timeSec - startSec) / durationSec) * width;
}

function yToNorm(y: number, height: number): number {
  const innerH = height - PAD * 2;
  return Math.max(0, Math.min(1, 1 - (y - PAD) / innerH));
}

function normToY(norm: number, height: number): number {
  const innerH = height - PAD * 2;
  return PAD + innerH * (1 - norm);
}

export function AutomationEditor({
  laneIndex,
  param,
  color,
  width,
  height,
  startSec,
  durationSec,
  playheadSec,
  editMode,
  enabled,
  mix,
  onMixChange,
}: Props) {
  const keyframes = useStudioAutomationStore(
    s => s.tracks[laneIndex]?.curves[param] ?? [],
  );
  const upsertKeyframe = useStudioAutomationStore(s => s.upsertKeyframe);
  const removeKeyframeNear = useStudioAutomationStore(s => s.removeKeyframeNear);
  const setKeyframes = useStudioAutomationStore(s => s.setKeyframes);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [baselineDrag, setBaselineDrag] = useState(false);

  const sorted = sortKeyframes(keyframes);
  const baselineNorm = getBaselineNorm(mix, param);
  const baselineY = normToY(baselineNorm, height);
  const hasCurve = sorted.length > 0;

  const playheadNorm = playheadSec != null
    ? (sampleKeyframes(sorted, playheadSec) ?? baselineNorm)
    : null;

  const buildPath = useCallback(() => {
    if (sorted.length === 0) return "";
    const pts = sorted.map(k => {
      const x = timeToX(k.timeSec, width, startSec, durationSec);
      const y = normToY(k.valueNorm, height);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join(" L")}`;
  }, [sorted, width, height, startSec, durationSec]);

  const findNodeAt = (clientX: number, clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return -1;
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (let i = 0; i < sorted.length; i++) {
      const nx = timeToX(sorted[i].timeSec, width, startSec, durationSec);
      const ny = normToY(sorted[i].valueNorm, height);
      if (Math.hypot(x - nx, y - ny) <= HIT_R) return i;
    }
    return -1;
  };

  const isNearBaseline = (clientY: number): boolean => {
    const svg = svgRef.current;
    if (!svg) return false;
    const y = clientY - svg.getBoundingClientRect().top;
    return Math.abs(y - baselineY) <= BASELINE_HIT;
  };

  const pointerToKeyframe = (clientX: number, clientY: number): AutomationKeyframe => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, clientX - rect.left));
    const y = Math.max(PAD, Math.min(height - PAD, clientY - rect.top));
    return {
      timeSec: xToTime(x, width, startSec, durationSec),
      valueNorm: yToNorm(y, height),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || editMode !== "draw") return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    beginUndoGesture();

    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit >= 0) {
      setDragIdx(hit);
      return;
    }

    if (!hasCurve && isNearBaseline(e.clientY)) {
      setBaselineDrag(true);
      return;
    }

    const kf = pointerToKeyframe(e.clientX, e.clientY);
    upsertKeyframe(laneIndex, param, kf.timeSec, kf.valueNorm);
    const next = sortKeyframes([...sorted, kf]);
    setDragIdx(next.findIndex(k => Math.abs(k.timeSec - kf.timeSec) < 0.01));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!enabled) return;
    e.stopPropagation();

    if (baselineDrag) {
      const svg = svgRef.current;
      if (!svg) return;
      const y = Math.max(PAD, Math.min(height - PAD, e.clientY - svg.getBoundingClientRect().top));
      onMixChange(applyNormToMix(mix, param, yToNorm(y, height)));
      return;
    }

    if (dragIdx == null) return;
    const kf = pointerToKeyframe(e.clientX, e.clientY);
    const next = [...sorted];
    next[dragIdx] = { ...next[dragIdx], timeSec: kf.timeSec, valueNorm: kf.valueNorm };
    setKeyframes(laneIndex, param, sortKeyframes(next));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragIdx != null || baselineDrag) e.stopPropagation();
    setDragIdx(null);
    setBaselineDrag(false);
    endUndoGesture();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!enabled || editMode !== "draw") return;
    e.stopPropagation();
    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit >= 0) {
      removeKeyframeNear(laneIndex, param, sorted[hit].timeSec);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!enabled || editMode !== "draw") return;
    e.preventDefault();
    e.stopPropagation();
    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit >= 0) {
      removeKeyframeNear(laneIndex, param, sorted[hit].timeSec);
    }
  };

  const cursor = enabled && editMode === "draw"
    ? (baselineDrag ? "ns-resize" : "crosshair")
    : "default";
  const playheadX = playheadSec != null
    ? timeToX(playheadSec, width, startSec, durationSec)
    : null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: "block", cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
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

      {/* Baseline — current mixer value when no breakpoints; tweak by dragging */}
      {!hasCurve && enabled && (
        <>
          <line
            x1={0}
            y1={baselineY}
            x2={width}
            y2={baselineY}
            stroke={color}
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
          {editMode === "draw" && (
            <line
              x1={0}
              y1={baselineY}
              x2={width}
              y2={baselineY}
              stroke="transparent"
              strokeWidth={BASELINE_HIT}
              style={{ cursor: "ns-resize" }}
            />
          )}
        </>
      )}

      {hasCurve && (
        <path d={buildPath()} fill="none" stroke={color} strokeWidth={1.5} />
      )}

      {sorted.map((k, i) => {
        const x = timeToX(k.timeSec, width, startSec, durationSec);
        const y = normToY(k.valueNorm, height);
        return (
          <circle
            key={`${k.timeSec}-${i}`}
            cx={x}
            cy={y}
            r={NODE_R}
            fill={dragIdx === i ? "#fff" : color}
            stroke="#111"
            strokeWidth={0.75}
          />
        );
      })}

      {playheadX != null && playheadX >= 0 && playheadX <= width && (
        <>
          <line
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={height}
            stroke="#ffffff44"
            strokeWidth={1}
          />
          {playheadNorm != null && (
            <circle
              cx={playheadX}
              cy={normToY(playheadNorm, height)}
              r={3}
              fill="#fff"
              stroke={color}
              strokeWidth={1}
            />
          )}
        </>
      )}
    </svg>
  );
}

/** Value readout for the parameter sidebar. */
export function AutomationValueReadout({
  param,
  norm,
}: {
  param: AutomationParam;
  norm: number | null;
}) {
  return (
    <div style={{
      fontSize: 7,
      color: norm != null ? "#ccc" : "#555",
      background: "#0a0a0a",
      border: "1px solid #333",
      borderRadius: 2,
      padding: "2px 4px",
      textAlign: "right",
      fontFamily: "monospace",
    }}>
      {norm != null ? formatAutomationValue(param, norm) : "—"}
    </div>
  );
}
