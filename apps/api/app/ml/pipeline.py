"""
ML pipeline orchestration — embed, separate, analyze, reason, generate.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from .runpod_client import (
    embed_file, embed_text, is_configured, get_status,
    analyze_file, plan_transition as runpod_plan,
    generate_bridge as runpod_bridge, generate_riser as runpod_riser,
    download_runpod_file, RUNPOD_URL,
)
from ..select.repository import get_entry, list_entries
from ..db.repository import DB_PATH
from ..separation.separator import get_separator
import sqlite3

logger = logging.getLogger(__name__)

STEMS_ROOT = DB_PATH.parent / "stems"
GENERATED_ROOT = DB_PATH.parent / "generated"
STEM_JOB_STATUSES = {"queued", "running", "completed", "failed"}


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_ml_db() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS track_embeddings (
                entry_id    TEXT PRIMARY KEY,
                feature_vec TEXT,
                clap_vec    TEXT,
                muq_vec     TEXT,
                mert_vec    TEXT,
                mert_features TEXT,
                updated_at  TEXT
            )
        """)
        for col in ("muq_vec", "mert_vec", "mert_features"):
            try:
                conn.execute(f"ALTER TABLE track_embeddings ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS track_stems (
                entry_id     TEXT PRIMARY KEY,
                job_id       TEXT,
                vocals_path  TEXT,
                drums_path   TEXT,
                bass_path    TEXT,
                other_path   TEXT,
                separated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS track_analysis (
                entry_id    TEXT PRIMARY KEY,
                analysis    TEXT,
                source      TEXT,
                analyzed_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stem_jobs (
                entry_id    TEXT PRIMARY KEY,
                status      TEXT NOT NULL,
                priority    INTEGER NOT NULL DEFAULT 50,
                attempts    INTEGER NOT NULL DEFAULT 0,
                last_error  TEXT,
                created_at  TEXT,
                updated_at  TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS generated_audio (
                id          TEXT PRIMARY KEY,
                entry_id    TEXT,
                kind        TEXT,
                file_path   TEXT,
                meta        TEXT,
                created_at  TEXT
            )
        """)
        conn.commit()

    _reset_stuck_stem_jobs()


def _reset_stuck_stem_jobs() -> None:
    """Jobs left 'running' after a crash/reload get re-queued."""
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            """
            UPDATE stem_jobs
            SET status = 'queued', last_error = NULL, updated_at = ?
            WHERE status = 'running'
            """,
            (now,),
        )
        conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_stem_job_status(status: str) -> str:
    if status not in STEM_JOB_STATUSES:
        raise ValueError(f"Invalid stem job status: {status}")
    return status


def enqueue_stem_job(entry_id: str, priority: int = 50, force: bool = False) -> Dict[str, Any]:
    now = _now_iso()
    priority = max(0, min(100, int(priority)))
    with _conn() as conn:
        existing = conn.execute(
            "SELECT entry_id, status, priority, attempts, last_error, created_at, updated_at FROM stem_jobs WHERE entry_id = ?",
            (entry_id,),
        ).fetchone()
        if existing and existing["status"] == "completed" and not force:
            return dict(existing)

        if existing:
            conn.execute(
                """
                UPDATE stem_jobs
                SET status = ?, priority = ?, last_error = ?, updated_at = ?
                WHERE entry_id = ?
                """,
                ("queued", priority, None, now, entry_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO stem_jobs (entry_id, status, priority, attempts, last_error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (entry_id, "queued", priority, 0, None, now, now),
            )
        conn.commit()
    return get_stem_job(entry_id) or {
        "entry_id": entry_id,
        "status": "queued",
        "priority": priority,
        "attempts": 0,
        "last_error": None,
        "created_at": now,
        "updated_at": now,
    }


def update_stem_job(
    entry_id: str,
    *,
    status: str,
    last_error: Optional[str] = None,
    increment_attempts: bool = False,
) -> Optional[Dict[str, Any]]:
    status = _normalize_stem_job_status(status)
    now = _now_iso()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT attempts FROM stem_jobs WHERE entry_id = ?",
            (entry_id,),
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO stem_jobs (entry_id, status, priority, attempts, last_error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (entry_id, status, 50, 1 if increment_attempts else 0, last_error, now, now),
            )
        else:
            attempts = int(existing["attempts"] or 0) + (1 if increment_attempts else 0)
            conn.execute(
                """
                UPDATE stem_jobs
                SET status = ?, attempts = ?, last_error = ?, updated_at = ?
                WHERE entry_id = ?
                """,
                (status, attempts, last_error, now, entry_id),
            )
        conn.commit()
    return get_stem_job(entry_id)


def get_stem_job(entry_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT entry_id, status, priority, attempts, last_error, created_at, updated_at
            FROM stem_jobs
            WHERE entry_id = ?
            """,
            (entry_id,),
        ).fetchone()
    return dict(row) if row else None


def list_stem_jobs(status: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit), 2000))
    with _conn() as conn:
        if status:
            _normalize_stem_job_status(status)
            rows = conn.execute(
                """
                SELECT entry_id, status, priority, attempts, last_error, created_at, updated_at
                FROM stem_jobs
                WHERE status = ?
                ORDER BY priority DESC, updated_at ASC
                LIMIT ?
                """,
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT entry_id, status, priority, attempts, last_error, created_at, updated_at
                FROM stem_jobs
                ORDER BY priority DESC, updated_at ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


def store_embeddings(
    entry_id: str,
    clap: Optional[List[float]] = None,
    muq: Optional[List[float]] = None,
    mert: Optional[List[float]] = None,
    mert_features: Optional[Dict[str, Any]] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT entry_id FROM track_embeddings WHERE entry_id = ?", (entry_id,)
        ).fetchone()
        if existing:
            updates, params = [], []
            for col, val in [
                ("clap_vec", clap), ("muq_vec", muq), ("mert_vec", mert),
                ("mert_features", mert_features),
            ]:
                if val is not None:
                    updates.append(f"{col} = ?")
                    params.append(json.dumps(val) if col != "mert_features" or isinstance(val, (list, dict)) else val)
                    if col == "mert_features":
                        params[-1] = json.dumps(val)
            updates.append("updated_at = ?")
            params.extend([now, entry_id])
            conn.execute(f"UPDATE track_embeddings SET {', '.join(updates)} WHERE entry_id = ?", params)
        else:
            conn.execute(
                """INSERT INTO track_embeddings
                   (entry_id, clap_vec, muq_vec, mert_vec, mert_features, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (entry_id, json.dumps(clap) if clap else None,
                 json.dumps(muq) if muq else None, json.dumps(mert) if mert else None,
                 json.dumps(mert_features) if mert_features else None, now),
            )
        conn.commit()


def get_stored_vec(entry_id: str, model: str) -> Optional[List[float]]:
    col = {"clap": "clap_vec", "muq": "muq_vec", "mert": "mert_vec"}.get(model)
    if not col:
        return None
    with _conn() as conn:
        row = conn.execute(f"SELECT {col} FROM track_embeddings WHERE entry_id = ?", (entry_id,)).fetchone()
    return json.loads(row[col]) if row and row[col] else None


def get_mert_features(entry_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT mert_features FROM track_embeddings WHERE entry_id = ?", (entry_id,)
        ).fetchone()
    return json.loads(row["mert_features"]) if row and row["mert_features"] else None


def get_all_vecs(model: str) -> Dict[str, List[float]]:
    col = {"clap": "clap_vec", "muq": "muq_vec", "mert": "mert_vec"}.get(model, "clap_vec")
    with _conn() as conn:
        rows = conn.execute(
            f"SELECT entry_id, {col} FROM track_embeddings WHERE {col} IS NOT NULL"
        ).fetchall()
    return {r["entry_id"]: json.loads(r[col]) for r in rows}


def cosine_sim(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


def similar_by_model(
    entry_id: str,
    model: str = "muq",
    limit: int = 10,
    exclude_ids: Optional[set] = None,
) -> List[tuple[float, str]]:
    anchor = get_stored_vec(entry_id, model)
    if not anchor:
        return []
    exclude = exclude_ids or set()
    exclude.add(entry_id)
    stored = get_all_vecs(model)
    scored = [(cosine_sim(anchor, v), eid) for eid, v in stored.items() if eid not in exclude]
    scored.sort(reverse=True)
    return scored[:limit]


def muq_similarity_map(anchor_id: str, candidate_ids: List[str]) -> Dict[str, float]:
    anchor = get_stored_vec(anchor_id, "muq")
    if not anchor:
        return {}
    result = {}
    for cid in candidate_ids:
        vec = get_stored_vec(cid, "muq")
        if vec:
            result[cid] = cosine_sim(anchor, vec)
    return result


async def embed_entry(entry_id: str, models: Optional[List[str]] = None) -> Dict[str, Any]:
    if not is_configured():
        return {"error": "RUNPOD_URL not configured", "entry_id": entry_id}
    entry = get_entry(entry_id)
    if not entry or not entry.file_path:
        return {"error": "entry not found or no file_path", "entry_id": entry_id}
    models = models or ["clap", "muq"]
    result = await embed_file(entry.file_path, models=models)
    store_embeddings(entry_id, clap=result.clap, muq=result.muq, mert=result.mert)
    return {
        "entry_id": entry_id,
        "dims": result.dims,
        "stored": {k: v is not None for k, v in {
            "clap": result.clap, "muq": result.muq, "mert": result.mert,
        }.items()},
    }


async def embed_all_ready(models: Optional[List[str]] = None) -> Dict[str, Any]:
    if not is_configured():
        return {"error": "RUNPOD_URL not configured", "queued": 0}
    models = models or ["clap", "muq"]
    entries = list_entries(status="ready", limit=5000)
    queued, errors = 0, []
    for entry in entries:
        if all(get_stored_vec(entry.id, m) is not None for m in models):
            continue
        try:
            await embed_entry(entry.id, models=models)
            queued += 1
        except Exception as e:
            errors.append({"entry_id": entry.id, "error": str(e)})
    return {"queued": queued, "errors": errors[:10]}


async def semantic_search_runpod(query: str, limit: int = 20) -> List[Dict[str, Any]]:
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
    scored = sorted(
        [(cosine_sim(text_vec, v), eid) for eid, v in stored.items()],
        reverse=True,
    )
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


def store_analysis(entry_id: str, analysis: Dict[str, Any], source: str = "unknown") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            """INSERT INTO track_analysis (entry_id, analysis, source, analyzed_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(entry_id) DO UPDATE SET analysis=?, source=?, analyzed_at=?""",
            (entry_id, json.dumps(analysis), source, now, json.dumps(analysis), source, now),
        )
        conn.commit()


def get_analysis(entry_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute("SELECT analysis, source FROM track_analysis WHERE entry_id = ?", (entry_id,)).fetchone()
    if row:
        return {"analysis": json.loads(row["analysis"]), "source": row["source"]}
    return None


def _local_analyze_fallback(file_path: str, entry_bpm: Optional[float] = None) -> Dict[str, Any]:
    """Librosa heuristic when RunPod analysis unavailable."""
    import librosa

    y, sr = librosa.load(file_path, sr=22050, mono=True, duration=120)
    duration = len(y) / sr
    bpm = entry_bpm or float(librosa.beat.tempo(y=y, sr=sr)[0])
    labels = ["intro", "build", "drop", "breakdown", "drop", "bridge", "outro"]
    sections = []
    for i, label in enumerate(labels):
        start_s = (i / len(labels)) * duration
        end_s = ((i + 1) / len(labels)) * duration
        sections.append({"label": label, "start_seconds": round(start_s, 2),
                         "end_seconds": round(end_s, 2), "bars": 8})
    return {
        "source": "local_librosa",
        "bpm": round(bpm, 1),
        "sections": sections,
        "mix_in_safe": True,
        "mix_out_safe": True,
        "energy_arc": "builds",
        "rhythm_pattern": "four_on_floor" if 118 <= bpm <= 135 else "varied",
        "mood": "energetic",
        "transition_notes": f"Mix out around {round(duration * 0.75)}s",
    }


async def analyze_entry_ml(entry_id: str) -> Dict[str, Any]:
    entry = get_entry(entry_id)
    if not entry or not entry.file_path:
        return {"error": "entry not found"}

    analysis: Optional[Dict[str, Any]] = None
    source = "unknown"

    if is_configured():
        try:
            data = await analyze_file(entry.file_path)
            candidate = data.get("analysis", data)
            if candidate.get("status") != "not_implemented" and "sections" in candidate:
                analysis = candidate
                source = candidate.get("source", "runpod")
            elif data.get("status") == "ok" and data.get("analysis"):
                analysis = data["analysis"]
                source = analysis.get("source", "runpod")
        except Exception as e:
            logger.warning("RunPod analyze failed, using local fallback: %s", e)

    if not analysis:
        analysis = _local_analyze_fallback(entry.file_path, entry.bpm)
        source = "local_librosa"

    store_analysis(entry_id, analysis, source)
    if entry.beat_times is None and analysis.get("beat_times"):
        entry.beat_times = analysis["beat_times"]
        from ..select.repository import upsert_entry
        upsert_entry(entry)

    return {"entry_id": entry_id, "analysis": analysis, "source": source}


def store_stems(entry_id: str, job_id: str, paths: Dict[str, str]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            """INSERT INTO track_stems (entry_id, job_id, vocals_path, drums_path, bass_path, other_path, separated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(entry_id) DO UPDATE SET
                 job_id=?, vocals_path=?, drums_path=?, bass_path=?, other_path=?, separated_at=?""",
            (entry_id, job_id, paths.get("vocals"), paths.get("drums"),
             paths.get("bass"), paths.get("other"), now,
             job_id, paths.get("vocals"), paths.get("drums"),
             paths.get("bass"), paths.get("other"), now),
        )
        conn.commit()


def get_stems(entry_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM track_stems WHERE entry_id = ?", (entry_id,)).fetchone()
    return dict(row) if row else None


def _stem_flags_from_row(r: Dict[str, Any]) -> Dict[str, bool]:
    return {
        "vocals": bool(r.get("vocals_path")),
        "drums": bool(r.get("drums_path")),
        "bass": bool(r.get("bass_path")),
        "other": bool(r.get("other_path")),
    }


def get_stems_summary() -> Dict[str, Dict[str, Any]]:
    """Map entry_id → { has_stems, job_status, stems } for catalog indicators."""
    summary: Dict[str, Dict[str, Any]] = {}
    with _conn() as conn:
        stem_rows = conn.execute(
            "SELECT entry_id, vocals_path, drums_path, bass_path, other_path FROM track_stems"
        ).fetchall()
        job_rows = conn.execute(
            "SELECT entry_id, status, last_error FROM stem_jobs"
        ).fetchall()

    for row in stem_rows:
        r = dict(row)
        stems = _stem_flags_from_row(r)
        has_stems = any(stems.values())
        summary[r["entry_id"]] = {
            "has_stems": has_stems,
            "job_status": "completed" if has_stems else None,
            "stems": stems,
            "last_error": None,
        }

    for row in job_rows:
        r = dict(row)
        eid = r["entry_id"]
        existing = summary.get(eid, {
            "has_stems": False,
            "job_status": None,
            "stems": {"vocals": False, "drums": False, "bass": False, "other": False},
            "last_error": None,
        })
        if existing.get("has_stems"):
            existing["job_status"] = "completed"
        else:
            existing["job_status"] = r["status"]
        if r.get("last_error"):
            existing["last_error"] = r["last_error"]
        summary[eid] = existing

    return summary


def _separate_with_demucs_sync(entry_id: str, file_path: str) -> Dict[str, Any]:
    """Run local Demucs and store stems under audio/stems/<entry_id>/."""
    try:
        separator = get_separator()
    except RuntimeError as exc:
        return {"error": str(exc)}

    if not separator.is_available():
        return {
            "error": "Demucs is not available. Install with: pip install demucs",
        }

    local_dir = STEMS_ROOT / entry_id
    local_dir.mkdir(parents=True, exist_ok=True)
    work_dir = local_dir / "demucs_work"
    work_dir.mkdir(parents=True, exist_ok=True)

    result = separator.separate(file_path, str(work_dir))
    if not result.success:
        return {"error": result.error or "Separation failed"}

    job_id = uuid.uuid4().hex[:12]
    local_paths: Dict[str, str] = {}
    for stem in result.stems:
        dest = local_dir / f"{stem.stem_type}.wav"
        shutil.copy2(stem.file_path, dest)
        local_paths[stem.stem_type] = str(dest)

    store_stems(entry_id, job_id, local_paths)
    return {
        "entry_id": entry_id,
        "job_id": job_id,
        "stems": local_paths,
        "source": result.separator_used,
    }


async def separate_entry(entry_id: str) -> Dict[str, Any]:
    enqueue_stem_job(entry_id)
    update_stem_job(entry_id, status="running", increment_attempts=True, last_error=None)
    try:
        entry = get_entry(entry_id)
        if not entry or not entry.file_path:
            err = "entry not found"
            update_stem_job(entry_id, status="failed", last_error=err)
            return {"error": err}

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            _separate_with_demucs_sync,
            entry_id,
            entry.file_path,
        )
        if "error" in result:
            update_stem_job(entry_id, status="failed", last_error=result["error"])
            return result

        update_stem_job(entry_id, status="completed", last_error=None)
        return result
    except Exception as exc:
        update_stem_job(entry_id, status="failed", last_error=str(exc))
        return {"error": str(exc)}


def _bar_at_seconds(seconds: float, bpm: float, beats_per_bar: int = 4) -> int:
    if not bpm or bpm <= 0:
        return 0
    return int(seconds * bpm / 60 / beats_per_bar)


def _rule_based_transition(
    analysis_a: Dict[str, Any],
    analysis_b: Dict[str, Any],
    context: Dict[str, Any],
) -> Dict[str, Any]:
    bpm_a = context.get("bpm_a") or analysis_a.get("bpm") or 128
    bpm_b = context.get("bpm_b") or analysis_b.get("bpm") or 128
    duration_a = context.get("duration_a") or 300

    mix_out_s = duration_a * 0.75
    for sec in reversed(analysis_a.get("sections") or []):
        if sec.get("label") in ("outro", "breakdown", "bridge"):
            mix_out_s = sec.get("start_seconds", mix_out_s)
            break

    mix_in_s = 0.0
    for sec in analysis_b.get("sections") or []:
        if sec.get("label") in ("intro", "build"):
            mix_in_s = sec.get("start_seconds", 0)
            break

    mix_out_bar = _bar_at_seconds(mix_out_s, bpm_a)
    transition_bars = 16 if abs(bpm_a - bpm_b) <= 4 else 32

    return {
        "status": "ok",
        "source": "local_rule_based",
        "mix_out_bar": mix_out_bar,
        "mix_in_bar": _bar_at_seconds(mix_in_s, bpm_b),
        "transition_length_bars": transition_bars,
        "strategy": "high_pass_then_bass_swap",
        "steps": [
            {"bar": mix_out_bar, "action": "apply_high_pass_on_A", "freq_hz": 400},
            {"bar": mix_out_bar + 4, "action": "fade_in_B", "duration_bars": 8},
            {"bar": mix_out_bar + 8, "action": "bass_swap_A_to_B"},
            {"bar": mix_out_bar + transition_bars - 4, "action": "remove_A_fully"},
        ],
        "reason": f"Mix out of A at bar {mix_out_bar}, bring in B. {analysis_a.get('transition_notes', '')}",
        "bpm_a": bpm_a,
        "bpm_b": bpm_b,
    }


async def plan_transition_for_set(
    from_entry_id: str,
    to_entry_id: str,
) -> Dict[str, Any]:
    a = get_entry(from_entry_id)
    b = get_entry(to_entry_id)
    if not a or not b:
        return {"error": "entry not found"}
    analysis_a = get_analysis(from_entry_id)
    analysis_b = get_analysis(to_entry_id)
    if not analysis_a:
        await analyze_entry_ml(from_entry_id)
        analysis_a = get_analysis(from_entry_id)
    if not analysis_b:
        await analyze_entry_ml(to_entry_id)
        analysis_b = get_analysis(to_entry_id)
    context = {
        "analysis_a": (analysis_a or {}).get("analysis"),
        "analysis_b": (analysis_b or {}).get("analysis"),
        "bpm_a": a.bpm,
        "bpm_b": b.bpm,
        "key_a": a.key,
        "key_b": b.key,
        "duration_a": a.duration_seconds,
        "duration_b": b.duration_seconds,
        "title_a": a.title or a.file_name,
        "title_b": b.title or b.file_name,
    }
    aa = context["analysis_a"] or {}
    ab = context["analysis_b"] or {}

    if is_configured():
        try:
            result = await runpod_plan(a.file_path or "", b.file_path or "", context)
            if result.get("status") == "ok" or result.get("steps"):
                return result
        except Exception as e:
            logger.warning("RunPod transition plan failed, using local: %s", e)

    return _rule_based_transition(aa, ab, context)


async def generate_bridge_for_set(
    from_entry_id: str,
    to_entry_id: str,
    bars: int = 8,
) -> Dict[str, Any]:
    a = get_entry(from_entry_id)
    b = get_entry(to_entry_id)
    if not a or not b:
        return {"error": "entry not found"}
    bpm = int((a.bpm or 128) + (b.bpm or 128)) // 2
    key = b.key or a.key or "A min"
    prompt = f"transition bridge from {a.title} to {b.title} at {bpm} BPM"
    result = await runpod_bridge(prompt, bpm, key, bars)
    if result.get("status") != "ok":
        return result
    rel = result.get("file")
    if rel:
        dest = GENERATED_ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        await download_runpod_file(f"/files/generated/{rel}", dest)
        gen_id = result.get("job_id", rel)
        now = datetime.now(timezone.utc).isoformat()
        with _conn() as conn:
            conn.execute(
                """INSERT INTO generated_audio (id, entry_id, kind, file_path, meta, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (gen_id, from_entry_id, "bridge", str(dest), json.dumps(result), now),
            )
            conn.commit()
        result["local_path"] = str(dest)
    return result


async def generate_riser_for_entry(
    entry_id: str,
    bars: int = 4,
    intensity: float = 0.8,
) -> Dict[str, Any]:
    entry = get_entry(entry_id)
    if not entry:
        return {"error": "entry not found"}
    bpm = int(entry.bpm or 128)
    key = entry.key or "A min"
    result = await runpod_riser(bpm, key, bars, intensity)
    if result.get("status") != "ok":
        return result
    rel = result.get("file")
    if rel:
        dest = GENERATED_ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        await download_runpod_file(f"/files/generated/{rel}", dest)
        gen_id = result.get("job_id", rel)
        now = datetime.now(timezone.utc).isoformat()
        with _conn() as conn:
            conn.execute(
                """INSERT INTO generated_audio (id, entry_id, kind, file_path, meta, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (gen_id, entry_id, "riser", str(dest), json.dumps(result), now),
            )
            conn.commit()
        result["local_path"] = str(dest)
    return result
