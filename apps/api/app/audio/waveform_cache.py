"""
Pro Tools-style waveform overview cache.

Builds a multi-resolution min/max peak pyramid and persists it as a sidecar
`.odeon.wavecache` JSON file next to the source audio.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

CACHE_VERSION = 1
# Samples per peak bucket at each pyramid level (finest → coarsest)
PYRAMID_BLOCK_SIZES = [64, 256, 1024, 4096, 16384]
# Cap buckets per level — keeps sidecar JSON small and fast to parse in the UI
MAX_BUCKETS_PER_LEVEL = 6000


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


def _channel_peaks(channel: np.ndarray, block_size: int) -> list[dict[str, float]]:
    total = len(channel)
    if total == 0:
        return []
    n_blocks = (total + block_size - 1) // block_size
    out: list[dict[str, float]] = []
    for i in range(n_blocks):
        start = i * block_size
        end = min(start + block_size, total)
        chunk = channel[start:end]
        if len(chunk) == 0:
            out.append({"min": 0.0, "max": 0.0})
        else:
            out.append({"min": float(chunk.min()), "max": float(chunk.max())})
    return out


def build_stereo_pyramid(
    left: np.ndarray,
    right: np.ndarray,
    sample_rate: int,
    duration_seconds: float,
    channels: int,
) -> dict[str, Any]:
    """Build min/max peak pyramid for stereo (or duplicated mono)."""
    global_peak = max(
        float(np.max(np.abs(left))) if len(left) else 0.0,
        float(np.max(np.abs(right))) if len(right) else 0.0,
        1e-9,
    )

    levels: dict[str, list[dict[str, float]]] = {}
    used_block_sizes: list[int] = []
    total_samples = max(len(left), len(right))
    for block_size in PYRAMID_BLOCK_SIZES:
        n_blocks = (total_samples + block_size - 1) // block_size
        if n_blocks > MAX_BUCKETS_PER_LEVEL:
            continue
        used_block_sizes.append(block_size)
        l_peaks = _channel_peaks(left, block_size)
        r_peaks = _channel_peaks(right, block_size)
        n = max(len(l_peaks), len(r_peaks))
        merged: list[dict[str, float]] = []
        for i in range(n):
            lp = l_peaks[i] if i < len(l_peaks) else {"min": 0.0, "max": 0.0}
            rp = r_peaks[i] if i < len(r_peaks) else {"min": 0.0, "max": 0.0}
            merged.append({
                "lm": lp["min"] / global_peak,
                "lx": lp["max"] / global_peak,
                "rm": rp["min"] / global_peak,
                "rx": rp["max"] / global_peak,
            })
        levels[str(block_size)] = merged

    return {
        "version": CACHE_VERSION,
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_seconds": duration_seconds,
        "global_peak": global_peak,
        "block_sizes": used_block_sizes or [PYRAMID_BLOCK_SIZES[-1]],
        "levels": levels,
    }


def write_waveform_cache(audio_path: str | Path, pyramid: dict[str, Any]) -> Path:
    audio_path = Path(audio_path)
    dest = cache_path_for(audio_path)
    payload = {
        **pyramid,
        "source": _file_identity(audio_path),
        "source_hash": hashlib.sha256(
            f"{audio_path.resolve()}:{audio_path.stat().st_mtime_ns}:{audio_path.stat().st_size}".encode()
        ).hexdigest()[:16],
    }
    dest.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return dest


def read_waveform_cache(audio_path: str | Path) -> dict[str, Any] | None:
    dest = cache_path_for(audio_path)
    if not dest.exists():
        return None
    try:
        data = json.loads(dest.read_text(encoding="utf-8"))
        if data.get("version") != CACHE_VERSION:
            return None
        return data
    except Exception:
        return None


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
        return stereo[:, 0], stereo[:, 1] if stereo.shape[1] > 1 else stereo[:, 0], int(sr), float(len(stereo) / sr), int(stereo.shape[1])


def build_and_cache_from_arrays(
    audio_path: str | Path,
    left: np.ndarray,
    right: np.ndarray,
    sample_rate: int,
    duration_seconds: float,
    channels: int,
) -> tuple[dict[str, Any], Path]:
    """Build pyramid from in-memory channels (avoids re-reading the file)."""
    pyramid = build_stereo_pyramid(left, right, sample_rate, duration_seconds, channels)
    path = write_waveform_cache(audio_path, pyramid)
    return pyramid, path


def build_and_cache_waveform(audio_path: str | Path) -> tuple[dict[str, Any], Path]:
    left, right, sr, duration, channels = load_audio_stereo(str(audio_path))
    return build_and_cache_from_arrays(audio_path, left, right, sr, duration, channels)
