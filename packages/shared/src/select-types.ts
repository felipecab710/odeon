// ─────────────────────────────────────────────
//  Odeon Select — shared TypeScript types
//  Mirror of apps/api/app/select/models.py
// ─────────────────────────────────────────────

export type CatalogEntryStatus = "pending" | "analyzing" | "ready" | "error";

export type MarkerType = "hot_cue" | "memory" | "cue" | "loop";

export interface CatalogMarker {
  id:                string;
  entry_id:          string;
  type:              MarkerType;
  time_seconds:      number;
  end_time_seconds?: number | null;
  label?:            string | null;
  color:             string;
  created_at?:       string | null;
}

export interface CreateMarkerRequest {
  type:              MarkerType;
  time_seconds:      number;
  end_time_seconds?: number | null;
  label?:            string | null;
  color:             string;
}

export interface CatalogEntry {
  id:                  string;
  file_path:           string;
  file_name:           string;
  // ID3 / tag metadata
  title?:              string | null;
  artist?:             string | null;
  album?:              string | null;
  has_artwork?:        boolean;
  // Analysis results
  duration_seconds?:   number | null;
  sample_rate?:        number | null;
  channels?:           number | null;
  bpm?:                number | null;
  key?:                string | null;
  integrated_lufs?:    number | null;
  true_peak_db?:       number | null;
  rms_db?:             number | null;
  waveform_cache_path?: string | null;
  beat_times?:         number[] | null;
  tags:                string[];
  collection_ids:      string[];
  status:              CatalogEntryStatus;
  added_at?:           string | null;
  error_message?:      string | null;
}

export interface CatalogCollection {
  id:          string;
  name:        string;
  description?: string | null;
  entry_ids:   string[];
  created_at?: string | null;
}

export interface ImportFolderRequest {
  folder_path:      string;
  recursive:        boolean;
  extensions?:      string[];
  collection_name?: string;
}

export interface CompatibilityScore {
  entry_id_a:  string;
  entry_id_b:  string;
  bpm_delta?:  number | null;
  key_compat?: number | null;
  lufs_delta?: number | null;
  overall?:    number | null;
}

export interface SelectStats {
  total_entries:    number;
  ready_entries:    number;
  total_duration_s: number;
  collections:      number;
}

// ── ML pipeline types ─────────────────────────────────────────────

export interface TrackSection {
  label:           string;
  start_seconds:   number;
  end_seconds:     number;
  bars:            number;
}

export interface SelectTrackAnalysis {
  source?:              string;
  sections?:            TrackSection[];
  mix_in_safe?:         boolean;
  mix_out_safe?:        boolean;
  vocal_enters_seconds?: number | null;
  energy_arc?:          string;
  rhythm_pattern?:      string;
  mood?:                string;
  transition_notes?:    string;
  bpm?:                 number;
  beat_times?:          number[];
}

export interface TransitionStep {
  bar:     number;
  action:  string;
  freq_hz?: number;
  duration_bars?: number;
}

export interface TransitionPlan {
  status:                  string;
  source?:                 string;
  mix_out_bar?:            number;
  mix_in_bar?:             number;
  transition_length_bars?: number;
  strategy?:               string;
  steps?:                  TransitionStep[];
  reason?:                 string;
  bpm_a?:                  number;
  bpm_b?:                  number;
}

export interface StemPaths {
  entry_id:     string;
  job_id?:      string;
  vocals_path?: string | null;
  drums_path?:  string | null;
  bass_path?:   string | null;
  other_path?:  string | null;
}

export interface GenerationResult {
  status:            string;
  source?:           string;
  job_id?:           string;
  local_path?:       string;
  duration_seconds?: number;
  bpm?:              number;
  key?:              string;
  bars?:             number;
}
