# Waveform Cache — `.odeon.wavecache` Format Spec (v2)

Every audio file imported into Odeon gets a binary sidecar next to it:

```
audio/my-track.wav
audio/my-track.wav.odeon.wavecache   ← sidecar (v2 binary)
```

## Why a Sidecar

Same pattern as Ableton (`.asd`) and Pro Tools (`.peak`): precompute peak pyramids at
ingest, never decode audio at display time. Waveform drawing is purely a data-lookup
operation at all zoom levels.

## V2 Binary Layout (little-endian)

```
Offset  Size  Field
──────  ────  ──────────────────────────────────────────────────────
0       4     magic = 0x4F445743 ('ODWC')
4       4     version = 2  (uint32)
8       4     meta_json_len  (uint32)
12      N     meta_json — UTF-8 JSON (see below)
12+N    M     data — per-level float32 arrays (see below)
```

### `meta_json` fields

| Field            | Type     | Description |
|------------------|----------|-------------|
| `version`        | int      | Always 2 |
| `sample_rate`    | int      | Source audio sample rate (Hz) |
| `channels`       | int      | 1 = mono, 2 = stereo |
| `duration_seconds` | float  | Total clip length |
| `global_peak`    | float    | Max absolute sample value (for normalisation) |
| `block_sizes`    | int[]    | Pyramid levels present, e.g. [64, 256, 1024, 4096, 16384] |
| `total_samples`  | int      | Samples in source (used to derive n_buckets per level) |
| `source_hash`    | string   | 16-char SHA-256 prefix of `path:mtime_ns:size_bytes` |
| `source`         | object   | `{path, size_bytes, mtime_ns}` |

### Data section

For each `block_size` in `block_sizes` (in order):

```
n_buckets = ceil(total_samples / block_size)
data      = n_buckets × 4 × float32 [lm, lx, rm, rx]
```

All values are normalised to `[-1, 1]` by dividing by `global_peak`.

- `lm` / `lx` — left channel min / max
- `rm` / `rx` — right channel min / max

## Pyramid Levels

| Block size | Samples/bucket | Coverage @44100 Hz |
|------------|----------------|-------------------|
| 64         | 64             | 1.45 ms (high-zoom) |
| 256        | 256            | 5.8 ms |
| 1024       | 1024           | 23 ms |
| 4096       | 4096           | 93 ms |
| 16384      | 16384          | 371 ms (overview) |

All levels are always included regardless of file length (v1 capped at 6000 buckets/level,
which caused fine levels to be dropped for any file > ~8 seconds at block_size=64).

## V1 Fallback

V1 files use plain JSON, versioned with `"version": 1`. The desktop cacheLoader detects
them by checking the first 4 bytes: if not `ODWC`, it attempts JSON parse. V1 files are
served read-only; they are not upgraded unless the user re-analyzes.

## LOD Selection (Desktop)

```
spp = sample_rate / pps           // samples per pixel at current zoom
lodBlockSize = largest block_size ≤ spp
```

Fine-peak mode (raw AudioBuffer scan) is disabled — all display uses pyramid levels.
At very high zoom (`spp < lodBlockSize`) the finest level (64 samples) provides
sub-2ms resolution which is imperceptible at screen pixel density.

## Performance Budget

| File         | Binary size | Parse time |
|--------------|-------------|------------|
| 3 min stereo | ≈ 2.8 MB    | < 15 ms    |
| 10 min stereo| ≈ 9.2 MB    | < 40 ms    |

Build time (NumPy vectorized): ≈ 0.3 s for 3 min WAV on Apple M2.
