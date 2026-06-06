# Odeon Select

Select is the catalog intelligence layer of Odeon. It lets you build a library of audio
files, analyze them (BPM, key, loudness), filter and search, organize into collections,
and score compatibility between tracks — all without opening a Studio session.

## Navigation

The **NavBar** at the top of the Odeon window routes between:

- **Studio** — the main DAW session editor
- **Select** — this catalog view
- **Research** — (coming) spectral analysis, reference browsing
- **Settings** — playback engine configuration

## API Endpoints (`/select/*`)

All endpoints are served by `apps/api` on `localhost:8000`.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/select/entries` | List all catalog entries (filterable by status, collection) |
| `GET`  | `/select/entries/{id}` | Single entry |
| `DELETE` | `/select/entries/{id}` | Remove entry |
| `POST` | `/select/import` | Scan folder → add audio files as pending entries |
| `POST` | `/select/entries/{id}/analyze` | Enqueue full analysis (background) |
| `POST` | `/select/analyze-all` | Enqueue all pending entries |
| `PATCH` | `/select/entries/{id}/tags` | Update tags |
| `GET`  | `/select/collections` | List collections |
| `POST` | `/select/collections` | Create collection |
| `DELETE` | `/select/collections/{id}` | Delete collection |
| `GET`  | `/select/compatibility?entry_id_a=&entry_id_b=` | BPM + key + LUFS compatibility score |
| `GET`  | `/select/stats` | Aggregate stats |

## Key Estimation

`estimate_key_placeholder()` in `analysis.py` uses librosa chroma CQT to estimate
the tonic and mode. Accuracy is ±1 semitone — suitable for catalog browsing. The UI
labels the result "estimated" to reflect this.

## Compatibility Scoring

Uses the Camelot Wheel model:
- Identical key: 1.0
- Adjacent keys (1 step): ~0.83
- Relative major/minor: ~0.87
- Parallel major/minor: ~0.8
- Maximum distance (tritone): ~0.5

Weighted overall = 50% key + 30% BPM closeness + 20% LUFS delta.

## Waveform Preview

`TrackProfilePanel` in the Select UI uses the same `WaveformCanvas` + v2 sidecar
pipeline as Studio tracks. The sidecar is read via the standard
`GET /waveform-cache?path=&format=binary` endpoint, and tile-based rendering
produces a mini waveform preview alongside metadata.

## Data Storage

All Select data is persisted in the same SQLite database as Studio projects
(`audio/odeon.db`), in two tables:

- `select_entries` — one row per audio file
- `select_collections` — named groupings of entries

## Studio Integration

- When stem separation succeeds (Demucs available), `reference_stem` tracks are
  inserted into the Studio session as real decoded stems.
- When stem separation is unavailable (NoOp separator), placeholder `reference_stem`
  tracks are inserted with `muted=true` and `analysis_status=pending`. These display
  a "Stem separation pending" label in the TrackLane header.
