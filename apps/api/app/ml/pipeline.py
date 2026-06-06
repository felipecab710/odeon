"""
ML pipeline orchestration — embed, analyze, store results in SQLite.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .runpod_client import embed_file, embed_text, is_configured, get_status
from ..select.repository import get_entry, list_entries
from ..db.repository import DB_PATH
import sqlite3

logger = logging.getLogger(__name__)


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_ml_db() -> None:
    """Extend track_embeddings table with MuQ/MERT columns."""
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS track_embeddings (
                entry_id    TEXT PRIMARY KEY,
                feature_vec TEXT,
                clap_vec    TEXT,
                muq_vec     TEXT,
                mert_vec    TEXT,
                updated_at  TEXT
            )
        """)
        # Add columns if table existed from older schema
        for col in ("muq_vec", "mert_vec"):
            try:
                conn.execute(f"ALTER TABLE track_embeddings ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass  # already exists
        conn.commit()


def store_embeddings(
    entry_id: str,
    clap: Optional[List[float]] = None,
    muq: Optional[List[float]] = None,
    mert: Optional[List[float]] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT entry_id FROM track_embeddings WHERE entry_id = ?", (entry_id,)
        ).fetchone()

        if existing:
            updates = []
            params: list = []
            if clap is not None:
                updates.append("clap_vec = ?")
                params.append(json.dumps(clap))
            if muq is not None:
                updates.append("muq_vec = ?")
                params.append(json.dumps(muq))
            if mert is not None:
                updates.append("mert_vec = ?")
                params.append(json.dumps(mert))
            updates.append("updated_at = ?")
            params.append(now)
            params.append(entry_id)
            conn.execute(
                f"UPDATE track_embeddings SET {', '.join(updates)} WHERE entry_id = ?",
                params,
            )
        else:
            conn.execute(
                """INSERT INTO track_embeddings
                   (entry_id, clap_vec, muq_vec, mert_vec, updated_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    entry_id,
                    json.dumps(clap) if clap else None,
                    json.dumps(muq) if muq else None,
                    json.dumps(mert) if mert else None,
                    now,
                ),
            )
        conn.commit()


def get_stored_vec(entry_id: str, model: str) -> Optional[List[float]]:
    col = {"clap": "clap_vec", "muq": "muq_vec", "mert": "mert_vec"}.get(model)
    if not col:
        return None
    with _conn() as conn:
        row = conn.execute(
            f"SELECT {col} FROM track_embeddings WHERE entry_id = ?", (entry_id,)
        ).fetchone()
    if row and row[col]:
        return json.loads(row[col])
    return None


def get_all_vecs(model: str) -> Dict[str, List[float]]:
    col = {"clap": "clap_vec", "muq": "muq_vec", "mert": "mert_vec"}.get(model, "clap_vec")
    with _conn() as conn:
        rows = conn.execute(
            f"SELECT entry_id, {col} FROM track_embeddings WHERE {col} IS NOT NULL"
        ).fetchall()
    return {r["entry_id"]: json.loads(r[col]) for r in rows}


async def embed_entry(entry_id: str, models: Optional[List[str]] = None) -> Dict[str, Any]:
    """Embed a single catalog entry via RunPod and store vectors."""
    if not is_configured():
        return {"error": "RUNPOD_URL not configured", "entry_id": entry_id}

    entry = get_entry(entry_id)
    if not entry or not entry.file_path:
        return {"error": "entry not found or no file_path", "entry_id": entry_id}

    models = models or ["clap"]
    result = await embed_file(entry.file_path, models=models)
    store_embeddings(entry_id, clap=result.clap, muq=result.muq, mert=result.mert)

    return {
        "entry_id": entry_id,
        "dims": result.dims,
        "stored": {k: v is not None for k, v in {
            "clap": result.clap, "muq": result.muq, "mert": result.mert
        }.items()},
    }


async def embed_all_ready(models: Optional[List[str]] = None) -> Dict[str, Any]:
    """Queue embedding for all ready entries missing requested vectors."""
    if not is_configured():
        return {"error": "RUNPOD_URL not configured", "queued": 0}

    models = models or ["clap"]
    entries = list_entries(status="ready", limit=5000)
    queued = 0
    errors = []

    for entry in entries:
        missing = False
        for m in models:
            if get_stored_vec(entry.id, m) is None:
                missing = True
                break
        if not missing:
            continue
        try:
            await embed_entry(entry.id, models=models)
            queued += 1
        except Exception as e:
            errors.append({"entry_id": entry.id, "error": str(e)})
            logger.error("Embed failed for %s: %s", entry.id, e)

    return {"queued": queued, "errors": errors[:10]}


async def semantic_search_runpod(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    CLAP text → cosine similarity against stored clap_vec embeddings.
    Falls back to empty list if RunPod unavailable or no embeddings stored.
    """
    import math

    if not is_configured():
        return []

    try:
        text_vec = await embed_text(query)
    except Exception as e:
        logger.error("RunPod text embed failed: %s", e)
        return []

    stored = get_all_vecs("clap")
    if not stored:
        return []

    def cosine(a: List[float], b: List[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))
        return dot / (na * nb) if na > 0 and nb > 0 else 0.0

    scored = [(cosine(text_vec, v), eid) for eid, v in stored.items()]
    scored.sort(reverse=True)

    results = []
    for sim, eid in scored[:limit]:
        entry = get_entry(eid)
        if entry:
            results.append({
                "entry_id": eid,
                "title": entry.title or entry.file_name,
                "artist": entry.artist,
                "bpm": entry.bpm,
                "key": entry.key,
                "duration_seconds": entry.duration_seconds,
                "has_artwork": entry.has_artwork,
                "score": sim,
                "method": "clap",
            })
    return results
