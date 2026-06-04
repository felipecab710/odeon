"""
Core audio analysis functions for Odeon.

All functions are pure: given a file path or loaded audio array, return
structured data.  No side effects, no DB writes.

Confidence scores and warnings are explicit; no fake precision.
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path
from typing import Optional, Tuple

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from ..models import (
    FrequencyProfile,
    SectionEnergy,
    StereoProfile,
    TrackAnalysis,
)

# ─────────────────────────────────────────────
#  File inspection (no decoding)
# ─────────────────────────────────────────────

def inspect_audio(file_path: str) -> dict:
    """Return basic file metadata without full decode."""
    path = Path(file_path)
    info: dict = {"file_path": str(path), "exists": path.exists()}
    if not path.exists():
        return info
    try:
        sf_info = sf.info(str(path))
        info.update(
            {
                "duration_seconds": sf_info.duration,
                "sample_rate": sf_info.samplerate,
                "channels": sf_info.channels,
                "format": sf_info.format,
                "subtype": sf_info.subtype,
                "frames": sf_info.frames,
            }
        )
    except Exception as exc:
        info["inspect_error"] = str(exc)
    return info


# ─────────────────────────────────────────────
#  Loading
# ─────────────────────────────────────────────

def load_audio_mono_and_stereo(
    file_path: str,
    target_sr: int = 44100,
) -> Tuple[np.ndarray, Optional[np.ndarray], int]:
    """
    Returns (mono, stereo_or_None, actual_sr).
    stereo is None for mono-only sources.
    """
    audio_stereo, sr = librosa.load(file_path, sr=target_sr, mono=False)
    if audio_stereo.ndim == 1:
        mono = audio_stereo
        stereo = None
    else:
        stereo = audio_stereo
        mono = librosa.to_mono(stereo)
    return mono, stereo, sr


# ─────────────────────────────────────────────
#  Loudness
# ─────────────────────────────────────────────

def compute_loudness(file_path: str) -> dict:
    """
    Returns integrated LUFS, true-peak approximation, RMS, peak, crest factor.
    Uses pyloudnorm for integrated LUFS.
    """
    data, sr = sf.read(str(file_path), always_2d=True)

    # pyloudnorm expects (samples, channels)
    meter = pyln.Meter(sr)
    try:
        integrated_lufs = float(meter.integrated_loudness(data))
    except Exception:
        # file too short or silent
        integrated_lufs = -70.0

    # Work on mono for simple peak/RMS
    mono = data.mean(axis=1)

    rms = float(np.sqrt(np.mean(mono ** 2)))
    peak = float(np.max(np.abs(mono)))
    rms_db = _to_db(rms)
    peak_db = _to_db(peak)

    # True peak approximation (4x oversampled max)
    true_peak_db = _estimate_true_peak(data)

    crest_factor_db = peak_db - rms_db if rms > 0 else 0.0

    return {
        "integrated_lufs": integrated_lufs,
        "true_peak_db": true_peak_db,
        "rms_db": rms_db,
        "peak_db": peak_db,
        "crest_factor_db": crest_factor_db,
    }


def _to_db(linear: float, floor: float = -120.0) -> float:
    if linear <= 0:
        return floor
    return max(float(20.0 * math.log10(linear)), floor)


def _estimate_true_peak(data: np.ndarray) -> float:
    """Simple true peak: upsample 4× per channel, take max abs."""
    peaks = []
    for ch in range(data.shape[1]):
        upsampled = librosa.resample(
            data[:, ch].astype(np.float32), orig_sr=1, target_sr=4
        )
        peaks.append(np.max(np.abs(upsampled)))
    return _to_db(max(peaks)) if peaks else -120.0


# ─────────────────────────────────────────────
#  Frequency Profile
# ─────────────────────────────────────────────

_BANDS = [
    ("sub_20_60", 20, 60),
    ("bass_60_160", 60, 160),
    ("low_mid_160_500", 160, 500),
    ("mid_500_2000", 500, 2000),
    ("presence_2000_5000", 2000, 5000),
    ("brightness_5000_10000", 5000, 10000),
    ("air_10000_18000", 10000, 18000),
]


def compute_frequency_profile(mono: np.ndarray, sr: int) -> FrequencyProfile:
    """Average dB energy per frequency band using STFT magnitude."""
    n_fft = 4096
    hop_length = 1024
    stft = np.abs(librosa.stft(mono, n_fft=n_fft, hop_length=hop_length))

    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    # Mean magnitude over time frames, then average per band
    mean_mag = stft.mean(axis=1)  # shape: (n_fft//2+1,)

    band_db: dict = {}
    for name, lo, hi in _BANDS:
        mask = (freqs >= lo) & (freqs < hi)
        if mask.sum() == 0:
            band_db[name] = -120.0
        else:
            avg_mag = float(mean_mag[mask].mean())
            band_db[name] = _to_db(avg_mag)

    return FrequencyProfile(**band_db)


# ─────────────────────────────────────────────
#  Stereo Profile
# ─────────────────────────────────────────────

def compute_stereo_profile(stereo: np.ndarray, sr: int) -> StereoProfile:
    """
    stereo shape: (2, samples).
    Returns mid/side analysis + pan/width proxies.
    """
    left = stereo[0].astype(np.float64)
    right = stereo[1].astype(np.float64)

    mid = (left + right) / 2.0
    side = (left - right) / 2.0

    left_rms = float(np.sqrt(np.mean(left ** 2)))
    right_rms = float(np.sqrt(np.mean(right ** 2)))
    mid_energy = float(np.sqrt(np.mean(mid ** 2)))
    side_energy = float(np.sqrt(np.mean(side ** 2)))

    side_to_mid = side_energy / mid_energy if mid_energy > 1e-9 else 0.0

    # Phase correlation: Pearson between left and right
    if left.std() > 1e-9 and right.std() > 1e-9:
        corr = float(np.corrcoef(left, right)[0, 1])
    else:
        corr = 1.0

    # Pan proxy: (R-L)/(R+L) normalised to -1..1
    total = left_rms + right_rms
    pan_proxy = float((right_rms - left_rms) / total) if total > 1e-9 else 0.0

    # Width proxy: side/mid ratio clamped to 0..2
    width_proxy = float(min(side_to_mid, 2.0))

    return StereoProfile(
        left_rms=_to_db(left_rms),
        right_rms=_to_db(right_rms),
        mid_energy=_to_db(mid_energy),
        side_energy=_to_db(side_energy),
        side_to_mid_ratio=side_to_mid,
        phase_correlation=corr,
        pan_proxy=pan_proxy,
        width_proxy=width_proxy,
    )


# ─────────────────────────────────────────────
#  Tempo
# ─────────────────────────────────────────────

def estimate_tempo(mono: np.ndarray, sr: int) -> Optional[float]:
    try:
        tempo, _ = librosa.beat.beat_track(y=mono, sr=sr)
        val = float(tempo) if np.isscalar(tempo) else float(tempo[0])
        return round(val, 1) if val > 0 else None
    except Exception:
        return None


# ─────────────────────────────────────────────
#  Section detection (heuristic placeholder)
# ─────────────────────────────────────────────

def detect_sections_placeholder(
    mono: np.ndarray, sr: int, chunk_seconds: float = 8.0
) -> list[SectionEnergy]:
    """
    Energy-based section chunking.
    Labels are heuristic estimates; not ground truth.
    """
    chunk = int(chunk_seconds * sr)
    sections: list[SectionEnergy] = []
    labels = ["intro", "section_a", "section_b", "drop_candidate", "section_c", "outro"]

    for i, start in enumerate(range(0, len(mono), chunk)):
        end = min(start + chunk, len(mono))
        chunk_audio = mono[start:end]
        rms = float(np.sqrt(np.mean(chunk_audio ** 2)))
        rms_db = _to_db(rms)
        label = labels[min(i, len(labels) - 1)]
        sections.append(
            SectionEnergy(
                label=label,
                start_seconds=round(start / sr, 3),
                end_seconds=round(end / sr, 3),
                rms_db=rms_db,
            )
        )
    return sections


# ─────────────────────────────────────────────
#  Full analysis pipeline
# ─────────────────────────────────────────────

def analyze_track(file_path: str) -> TrackAnalysis:
    """Run the complete analysis pipeline for a single audio file."""
    warnings: list[str] = []

    info = inspect_audio(file_path)
    duration = float(info.get("duration_seconds", 0.0))
    sample_rate = int(info.get("sample_rate", 44100))
    channels = int(info.get("channels", 1))

    loudness = compute_loudness(file_path)

    mono, stereo, sr = load_audio_mono_and_stereo(file_path, target_sr=sample_rate)

    freq_profile = compute_frequency_profile(mono, sr)
    stereo_profile = compute_stereo_profile(stereo, sr) if stereo is not None else None
    if stereo is None:
        warnings.append("Mono source: stereo profile unavailable.")

    tempo = estimate_tempo(mono, sr)
    sections = detect_sections_placeholder(mono, sr)

    if stereo_profile and stereo_profile.width_proxy > 0.8 and freq_profile.sub_20_60 > -30:
        warnings.append(
            "Wide sub-bass detected. Consider mono-ing frequencies below 80 Hz."
        )

    return TrackAnalysis(
        duration_seconds=duration,
        sample_rate=sample_rate,
        channels=channels,
        integrated_lufs=loudness["integrated_lufs"],
        true_peak_db=loudness["true_peak_db"],
        rms_db=loudness["rms_db"],
        peak_db=loudness["peak_db"],
        crest_factor_db=loudness["crest_factor_db"],
        frequency_profile=freq_profile,
        stereo_profile=stereo_profile,
        tempo=tempo,
        section_energy=sections,
        warnings=warnings,
    )
