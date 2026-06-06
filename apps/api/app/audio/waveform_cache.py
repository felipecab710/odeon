"""
Pro Tools / Ableton-style waveform overview cache — v2.

V2 format (.odeon.wavecache):
  - Binary: magic(4) + version(4) + metadata_json_len(4) + metadata_json(UTF-8) + float32 data
  - All levels included regardless of length (no bucket cap); vectorized NumPy extraction
  - Backward-compatible read of v1 JSON sidecars

V1 format (.odeon.wavecache):
  - Plain JSON with lm/lx/rm/rx per bucket
  - Fine pyramid levels dropped for long files due to MAX_BUCKETS_PER_LEVEL cap
"""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path
from typing import Any

import numpy as np

CACHE_VERSION = 2
CACHE_VERSION_V1 = 1

# Binary magic: 'ODWC'
_MAGIC = b"ODWC"
# Optional trailing section: frequency color data
_COLR_MAGIC = b"COLR"
FREQ_COLOR_COLS = 256  # columns in COLR section

# Samples per peak bucket at each pyramid level (finest → coarsest)
PYRAMID_BLOCK_SIZES = [64, 256, 1024, 4096, 16384]


# ─────────────────────────────────────────────
#  Path helpers
# ─────────────────────────────────────────────

def cache_path_for(audio_path: str | Path) -> Path:
    p = Path(audio_path)
    return p.with_suffix(p.suffix + ".odeon.wavecache")


