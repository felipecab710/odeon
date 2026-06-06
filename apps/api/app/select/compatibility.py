"""
Camelot Wheel key compatibility and BPM/loudness scoring for Select.
"""
from __future__ import annotations

import math
from typing import Optional

from .models import CatalogEntry, CompatibilityScore

# Camelot wheel — maps key string to (number, mode) tuple
# mode: 'A' = minor, 'B' = major
_CAMELOT: dict[str, tuple[int, str]] = {
    "C maj":  (8, "B"),  "C min":  (5, "A"),
    "C# maj": (3, "B"),  "C# min": (12, "A"),
    "D maj":  (10, "B"), "D min":  (7, "A"),
    "D# maj": (5, "B"),  "D# min": (2, "A"),
    "E maj":  (12, "B"), "E min":  (9, "A"),
    "F maj":  (7, "B"),  "F min":  (4, "A"),
    "F# maj": (2, "B"),  "F# min": (11, "A"),
    "G maj":  (9, "B"),  "G min":  (6, "A"),
    "G# maj": (4, "B"),  "G# min": (1, "A"),
    "A maj":  (11, "B"), "A min":  (8, "A"),
    "A# maj": (6, "B"),  "A# min": (3, "A"),
    "B maj":  (1, "B"),  "B min":  (10, "A"),
}


def _camelot_distance(key_a: str, key_b: str) -> Optional[float]:
    """Return Camelot distance 0..1 (0 = identical, 1 = maximum clash)."""
    ca = _CAMELOT.get(key_a)
    cb = _CAMELOT.get(key_b)
    if ca is None or cb is None:
        return None
    num_a, mode_a = ca
    num_b, mode_b = cb

    if mode_a == mode_b:
        # Same mode — circular distance on 12-position wheel
        diff = min(abs(num_a - num_b), 12 - abs(num_a - num_b))
        return diff / 6.0  # normalize to [0,1]

    # Different mode (major↔minor) — parallel key = 0.2, relative = 0.1
    if num_a == num_b:
        return 0.2   # parallel (same root, different mode)
    return 0.5 + min(abs(num_a - num_b), 12 - abs(num_a - num_b)) / 24.0


def score(entry_a: CatalogEntry, entry_b: CatalogEntry) -> CompatibilityScore:
    bpm_delta = None
    if entry_a.bpm and entry_b.bpm:
        bpm_delta = abs(entry_a.bpm - entry_b.bpm)

    key_compat = None
    if entry_a.key and entry_b.key:
        d = _camelot_distance(entry_a.key, entry_b.key)
        if d is not None:
            key_compat = 1.0 - d

    lufs_delta = None
    if entry_a.integrated_lufs is not None and entry_b.integrated_lufs is not None:
        lufs_delta = abs(entry_a.integrated_lufs - entry_b.integrated_lufs)

    # Weighted overall: key (50%), bpm_closeness (30%), lufs (20%)
    factors = []
    if key_compat is not None:
        factors.append((key_compat, 0.5))
    if bpm_delta is not None:
        bpm_score = max(0.0, 1.0 - bpm_delta / 20.0)
        factors.append((bpm_score, 0.3))
    if lufs_delta is not None:
        lufs_score = max(0.0, 1.0 - lufs_delta / 12.0)
        factors.append((lufs_score, 0.2))

    overall: Optional[float] = None
    if factors:
        total_weight = sum(w for _, w in factors)
        overall = sum(v * w for v, w in factors) / total_weight

    return CompatibilityScore(
        entry_id_a=entry_a.id,
        entry_id_b=entry_b.id,
        bpm_delta=bpm_delta,
        key_compat=key_compat,
        lufs_delta=lufs_delta,
        overall=overall,
    )
