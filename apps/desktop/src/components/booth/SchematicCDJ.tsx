/**
 * CDJ deck unit — Figma pixel-perfect shell (node 392:2090) with live screen overlay.
 */
import type { CatalogEntry } from "@odeon/shared";
import type { CDJDeckState } from "../../stores/boothStore";
import { FigmaCDJ3000 } from "./FigmaCDJ3000";

interface Props {
  deck: CDJDeckState;
  entry: CatalogEntry | null;
  accent: string;
  timelineStartSec?: number;
  interactive?: boolean;
  onHotcue?: (slot: number, shift: boolean) => void;
  onCue?: () => void;
  onLoopToggle?: () => void;
}

export function SchematicCDJ({
  deck, entry, timelineStartSec, interactive, onCue, onHotcue,
}: Props) {
  return (
    <FigmaCDJ3000
      deck={deck}
      entry={entry}
      timelineStartSec={timelineStartSec}
      interactive={interactive}
      onCue={onCue}
      onHotcue={onHotcue}
    />
  );
}
