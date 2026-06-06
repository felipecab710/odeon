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
