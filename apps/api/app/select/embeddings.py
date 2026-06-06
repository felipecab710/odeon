"""
Audio feature embeddings for semantic similarity search.

Layer 2a — Feature vectors (always available, no ML deps):
  7-dimensional vector per track:
    [bpm_norm, key_sin, key_cos, mode, lufs_norm, duration_norm, energy_proxy]
  Cosine similarity → "sounds similar" ranking.

Layer 2b — CLAP text-audio embeddings (optional, lazy-loaded):
  Requires: pip install laion-clap
  Enables:  natural-language queries ("dark minimal groover 124 BPM")
  Falls back gracefully if CLAP not installed.

Storage: vectors stored in SQLite as JSON blobs alongside the entry.
"""
from __future__ import annotations

import json
import math
import sqlite3
import threading
from typing import Any, Dict, List, Optional, Tuple

from ..db.repository import DB_PATH
from .models import CatalogEntry

# ─── Camelot wheel ────────────────────────────────────────────────────────────

_CAMELOT: Dict[str, Tuple[int, str]] = {
    "C maj": (8,"B"),  "C min": (5,"A"),
    "C# maj":(3,"B"),  "C# min":(12,"A"),
    "D maj": (10,"B"), "D min": (7,"A"),
    "D# maj":(5,"B"),  "D# min":(2,"A"),
    "E maj": (12,"B"), "E min": (9,"A"),
    "F maj": (7,"B"),  "F min": (4,"A"),
    "F# maj":(2,"B"),  "F# min":(11,"A"),
    "G maj": (9,"B"),  "G min": (6,"A"),
    "G# maj":(4,"B"),  "G# min":(1,"A"),
    "A maj": (11,"B"), "A min": (8,"A"),
    "A# maj":(6,"B"),  "A# min":(3,"A"),
    "B maj": (1,"B"),  "B min": (10,"A"),
}

