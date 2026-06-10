/**
 * Audacity-compatible label import/export for set locators.
 * Format: tab-separated `start_seconds\tend_seconds\tlabel` per line.
 * Point markers use equal start/end times.
 */
import type { SetLocator } from "../stores/setLocatorStore";

export function locatorsToAudacityLabels(locators: SetLocator[]): string {
  return locators
    .map(l => {
      const t = formatLabelTime(l.timeSec);
      const name = l.name.replace(/\t/g, " ").replace(/\r?\n/g, " ");
      return `${t}\t${t}\t${name}`;
    })
    .join("\n");
}

export function parseAudacityLabels(text: string): Pick<SetLocator, "timeSec" | "name">[] {
  const out: Pick<SetLocator, "timeSec" | "name">[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const tabParts = line.split("\t");
    if (tabParts.length >= 3) {
      const start = parseLabelTime(tabParts[0]);
      const name = tabParts.slice(2).join("\t").trim();
      if (Number.isFinite(start) && name) out.push({ timeSec: Math.max(0, start), name });
      continue;
    }

    const commaParts = line.split(",");
    if (commaParts.length >= 2) {
      const start = parseLabelTime(commaParts[0]);
      const name = commaParts.slice(1).join(",").trim();
      if (Number.isFinite(start) && name) out.push({ timeSec: Math.max(0, start), name });
    }
  }
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

function formatLabelTime(sec: number): string {
  return sec.toFixed(6).replace(/\.?0+$/, "");
}

function parseLabelTime(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return NaN;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map(p => parseFloat(p));
    if (parts.some(p => !Number.isFinite(p))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : NaN;
}
