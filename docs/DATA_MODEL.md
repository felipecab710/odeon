# Data Model

All types are defined in `packages/shared/src/types.ts` (TypeScript) and mirrored as Pydantic models in `apps/api/app/models.py`.

Field names are identical across both sides so serialized JSON is compatible.

---

## OdeonProject

The root document for a session.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique project identifier |
| `name` | string | Human-readable name |
| `created_at` | ISO-8601 string | Creation timestamp |
| `updated_at` | ISO-8601 string | Last modified timestamp |
| `bpm` | number \| null | Estimated BPM (from reference analysis) |
| `sample_rate` | number | Project sample rate (from reference file) |
| `status` | ProjectStatus | Current workflow state |
| `reference_track_id` | string \| null | ID of the Reference Full Mix track |
| `tracks` | OdeonTrack[] | All tracks in the session |
| `mix_moves` | MixMove[] | Generated mix moves |
| `report_path` | string \| null | Path to an optional HTML/PDF report |

### ProjectStatus values

`empty` → `reference_uploaded` → `stems_separated` → `user_stems_imported` → `analyzed` → `compared` → `ready`

---

## OdeonTrack

A single audio track in the session.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique track identifier |
| `project_id` | string | Parent project ID |
| `name` | string | Display name (e.g. "Reference Bass") |
| `role` | TrackRole | `reference_full_mix` \| `reference_stem` \| `user_stem` \| `analysis` |
| `stem_type` | StemType | `full_mix` \| `drums` \| `bass` \| `vocals` \| `music` \| `other` \| `fx` \| `unknown` |
| `file_path` | string | Absolute path to the WAV file |
| `color` | string (hex) | Track colour in the UI |
| `muted` | boolean | Mute state |
| `soloed` | boolean | Solo state |
| `volume_db` | number | Fader volume in dB (0.0 = unity) |
| `pan` | number | Pan position (-1.0 = full left, 1.0 = full right) |
| `clip_start_seconds` | number | Clip position on the timeline |
| `analysis_status` | AnalysisStatus | `pending` \| `analyzing` \| `complete` \| `failed` \| `skipped` |
| `analysis` | TrackAnalysis \| null | Analysis results when complete |

---

## TrackAnalysis

Results from the analysis pipeline for a single track.

| Field | Type | Description |
|-------|------|-------------|
| `duration_seconds` | number | File duration |
| `sample_rate` | number | Native sample rate |
| `channels` | number | 1 (mono) or 2 (stereo) |
| `integrated_lufs` | number | Integrated loudness (ITU-R BS.1770) |
| `true_peak_db` | number | True peak approximation (4× oversampled) |
| `rms_db` | number | RMS level in dBFS |
| `peak_db` | number | Sample peak in dBFS |
| `crest_factor_db` | number | peak_db − rms_db (dynamics indicator) |
| `frequency_profile` | FrequencyProfile \| null | Average energy per frequency band |
| `stereo_profile` | StereoProfile \| null | Stereo/mid-side analysis |
| `tempo` | number \| null | Estimated BPM (librosa) |
| `section_energy` | SectionEnergy[] \| null | Heuristic section chunks |
| `warnings` | string[] | Analysis warnings (e.g. wide sub-bass) |

---

## FrequencyProfile

Average dB energy (from STFT) per frequency band.

| Field | Frequency Range |
|-------|----------------|
| `sub_20_60` | 20–60 Hz (sub-bass) |
| `bass_60_160` | 60–160 Hz (bass) |
| `low_mid_160_500` | 160–500 Hz (low-mid) |
| `mid_500_2000` | 500–2000 Hz (mid) |
| `presence_2000_5000` | 2–5 kHz (presence) |
| `brightness_5000_10000` | 5–10 kHz (brightness) |
| `air_10000_18000` | 10–18 kHz (air) |

---

## StereoProfile

Mid-side stereo analysis.

| Field | Description |
|-------|-------------|
| `left_rms` | Left channel RMS in dBFS |
| `right_rms` | Right channel RMS in dBFS |
| `mid_energy` | Mid (L+R)/2 RMS in dBFS |
| `side_energy` | Side (L−R)/2 RMS in dBFS |
| `side_to_mid_ratio` | side_energy / mid_energy (linear) |
| `phase_correlation` | Pearson correlation between L and R (−1..1) |
| `pan_proxy` | (R_rms − L_rms) / (R_rms + L_rms) → −1..1 |
| `width_proxy` | side_to_mid_ratio clamped to 0..2 |

---

## MixMove

A single actionable mix recommendation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique move identifier |
| `target_track_id` | string | User track this applies to |
| `reference_track_id` | string | Reference track it was derived from |
| `category` | MixMoveCategory | `level` \| `pan` \| `eq` \| `compression` \| `reverb` \| `stereo` \| `arrangement` |
| `observation` | string | Plain-English description of what was detected |
| `suggested_action` | string | Plain-English action to take |
| `confidence` | number (0–1) | Estimated confidence |
| `evidence` | MixMoveEvidence | Raw numbers supporting the observation |
| `daw_ready_parameters` | DawReadyParameters | Machine-readable parameters for DAW import |
| `status` | MixMoveStatus | `suggested` \| `accepted` \| `ignored` |

---

## MixBlueprint (export)

The full export document returned by `GET /projects/{id}/export-blueprint`.

```json
{
  "schema_version": "1.0",
  "exported_at": "2026-06-03T00:00:00Z",
  "project": { "id": "...", "name": "...", "bpm": 128, "sample_rate": 44100 },
  "reference_track": { "id": "...", "name": "...", "stem_type": "full_mix", "analysis": {...} },
  "user_tracks": [ { "id": "...", "name": "...", "stem_type": "drums", "analysis": {...} } ],
  "mix_moves": [ ... ],
  "product_note": "Odeon estimates plausible mix characteristics..."
}
```