# ─── SQLite table ─────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_embeddings_db() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS track_embeddings (
                entry_id    TEXT PRIMARY KEY,
                feature_vec TEXT,          -- JSON float array (7D)
                clap_vec    TEXT,          -- JSON float array (512D), nullable
                updated_at  TEXT
            )
        """)
        conn.commit()


# ─── Feature vector ───────────────────────────────────────────────────────────

def _feature_vec(e: CatalogEntry) -> Optional[List[float]]:
    """
    Build a 7-dimensional feature vector from existing metadata.
    Returns None if not enough data to compute a meaningful vector.
    """
    vec: List[float] = []

    # 0: BPM normalized to [0,1] over range 60–200
    if e.bpm is None:
        return None
    vec.append(max(0.0, min(1.0, (e.bpm - 60.0) / 140.0)))

    # 1,2: Camelot key as circular sin/cos (avoids 1-12 discontinuity)
    if e.key and e.key in _CAMELOT:
        num, mode = _CAMELOT[e.key]
        angle = (num - 1) / 12.0 * 2.0 * math.pi
        vec.append(math.sin(angle))
        vec.append(math.cos(angle))
        # 3: Mode — major=1, minor=0
        vec.append(1.0 if mode == "B" else 0.0)
    else:
        vec.extend([0.0, 0.0, 0.5])   # unknown key → neutral position

    # 4: LUFS normalized [-24, -4] → [0,1]  (louder = closer to 1)
    if e.integrated_lufs is not None:
        vec.append(max(0.0, min(1.0, (e.integrated_lufs + 24.0) / 20.0)))
    else:
        vec.append(0.5)

    # 5: Duration normalized [0,1] over 0–600s (10 min cap)
    if e.duration_seconds is not None:
        vec.append(min(1.0, e.duration_seconds / 600.0))
    else:
        vec.append(0.5)

    # 6: Energy proxy — BPM × LUFS normalised product
    #    High BPM + high loudness = high energy (peak-time)
    bpm_n = vec[0]
    lufs_n = vec[4]
    vec.append(bpm_n * lufs_n)

    return vec


def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


def upsert_feature_vec(entry_id: str, vec: List[float]) -> None:
    from datetime import datetime, timezone
    with _conn() as conn:
        conn.execute("""
            INSERT INTO track_embeddings (entry_id, feature_vec, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(entry_id) DO UPDATE SET
                feature_vec = excluded.feature_vec,
                updated_at  = excluded.updated_at
        """, (entry_id, json.dumps(vec), datetime.now(timezone.utc).isoformat()))
        conn.commit()


def get_feature_vec(entry_id: str) -> Optional[List[float]]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT feature_vec FROM track_embeddings WHERE entry_id = ?", (entry_id,)
        ).fetchone()
    if row and row["feature_vec"]:
        return json.loads(row["feature_vec"])
    return None


def similar_by_features(
    anchor: CatalogEntry,
    candidates: List[CatalogEntry],
    limit: int = 10,
    exclude_ids: Optional[set] = None,
) -> List[Tuple[float, CatalogEntry]]:
    """Return candidates sorted by cosine similarity to anchor."""
    av = _feature_vec(anchor)
    if av is None:
        return []

    exclude = exclude_ids or set()
    scored: List[Tuple[float, CatalogEntry]] = []

    for c in candidates:
        if c.id in exclude:
            continue
        cv = _feature_vec(c)
        if cv is None:
            continue
        scored.append((_cosine(av, cv), c))

    scored.sort(reverse=True)
    return scored[:limit]


# ─── CLAP (optional) ─────────────────────────────────────────────────────────

_clap_lock   = threading.Lock()
_clap_model  = None          # lazy-loaded
_clap_avail  = None          # None = unknown, True/False = checked

def _clap_status() -> bool:
    """True if laion-clap is installed and model is loadable."""
    global _clap_avail
    if _clap_avail is not None:
        return _clap_avail
    try:
        import laion_clap  # noqa: F401
        _clap_avail = True
    except ImportError:
        _clap_avail = False
    return _clap_avail


def _get_clap():
    """Lazy-load CLAP model (downloads ~400 MB on first call)."""
    global _clap_model
    if _clap_model is not None:
        return _clap_model
    with _clap_lock:
        if _clap_model is not None:
            return _clap_model
        import laion_clap
        model = laion_clap.CLAP_Module(enable_fusion=False, amodel="HTSAT-tiny")
        model.load_ckpt()   # downloads weights to ~/.cache/laion_clap/
        _clap_model = model
    return _clap_model


def embed_text_clap(query: str) -> Optional[List[float]]:
    """Embed a natural-language text query into 512-D CLAP space."""
    if not _clap_status():
        return None
    try:
        model = _get_clap()
        import numpy as np
        vec = model.get_text_embedding([query], use_tensor=False)[0]
        return vec.tolist()
    except Exception:
        return None


def embed_audio_clap(file_path: str) -> Optional[List[float]]:
    """Embed an audio file into 512-D CLAP space."""
    if not _clap_status():
        return None
    try:
        model = _get_clap()
        vec = model.get_audio_embedding_from_filelist([file_path], use_tensor=False)[0]
        # Store to DB
        return vec.tolist()
    except Exception:
        return None


def upsert_clap_vec(entry_id: str, vec: List[float]) -> None:
    from datetime import datetime, timezone
    with _conn() as conn:
        conn.execute("""
            INSERT INTO track_embeddings (entry_id, clap_vec, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(entry_id) DO UPDATE SET
                clap_vec   = excluded.clap_vec,
                updated_at = excluded.updated_at
        """, (entry_id, json.dumps(vec), datetime.now(timezone.utc).isoformat()))
        conn.commit()


def get_clap_vecs_all() -> Dict[str, List[float]]:
    """Return all stored CLAP vectors as {entry_id: vec}."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT entry_id, clap_vec FROM track_embeddings WHERE clap_vec IS NOT NULL"
        ).fetchall()
    return {r["entry_id"]: json.loads(r["clap_vec"]) for r in rows}


def get_feature_vecs_all() -> Dict[str, List[float]]:
    """Return all stored feature vectors as {entry_id: vec}."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT entry_id, feature_vec FROM track_embeddings WHERE feature_vec IS NOT NULL"
        ).fetchall()
    return {r["entry_id"]: json.loads(r["feature_vec"]) for r in rows}


# ─── Text query parser (no-ML fallback for semantic search) ──────────────────

import re

_ENERGY_KEYWORDS: Dict[str, float] = {
    "dark": -0.3, "heavy": 0.2, "peak": 0.9, "peak-time": 0.9,
    "peaktime": 0.9, "hard": 0.7, "driving": 0.6, "rolling": 0.4,
    "groovy": 0.3, "melodic": 0.2, "soft": -0.2, "chill": -0.4,
    "ambient": -0.5, "deep": 0.1, "minimal": 0.0, "techno": 0.7,
    "house": 0.4, "progressive": 0.3, "tech-house": 0.5, "tech house": 0.5,
    "tribal": 0.4, "acid": 0.6, "industrial": 0.8, "banging": 0.95,
    "underground": 0.5, "late night": 0.2, "sunrise": -0.1,
    "opening": -0.2, "closing": 0.3, "peak hour": 0.9,
}

_MODE_KEYWORDS: Dict[str, int] = {
    "minor": 0, "minor key": 0, "dark key": 0,
    "major": 1, "major key": 1, "happy": 1, "uplifting": 1,
}


def parse_text_query(query: str) -> Dict[str, Any]:
    """
    Parse a free-text DJ query into structured search parameters.

    Examples:
      "dark minimal groover 126 BPM" → {bpm: 126, bpm_tol: 5, energy: -0.1, mode: None}
      "peak time tech house 128-132"  → {bpm_min: 128, bpm_max: 132, energy: 0.7}
      "8B harmonics only"             → {camelot: "8B"}
      "A min melodic"                 → {key: "A min", energy: 0.2}
    """
    q = query.lower().strip()
    result: Dict[str, Any] = {"raw": query}

    # BPM range: "128-132" or "126-130 bpm"
    bpm_range = re.search(r"(\d{2,3})\s*[-–to]+\s*(\d{2,3})\s*(?:bpm)?", q)
    if bpm_range:
        result["bpm_min"] = float(bpm_range.group(1))
        result["bpm_max"] = float(bpm_range.group(2))
    else:
        # Single BPM: "126 bpm" or "at 128" or just "128"
        bpm_single = re.search(r"(?:at\s+|around\s+|@\s*)?(\d{2,3})\s*(?:bpm|beats)?", q)
        if bpm_single:
            bpm = float(bpm_single.group(1))
            if 60 <= bpm <= 200:
                result["bpm"] = bpm
                result["bpm_tol"] = 5.0

    # Camelot position: "8B", "12A", etc.
    camelot_match = re.search(r"\b(\d{1,2}[AB])\b", query, re.IGNORECASE)
    if camelot_match:
        result["camelot"] = camelot_match.group(1).upper()

    # Key name: "C# min", "A major", "G min"
    key_match = re.search(
        r"\b([A-Ga-g][#b]?)\s*(maj(?:or)?|min(?:or)?)\b", query, re.IGNORECASE
    )
    if key_match:
        note = key_match.group(1).upper()
        quality = "maj" if key_match.group(2).lower().startswith("maj") else "min"
        result["key"] = f"{note} {quality}"

    # Mode keywords
    for kw, mode_val in _MODE_KEYWORDS.items():
        if kw in q:
            result["mode"] = mode_val
            break

    # Energy from keyword accumulation
    energy_score = 0.0
    energy_hits  = 0
    for kw, score in _ENERGY_KEYWORDS.items():
        if kw in q:
            energy_score += score
            energy_hits += 1
    if energy_hits:
        result["energy"] = energy_score / energy_hits  # avg

    return result


# Camelot position string → (num, mode)
_CAMELOT_POS: Dict[str, Tuple[int, str]] = {
    f"{n}{'A' if m=='A' else 'B'}": (n, m)
    for (k, (n, m)) in _CAMELOT.items()
    for _ in [None]
}
# Build reverse map: camelot_str → (num, mode)
_CAMELOT_STR_TO_NM: Dict[str, Tuple[int, str]] = {}
for _k, (_n, _m) in _CAMELOT.items():
    _CAMELOT_STR_TO_NM[f"{_n}{'A' if _m=='A' else 'B'}"] = (_n, _m)


def score_entry_for_query(entry: CatalogEntry, parsed: Dict[str, Any]) -> float:
    """
    Score a library entry [0,1] for relevance to a parsed text query.
    Used when CLAP is unavailable.
    """
    score = 1.0
    penalties = 0

    # BPM match
    if "bpm" in parsed and entry.bpm is not None:
        delta = abs(entry.bpm - parsed["bpm"])
        tol   = parsed.get("bpm_tol", 5.0)
        if delta > tol * 3:
            return 0.0   # way off
        score *= max(0.0, 1.0 - delta / (tol * 2))
        penalties += 1
    if "bpm_min" in parsed and entry.bpm is not None:
        if not (parsed["bpm_min"] <= entry.bpm <= parsed["bpm_max"]):
            return 0.0

    # Camelot match (exact or adjacent ±1)
    if "camelot" in parsed and entry.key and entry.key in _CAMELOT:
        num, mode = _CAMELOT[entry.key]
        pos_str = f"{num}{'B' if mode=='B' else 'A'}"
        if pos_str == parsed["camelot"]:
            score *= 1.0
        else:
            # Adjacent on wheel
            target_nm = _CAMELOT_STR_TO_NM.get(parsed["camelot"])
            if target_nm:
                tnum, tmode = target_nm
                diff = min(abs(num - tnum), 12 - abs(num - tnum))
                if mode == tmode and diff <= 1:
                    score *= 0.85
                else:
                    score *= 0.5 if diff <= 2 else 0.1
        penalties += 1

    # Key name match
    if "key" in parsed and entry.key:
        kn = parsed["key"].lower().replace("major", "maj").replace("minor", "min")
        ek = entry.key.lower()
        if kn == ek:
            score *= 1.0
        elif kn.split()[0] == ek.split()[0]:   # same root, different mode
            score *= 0.7
        else:
            score *= 0.2
        penalties += 1

    # Mode match
    if "mode" in parsed and entry.key and entry.key in _CAMELOT:
        _, m = _CAMELOT[entry.key]
        is_major = (m == "B")
        if bool(parsed["mode"]) != is_major:
            score *= 0.4
        penalties += 1

    # Energy match (BPM × LUFS proxy)
    if "energy" in parsed and entry.bpm is not None and entry.integrated_lufs is not None:
        bpm_n = max(0.0, min(1.0, (entry.bpm - 60.0) / 140.0))
        lufs_n = max(0.0, min(1.0, (entry.integrated_lufs + 24.0) / 20.0))
        actual_energy = bpm_n * lufs_n * 2 - 0.5   # roughly -0.5 … +0.5
        target = parsed["energy"]
        diff = abs(actual_energy - target)
        score *= max(0.1, 1.0 - diff)
        penalties += 1

    return score if penalties > 0 else 0.5   # 0.5 if no criteria matched
