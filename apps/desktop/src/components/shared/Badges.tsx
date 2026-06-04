import type { TrackRole, StemType } from "@odeon/shared";

const ROLE_LABELS: Record<TrackRole, string> = {
  reference_full_mix: "Ref",
  reference_stem: "Ref Stem",
  user_stem: "My Stem",
  analysis: "Analysis",
};

const ROLE_COLORS: Record<TrackRole, string> = {
  reference_full_mix: "bg-blue-900 text-blue-300",
  reference_stem: "bg-blue-900 text-blue-300",
  user_stem: "bg-green-900 text-green-300",
  analysis: "bg-purple-900 text-purple-300",
};

export function TrackRoleBadge({ role }: { role: TrackRole }) {
  return (
    <span className={`text-xxs px-1 py-0.5 rounded font-medium ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

const STEM_LABELS: Record<StemType, string> = {
  full_mix: "Full Mix",
  drums: "Drums",
  bass: "Bass",
  vocals: "Vocals",
  music: "Music",
  other: "Other",
  fx: "FX",
  unknown: "?",
};

const STEM_COLORS: Record<StemType, string> = {
  full_mix: "bg-[#1a2a3a] text-[#4A90D9]",
  drums: "bg-[#3a1a1a] text-[#E84C3D]",
  bass: "bg-[#3a2a10] text-[#F39C12]",
  vocals: "bg-[#1a3a1a] text-[#2ECC71]",
  music: "bg-[#2a1a3a] text-[#9B59B6]",
  other: "bg-[#2a2a2a] text-[#95A5A6]",
  fx: "bg-[#102030] text-[#1F618D]",
  unknown: "bg-[#1a1a1a] text-[#5D6D7E]",
};

export function StemTypeBadge({ stemType }: { stemType: StemType }) {
  return (
    <span className={`text-xxs px-1 py-0.5 rounded ${STEM_COLORS[stemType]}`}>
      {STEM_LABELS[stemType]}
    </span>
  );
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-studio-meter",
  medium: "text-studio-solo",
  low: "text-studio-text-dim",
};

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tier = confidence >= 0.7 ? "high" : confidence >= 0.4 ? "medium" : "low";
  return (
    <span className={`text-xxs font-mono ${CONFIDENCE_COLORS[tier]}`}>
      {Math.round(confidence * 100)}%
    </span>
  );
}
