// ─────────────────────────────────────────────
//  Core Odeon Data Model Types
// ─────────────────────────────────────────────

export type TrackRole =
  | "reference_full_mix"
  | "reference_stem"
  | "user_stem"
  | "analysis";

export type StemType =
  | "full_mix"
  | "drums"
  | "bass"
  | "vocals"
  | "music"
  | "other"
  | "fx"
  | "unknown";

export type AnalysisStatus =
  | "pending"
  | "analyzing"
  | "complete"
  | "failed"
  | "skipped";

export type ProjectStatus =
  | "empty"
  | "reference_uploaded"
  | "stems_separated"
  | "user_stems_imported"
  | "analyzed"
  | "compared"
  | "ready";

export type MixMoveCategory =
  | "level"
  | "pan"
  | "eq"
  | "compression"
  | "reverb"
  | "stereo"
  | "arrangement";

export type MixMoveStatus = "suggested" | "accepted" | "ignored";

// ─────────────────────────────────────────────
//  Analysis Subtypes
// ─────────────────────────────────────────────

export interface FrequencyProfile {
  sub_20_60: number;       // dB average energy
  bass_60_160: number;
  low_mid_160_500: number;
  mid_500_2000: number;
  presence_2000_5000: number;
  brightness_5000_10000: number;
  air_10000_18000: number;
}

export interface StereoProfile {
  left_rms: number;
  right_rms: number;
  mid_energy: number;
  side_energy: number;
  side_to_mid_ratio: number;
  phase_correlation: number;
  pan_proxy: number;      // -1.0 (full left) .. 1.0 (full right)
  width_proxy: number;    // 0.0 (mono) .. 1.0+ (wide)
}

export interface TrackAnalysis {
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  integrated_lufs: number;
  true_peak_db: number;
  rms_db: number;
  peak_db: number;
  crest_factor_db: number;
  frequency_profile: FrequencyProfile | null;
  stereo_profile: StereoProfile | null;
  tempo: number | null;
  section_energy: SectionEnergy[] | null;
  warnings: string[];
  waveform_peaks: number[] | null;   // mono summary (back-compat)
  waveform_rms:   number[] | null;
  waveform_peaks_l: number[] | null;  // Pro Tools stereo L
  waveform_peaks_r: number[] | null;  // Pro Tools stereo R
  waveform_rms_l:   number[] | null;
  waveform_rms_r:   number[] | null;
  waveform_cache_path: string | null;
}

export interface SectionEnergy {
  label: string;           // "intro" | "section_a" | "drop_candidate" | etc.
  start_seconds: number;
  end_seconds: number;
  rms_db: number;
}

// ─────────────────────────────────────────────
//  MixMove
// ─────────────────────────────────────────────

export interface MixMoveEvidence {
  band?: string;
  user_db?: number;
  reference_db?: number;
  delta_db?: number;
  user_value?: number;
  reference_value?: number;
  delta?: number;
  description?: string;
}

export interface DawReadyParameters {
  processor: string;        // "parametric_eq" | "gain" | "compressor" | "stereo_width" | ...
  type?: string;            // "bell" | "low_shelf" | "high_shelf" | ...
  frequency_hz?: number;
  gain_db?: number;
  q?: number;
  ratio?: number;
  threshold_db?: number;
  attack_ms?: number;
  release_ms?: number;
  width_factor?: number;
  pan?: number;
  [key: string]: unknown;
}

export interface MixMove {
  id: string;
  target_track_id: string;
  reference_track_id: string;
  category: MixMoveCategory;
  observation: string;
  suggested_action: string;
  confidence: number;        // 0.0 – 1.0
  evidence: MixMoveEvidence;
  daw_ready_parameters: DawReadyParameters;
  status: MixMoveStatus;
}

// ─────────────────────────────────────────────
//  Track + Project
// ─────────────────────────────────────────────

export interface OdeonTrack {
  id: string;
  project_id: string;
  name: string;
  role: TrackRole;
  stem_type: StemType;
  file_path: string;
  color: string;            // hex colour for the track
  muted: boolean;
  soloed: boolean;
  volume_db: number;        // 0.0 = unity
  pan: number;              // -1.0 .. 1.0
  clip_start_seconds: number;
  analysis_status: AnalysisStatus;
  analysis: TrackAnalysis | null;
}

/** Pro Tools–style track/bus group (persisted on project). */
export interface TrackGroupSharing {
  gain: boolean;
  gain_relative: boolean;
  muting: boolean;
  soloing: boolean;
  record_enable: boolean;
  selection: boolean;
  active_state: boolean;
  color: boolean;
  monitoring: boolean;
}

export interface TrackBusGroup {
  id: string;
  name: string;
  color: string;
  active: boolean;
  track_ids: string[];
  sharing: TrackGroupSharing;
}

export interface OdeonProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  bpm: number | null;
  sample_rate: number;
  status: ProjectStatus;
  reference_track_id: string | null;
  tracks: OdeonTrack[];
  mix_moves: MixMove[];
  track_groups: TrackBusGroup[];
  report_path: string | null;
  folder_path: string | null;
  time_signature_numerator:   number | null;
  time_signature_denominator: number | null;
}

// ─────────────────────────────────────────────
//  Mix Blueprint (export format)
// ─────────────────────────────────────────────

export interface MixBlueprint {
  schema_version: "1.0";
  exported_at: string;
  project: {
    id: string;
    name: string;
    bpm: number | null;
    sample_rate: number;
  };
  reference_track: {
    id: string;
    name: string;
    stem_type: StemType;
    analysis: TrackAnalysis | null;
  } | null;
  user_tracks: Array<{
    id: string;
    name: string;
    stem_type: StemType;
    analysis: TrackAnalysis | null;
  }>;
  mix_moves: MixMove[];
  product_note: string;
}
