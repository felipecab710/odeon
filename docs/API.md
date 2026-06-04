# API Reference

Base URL: `http://localhost:8000`

All request/response bodies are JSON. File uploads use multipart/form-data.

---

## Health

### `GET /health`

Returns API status and stem separator availability.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "stem_separator": "NoOpStemSeparator",
  "stem_separation_available": false
}
```

---

## Projects

### `POST /projects?name=<string>`

Create a new Odeon project.

**Response**: `OdeonProject`

---

### `GET /projects/{project_id}`

Fetch the full project.

**Response**: `OdeonProject`

---

### `GET /projects/{project_id}/tracks`

Fetch tracks for a project.

**Response**: `OdeonTrack[]`

---

### `GET /projects/{project_id}/mix-moves`

Fetch generated mix moves.

**Response**: `MixMove[]`

---

## Reference Upload

### `POST /projects/{project_id}/reference`

Upload a reference WAV. Triggers full analysis and optional stem separation.

**Body**: `multipart/form-data` with field `file` (WAV/FLAC/AIFF)

**Returns**: Updated `OdeonProject` with:
- Reference Full Mix track (role: `reference_full_mix`, analyzed)
- Reference stem tracks if Demucs is installed (role: `reference_stem`)

---

## User Stems

### `POST /projects/{project_id}/user-stems`

Upload one or more user stems. Triggers analysis on each.

**Body**: `multipart/form-data` with field `files[]` (multiple WAV files)

**Stem type is guessed from filename**:
- Contains "drum", "kick", "snare", "hat", "perc" → `drums`
- Contains "bass" → `bass`
- Contains "voc", "vocal", "voice", "lead", "bg" → `vocals`
- Contains "synth", "keys", "piano", "guitar", "music", "melody" → `music`
- Contains "fx", "effect", "sfx", "foley" → `fx`
- Else → `unknown`

**Returns**: Updated `OdeonProject`

---

## Analysis

### `POST /projects/{project_id}/analyze`

Re-analyze all tracks with `pending` or `failed` status.

**Returns**: Updated `OdeonProject` with all analyses populated.

---

## Comparison

### `POST /projects/{project_id}/compare`

Compare user stems against reference tracks and generate MixMoves.

**Query params** (both optional):
- `user_track_id` — compare a specific user track
- `ref_track_id` — against a specific reference track

If neither is provided: auto-pairs user stems to reference stems by `stem_type`.
Unmatched user stems fall back to the full mix reference.

**Returns**: Updated `OdeonProject` with `mix_moves` populated.

---

## Export

### `GET /projects/{project_id}/export-blueprint`

Export the full Mix Blueprint JSON.

**Response**: `MixBlueprint`

```json
{
  "schema_version": "1.0",
  "exported_at": "...",
  "project": { "id": "...", "name": "...", "bpm": 128, "sample_rate": 44100 },
  "reference_track": { "id": "...", "name": "...", "stem_type": "full_mix", "analysis": {...} },
  "user_tracks": [...],
  "mix_moves": [...],
  "product_note": "Odeon estimates plausible mix characteristics..."
}
```

---

## Error Responses

```json
{ "detail": "Project 'abc' not found." }
```

HTTP status codes follow standard REST conventions (404, 422, 500).