def _file_identity(audio_path: Path) -> dict[str, Any]:
    stat = audio_path.stat()
    return {
        "path": str(audio_path.resolve()),
        "size_bytes": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def _source_hash(audio_path: Path) -> str:
    stat = audio_path.stat()
    key = f"{audio_path.resolve()}:{stat.st_mtime_ns}:{stat.st_size}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# ─────────────────────────────────────────────
#  Vectorized peak extraction (no Python loops)
# ─────────────────────────────────────────────

def _vectorized_peaks(
    channel: np.ndarray,
    block_size: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (mins, maxs) Float32 arrays for every block_size bucket.
    Uses NumPy reshape + min/max — O(N) with SIMD acceleration."""
    total = len(channel)
    if total == 0:
        return np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32)

    n_blocks = (total + block_size - 1) // block_size
    # Pad to a multiple of block_size so we can reshape
    pad = n_blocks * block_size - total
    if pad:
        channel = np.pad(channel, (0, pad), constant_values=np.nan)

    matrix = channel.reshape(n_blocks, block_size)
    mins = np.nanmin(matrix, axis=1).astype(np.float32)
    maxs = np.nanmax(matrix, axis=1).astype(np.float32)
    return mins, maxs


def build_stereo_pyramid(
    left: np.ndarray,
    right: np.ndarray,
    sample_rate: int,
    duration_seconds: float,
    channels: int,
) -> dict[str, Any]:
    """Build min/max peak pyramid for stereo (or duplicated mono).

    All pyramid levels are included regardless of file length.
    Uses vectorized NumPy extraction — typically 10-50× faster than v1 Python loops.
    """
    global_peak = max(
        float(np.max(np.abs(left))) if len(left) else 0.0,
        float(np.max(np.abs(right))) if len(right) else 0.0,
        1e-9,
    )

    total_samples = max(len(left), len(right))
    levels: dict[str, list[dict[str, float]]] = {}
    used_block_sizes: list[int] = []

    for block_size in PYRAMID_BLOCK_SIZES:
        l_mins, l_maxs = _vectorized_peaks(left, block_size)
        r_mins, r_maxs = _vectorized_peaks(right, block_size)

        n = max(len(l_mins), len(r_mins))
        if n == 0:
            continue

        # Pad shorter channel if mono
        if len(l_mins) < n:
            l_mins = np.pad(l_mins, (0, n - len(l_mins)))
            l_maxs = np.pad(l_maxs, (0, n - len(l_maxs)))
        if len(r_mins) < n:
            r_mins = np.pad(r_mins, (0, n - len(r_mins)))
            r_maxs = np.pad(r_maxs, (0, n - len(r_maxs)))

        # Normalise to [-1, 1]
        inv = 1.0 / global_peak
        buckets = [
            {
                "lm": float(l_mins[i] * inv),
                "lx": float(l_maxs[i] * inv),
                "rm": float(r_mins[i] * inv),
                "rx": float(r_maxs[i] * inv),
            }
            for i in range(n)
        ]
        levels[str(block_size)] = buckets
        used_block_sizes.append(block_size)

    if not used_block_sizes:
        used_block_sizes = [PYRAMID_BLOCK_SIZES[-1]]

    return {
        "version": CACHE_VERSION,
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_seconds": duration_seconds,
        "global_peak": global_peak,
        "block_sizes": used_block_sizes,
        "levels": levels,
        "total_samples": total_samples,
    }


# ─────────────────────────────────────────────
#  Binary sidecar write / read (v2)
# ─────────────────────────────────────────────

def _build_colr_section(freq_colors: np.ndarray) -> bytes:
    """Encode (N, 3) uint8 freq_colors array as COLR section bytes."""
    n = freq_colors.shape[0]
    header = _COLR_MAGIC + struct.pack("<I", n)
    return header + freq_colors[:, 0].tobytes() + freq_colors[:, 1].tobytes() + freq_colors[:, 2].tobytes()


def _parse_colr_section(data: bytes, offset: int) -> tuple[np.ndarray | None, int]:
    """Try to read a COLR section starting at offset. Returns (array, new_offset) or (None, offset)."""
    if offset + 8 > len(data):
        return None, offset
    if data[offset:offset + 4] != _COLR_MAGIC:
        return None, offset
    n = struct.unpack_from("<I", data, offset + 4)[0]
    needed = 8 + n * 3
    if offset + needed > len(data):
        return None, offset
    base = offset + 8
    bass = np.frombuffer(data[base:base + n], dtype=np.uint8).copy()
    mid  = np.frombuffer(data[base + n:base + 2 * n], dtype=np.uint8).copy()
    high = np.frombuffer(data[base + 2 * n:base + 3 * n], dtype=np.uint8).copy()
    return np.stack([bass, mid, high], axis=1), offset + needed


def _pyramid_to_binary(pyramid: dict[str, Any], audio_path: Path, freq_colors: np.ndarray | None = None) -> bytes:
    """Encode pyramid as compact binary v2 sidecar.

    Layout:
        magic          4 bytes  b'ODWC'
        version        4 bytes  uint32 LE  = 2
        meta_json_len  4 bytes  uint32 LE
        meta_json      N bytes  UTF-8 JSON
        data           M bytes  per-level float32 interleaved [lm, lx, rm, rx] × n_buckets
    """
    meta = {
        "version": CACHE_VERSION,
        "sample_rate": pyramid["sample_rate"],
        "channels": pyramid["channels"],
        "duration_seconds": pyramid["duration_seconds"],
        "global_peak": pyramid["global_peak"],
        "block_sizes": pyramid["block_sizes"],
        "total_samples": pyramid.get("total_samples", 0),
        "source_hash": _source_hash(audio_path),
        "source": _file_identity(audio_path),
    }
    meta_json = json.dumps(meta, separators=(",", ":")).encode("utf-8")

    header = _MAGIC + struct.pack("<II", CACHE_VERSION, len(meta_json))
    body = bytearray()

    for block_size in pyramid["block_sizes"]:
        buckets = pyramid["levels"].get(str(block_size), [])
        arr = np.empty(len(buckets) * 4, dtype=np.float32)
        for i, b in enumerate(buckets):
            base = i * 4
            arr[base] = b["lm"]
            arr[base + 1] = b["lx"]
            arr[base + 2] = b["rm"]
            arr[base + 3] = b["rx"]
        body.extend(arr.tobytes())

    result = header + meta_json + bytes(body)
    if freq_colors is not None and freq_colors.shape == (FREQ_COLOR_COLS, 3):
        result += _build_colr_section(freq_colors)
    return result


def _binary_to_pyramid(data: bytes) -> dict[str, Any] | None:
    """Decode a v2 binary sidecar back into the same dict shape as v1 JSON."""
    if len(data) < 12:
        return None
    magic = data[:4]
    if magic != _MAGIC:
        return None

    version, meta_len = struct.unpack_from("<II", data, 4)
    if version != CACHE_VERSION:
        return None

    meta_start = 12
    meta_end = meta_start + meta_len
    if meta_end > len(data):
        return None

    try:
        meta = json.loads(data[meta_start:meta_end].decode("utf-8"))
    except Exception:
        return None

    offset = meta_end
    levels: dict[str, list[dict[str, float]]] = {}
    global_peak = meta.get("global_peak", 1.0)
    total_samples = meta.get("total_samples", 0)

    for block_size in meta.get("block_sizes", []):
        n_buckets = (total_samples + block_size - 1) // block_size if total_samples else 0
        byte_len = n_buckets * 4 * 4  # 4 floats × 4 bytes
        if offset + byte_len > len(data):
            break
        arr = np.frombuffer(data[offset:offset + byte_len], dtype=np.float32)
        offset += byte_len

        buckets = []
        for i in range(n_buckets):
            base = i * 4
            buckets.append({
                "lm": float(arr[base]),
                "lx": float(arr[base + 1]),
                "rm": float(arr[base + 2]),
                "rx": float(arr[base + 3]),
            })
        levels[str(block_size)] = buckets

    freq_colors, _ = _parse_colr_section(data, offset)

    return {
        "version": CACHE_VERSION,
        "sample_rate": meta["sample_rate"],
        "channels": meta["channels"],
        "duration_seconds": meta["duration_seconds"],
        "global_peak": global_peak,
        "block_sizes": meta["block_sizes"],
        "levels": levels,
        "source_hash": meta.get("source_hash"),
        "freq_colors": freq_colors,  # (256, 3) uint8 or None
    }


# ─────────────────────────────────────────────
#  Public write / read API
# ─────────────────────────────────────────────

def write_waveform_cache(
    audio_path: str | Path,
    pyramid: dict[str, Any],
    freq_colors: np.ndarray | None = None,
) -> Path:
    """Write v2 binary sidecar next to audio_path."""
    audio_path = Path(audio_path)
    dest = cache_path_for(audio_path)
    dest.write_bytes(_pyramid_to_binary(pyramid, audio_path, freq_colors))
    return dest


def read_waveform_cache(audio_path: str | Path) -> dict[str, Any] | None:
    """Read sidecar for audio_path. Handles v2 binary and v1 JSON."""
    dest = cache_path_for(audio_path)
    if not dest.exists():
        return None
    try:
        raw = dest.read_bytes()
        # Try v2 binary first
        if raw[:4] == _MAGIC:
            return _binary_to_pyramid(raw)
        # Fall back to v1 JSON
        data = json.loads(raw.decode("utf-8"))
        if data.get("version") != CACHE_VERSION_V1:
            return None
        return data
    except Exception:
        return None


def read_waveform_cache_as_json(audio_path: str | Path) -> dict[str, Any] | None:
    """Read sidecar and return as JSON-serialisable dict (for HTTP endpoint)."""
    return read_waveform_cache(audio_path)


def read_waveform_cache_tile(
    audio_path: str | Path,
    block_size: int,
    chunk_index: int,
    chunk_size: int = 6000,
) -> dict[str, Any] | None:
    """Return a slice of one pyramid level for partial (tile) loading.

    chunk_index 0 = buckets 0..chunk_size-1, index 1 = chunk_size..2*chunk_size-1, etc.
    Used by the tile API endpoint for very long files.
    """
    pyramid = read_waveform_cache(audio_path)
    if pyramid is None:
        return None
    level_key = str(block_size)
    buckets = pyramid.get("levels", {}).get(level_key)
    if buckets is None:
        return None
    start = chunk_index * chunk_size
    end = start + chunk_size
    return {
        "version": CACHE_VERSION,
        "block_size": block_size,
        "chunk_index": chunk_index,
        "chunk_size": chunk_size,
        "total_buckets": len(buckets),
        "sample_rate": pyramid["sample_rate"],
        "duration_seconds": pyramid["duration_seconds"],
        "global_peak": pyramid["global_peak"],
        "buckets": buckets[start:end],
    }


def load_audio_stereo(file_path: str) -> tuple[np.ndarray, np.ndarray, int, float, int]:
    """Load L/R channels from WAV/AIFF; falls back to librosa for compressed formats."""
    import librosa
    import soundfile as sf

    try:
        info = sf.info(str(file_path))
        data, sr = sf.read(str(file_path), dtype="float32", always_2d=True)
        left = data[:, 0]
        right = data[:, 1] if data.shape[1] > 1 else data[:, 0]
        return left, right, int(sr), float(info.duration), int(info.channels)
    except Exception:
        stereo, sr = librosa.load(str(file_path), sr=None, mono=False)
        if stereo.ndim == 1:
            return stereo, stereo, int(sr), float(len(stereo) / sr), 1
        left = stereo[0] if stereo.ndim == 2 else stereo
        right = stereo[1] if (stereo.ndim == 2 and stereo.shape[0] > 1) else left
        channels = 2 if stereo.ndim == 2 and stereo.shape[0] > 1 else 1
        return left, right, int(sr), float(len(left) / sr), channels


def build_and_cache_from_arrays(
    audio_path: str | Path,
    left: np.ndarray,
    right: np.ndarray,
    sample_rate: int,
    duration_seconds: float,
    channels: int,
    freq_colors: np.ndarray | None = None,
) -> tuple[dict[str, Any], Path]:
    """Build v2 pyramid from in-memory channels and write binary sidecar."""
    pyramid = build_stereo_pyramid(left, right, sample_rate, duration_seconds, channels)
    path = write_waveform_cache(audio_path, pyramid, freq_colors)
    return pyramid, path


def build_and_cache_waveform(audio_path: str | Path) -> tuple[dict[str, Any], Path]:
    left, right, sr, duration, channels = load_audio_stereo(str(audio_path))
    return build_and_cache_from_arrays(audio_path, left, right, sr, duration, channels)
