"""
DJ Transition Graph — Layer 3 intelligence.

Two data sources:
  1. User transitions — recorded when sequencing tracks in Set Builder (local).
  2. Pro DJ transitions — from 1001tracklists via Parse.bot API (stable).

Matching uses normalised (artist, title) keys so the same song matches
across different file versions.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Dict, List, Optional, Tuple

from ..db.repository import DB_PATH
from .tl_provider import (
    is_pro_dj_configured,
    resolve_tl_track,
    search_tl_tracklist_urls,
    _parse_get_tracklist,
)


# ─── DB ───────────────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_transition_db() -> None:
    with _conn() as conn:
        # Transition pair graph
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dj_transitions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                from_key    TEXT NOT NULL,   -- normalised "artist|title"
                to_key      TEXT NOT NULL,   -- normalised "artist|title"
                count       INTEGER DEFAULT 1,
                source      TEXT DEFAULT 'user',  -- 'user' or '1001tl'
                updated_at  TEXT
            )
        """)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_dj_trans_pair
            ON dj_transitions (from_key, to_key, source)
        """)

        # Map from normalised key → entry_id (updated when library scanned)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transition_key_map (
                norm_key    TEXT PRIMARY KEY,
                entry_id    TEXT NOT NULL
            )
        """)

        # Fetch cache — tracks we've already scraped from 1001TL
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tl_fetch_cache (
                norm_key    TEXT PRIMARY KEY,
                fetched_at  TEXT,
                result_json TEXT
            )
        """)
        conn.commit()


# ─── Normalisation ────────────────────────────────────────────────────────────

def _normalise(artist: Optional[str], title: Optional[str]) -> str:
    """Produce a stable lowercase key for matching across sources."""
    def clean(s: str) -> str:
        s = s.lower()
        s = re.sub(r"\(.*?\)|\[.*?\]", "", s)          # strip parentheticals
        s = re.sub(r"(?:feat|ft|prod|vs|x)\b.*", "", s) # strip features
        s = re.sub(r"[^\w\s]", "", s)                   # remove punctuation
        return " ".join(s.split())

    a = clean(artist or "unknown")
    t = clean(title  or "unknown")
    return f"{a}|{t}"


def _key_to_artist_title(key: str) -> Tuple[str, str]:
    if "|" in key:
        artist, title = key.split("|", 1)
        return artist, title
    return "unknown", key


def _track_matches_target(target_key: str, tl_artist: str, tl_title: str) -> bool:
    if _normalise(tl_artist, tl_title) == target_key:
        return True
    target_a, target_t = _key_to_artist_title(target_key)
    tl_a, tl_t = _key_to_artist_title(_normalise(tl_artist, tl_title))
    if len(target_t) >= 4 and target_t == tl_t:
        if set(target_a.split()) & set(tl_a.split()):
            return True
    return False


def rebuild_key_map(entries: list) -> None:
    """Refresh the artist/title → entry_id map from current library."""
    with _conn() as conn:
        conn.execute("DELETE FROM transition_key_map")
        for e in entries:
            if e.artist or e.title:
                key = _normalise(e.artist, e.title or e.file_name)
                conn.execute("""
                    INSERT OR REPLACE INTO transition_key_map (norm_key, entry_id)
                    VALUES (?, ?)
                """, (key, e.id))
        conn.commit()


# ─── Record user transitions ──────────────────────────────────────────────────

def record_transition(from_entry_id: str, to_entry_id: str, from_artist: Optional[str],
                      from_title: Optional[str], to_artist: Optional[str],
                      to_title: Optional[str]) -> None:
    """
    Called when the user places track B immediately after track A in a set.
    Increments the from→to pair count.
    """
    from datetime import datetime, timezone
    fk = _normalise(from_artist, from_title)
    tk = _normalise(to_artist, to_title)
    now = datetime.now(timezone.utc).isoformat()

    with _conn() as conn:
        # Upsert transition pair
        conn.execute("""
            INSERT INTO dj_transitions (from_key, to_key, count, source, updated_at)
            VALUES (?, ?, 1, 'user', ?)
            ON CONFLICT(from_key, to_key, source) DO UPDATE SET
                count      = count + 1,
                updated_at = excluded.updated_at
        """, (fk, tk, now))

        # Keep key map up to date
        conn.execute("INSERT OR REPLACE INTO transition_key_map VALUES (?, ?)", (fk, from_entry_id))
        conn.execute("INSERT OR REPLACE INTO transition_key_map VALUES (?, ?)", (tk, to_entry_id))
        conn.commit()


# ─── Query transition graph ───────────────────────────────────────────────────

def get_next_by_transitions(
    entry_id: str,
    artist: Optional[str],
    title: Optional[str],
    exclude_ids: Optional[set] = None,
    limit: int = 5,
    include_unmatched: bool = False,
) -> List[Dict]:
    """
    Return the most-played-after tracks for a given entry_id.
    Combines user recordings and 1001TL data.
    """
    fk = _normalise(artist, title)
    exclude = exclude_ids or set()

    with _conn() as conn:
        rows = conn.execute("""
            SELECT dt.to_key,
                   SUM(CASE WHEN dt.source = '1001tl' THEN dt.count ELSE 0 END) AS pro_count,
                   SUM(CASE WHEN dt.source = 'user'   THEN dt.count ELSE 0 END) AS user_count,
                   SUM(dt.count) AS total
            FROM dj_transitions dt
            WHERE dt.from_key = ?
            GROUP BY dt.to_key
            ORDER BY pro_count DESC, total DESC
            LIMIT 50
        """, (fk,)).fetchall()

        candidates = []
        unmatched = []
        for row in rows:
            to_key = row["to_key"]
            pro_count = row["pro_count"] or 0
            user_count = row["user_count"] or 0
            if pro_count == 0 and user_count == 0:
                continue
            map_row = conn.execute(
                "SELECT entry_id FROM transition_key_map WHERE norm_key = ?", (to_key,)
            ).fetchone()
            if map_row and map_row["entry_id"] not in exclude:
                candidates.append({
                    "entry_id": map_row["entry_id"],
                    "transition_count": pro_count if pro_count > 0 else user_count,
                    "pro_count": pro_count,
                    "user_count": user_count,
                    "source": "1001tl" if pro_count > 0 else "user",
                    "in_library": True,
                })
            elif include_unmatched and pro_count > 0:
                a, t = _key_to_artist_title(to_key)
                unmatched.append({
                    "entry_id": None,
                    "title": t.title() if t else "unknown",
                    "artist": a.title() if a and a != "unknown" else None,
                    "transition_count": pro_count,
                    "pro_count": pro_count,
                    "user_count": 0,
                    "source": "1001tl",
                    "in_library": False,
                })

        has_pro = any(c["pro_count"] > 0 for c in candidates) or bool(unmatched)
        if has_pro:
            pro_hits = [c for c in candidates if c["pro_count"] > 0]
            pro_hits.sort(key=lambda c: c["pro_count"], reverse=True)
            if pro_hits:
                return pro_hits[:limit]
            if include_unmatched:
                unmatched.sort(key=lambda c: c["pro_count"], reverse=True)
                return unmatched[:limit]
            return []

        user_hits = [c for c in candidates if c["user_count"] > 0]
        user_hits.sort(key=lambda c: c["user_count"], reverse=True)
        return user_hits[:limit] if user_hits else candidates[:limit]


def transition_stats(artist: Optional[str], title: Optional[str]) -> Dict:
    """How many unique 'next tracks' are recorded for this track."""
    fk = _normalise(artist, title)
    with _conn() as conn:
        row = conn.execute("""
            SELECT COUNT(DISTINCT to_key) as unique_nexts,
                   SUM(count) as total_transitions,
                   COUNT(DISTINCT source) as sources
            FROM dj_transitions WHERE from_key = ?
        """, (fk,)).fetchone()
    return {
        "unique_next_tracks": row["unique_nexts"] or 0,
        "total_transitions":  row["total_transitions"] or 0,
        "sources": row["sources"] or 0,
        "has_data": (row["unique_nexts"] or 0) > 0,
    }


# ─── Pro DJ fetch (Parse.bot + 1001TL AJAX discovery) ───────────────────────

_fetch_progress: Dict[str, Dict] = {}


def get_fetch_progress(entry_id: str) -> Dict:
    return _fetch_progress.get(entry_id, {"phase": "idle"})


def _cache_fetch_result(norm_key: str, result: Dict) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO tl_fetch_cache (norm_key, fetched_at, result_json)
            VALUES (?, ?, ?)
        """, (norm_key, now, json.dumps(result)))
        conn.commit()


def fetch_transitions_for_track(
    artist: str,
    title: str,
    entry_id: str,
    max_sets: int = 6,
) -> Dict:
    """
    Find pro-DJ transitions for a track via Parse.bot (1001tracklists data).
    Requires PARSE_API_KEY in apps/api/.env.
    """
    from datetime import datetime, timezone

    norm_key = _normalise(artist, title)

    if not is_pro_dj_configured():
        result = {
            "error": "no_api_key",
            "transitions_added": 0,
            "library_matches": 0,
            "pro_transitions": 0,
        }
        _fetch_progress[entry_id] = {"phase": "done", **result}
        return result

    with _conn() as conn:
        cached = conn.execute(
            "SELECT fetched_at, result_json FROM tl_fetch_cache WHERE norm_key = ?",
            (norm_key,),
        ).fetchone()

    if cached and cached["fetched_at"]:
        from datetime import datetime as dt

        cached_dt = dt.fromisoformat(cached["fetched_at"].replace("Z", "+00:00"))
        age_days = (dt.now(timezone.utc) - cached_dt).days
        cached_result = json.loads(cached["result_json"] or "{}")
        if cached_result.get("transitions_added", 0) > 0 and age_days < 7:
            return cached_result
        if cached_result.get("error") == "no_api_key":
            return cached_result

    _fetch_progress[entry_id] = {"phase": "searching", "scanned": 0, "total": 0}

    try:
        tl_track = resolve_tl_track(artist, title)
        if not tl_track:
            result = {
                "error": "track_not_found",
                "transitions_added": 0,
                "library_matches": 0,
                "pro_transitions": 0,
            }
            _fetch_progress[entry_id].update(result)
            _cache_fetch_result(norm_key, result)
            return result

        candidates = search_tl_tracklist_urls(artist, title, tl_track, limit=max_sets * 2)[:max_sets]
        if not candidates:
            result = {
                "error": "no_sets",
                "transitions_added": 0,
                "library_matches": 0,
                "pro_transitions": 0,
                "tl_track": tl_track.get("fulltrackname"),
            }
            _fetch_progress[entry_id].update(result)
            _cache_fetch_result(norm_key, result)
            return result

        transitions_added = 0
        library_matches = 0
        pro_transitions = 0
        api_failures = 0

        _fetch_progress[entry_id] = {
            "phase": "scanning",
            "scanned": 0,
            "total": len(candidates),
        }

        for idx, tl_url in enumerate(candidates):
            _fetch_progress[entry_id] = {
                "phase": "scanning",
                "scanned": idx,
                "total": len(candidates),
            }

            tracks = _parse_get_tracklist(tl_url)
            if not tracks:
                api_failures += 1
                continue

            for i, (a, t) in enumerate(tracks):
                if not _track_matches_target(norm_key, a, t):
                    continue

                if i + 1 < len(tracks):
                    na, nt = tracks[i + 1]
                    next_norm = _normalise(na, nt)
                    with _conn() as conn:
                        next_row = conn.execute(
                            "SELECT entry_id FROM transition_key_map WHERE norm_key = ?",
                            (next_norm,),
                        ).fetchone()
                        next_entry_id = next_row["entry_id"] if next_row else None

                    record_transition_raw(
                        norm_key, next_norm, entry_id, next_entry_id, source="1001tl",
                    )
                    transitions_added += 1
                    pro_transitions += 1
                    if next_entry_id:
                        library_matches += 1

                if i > 0:
                    pa, pt = tracks[i - 1]
                    prev_norm = _normalise(pa, pt)
                    with _conn() as conn:
                        prev_row = conn.execute(
                            "SELECT entry_id FROM transition_key_map WHERE norm_key = ?",
                            (prev_norm,),
                        ).fetchone()
                        prev_entry_id = prev_row["entry_id"] if prev_row else None
                    record_transition_raw(
                        prev_norm, norm_key, prev_entry_id, entry_id, source="1001tl",
                    )

            if library_matches >= 3:
                break

        if api_failures == len(candidates) and transitions_added == 0:
            result = {
                "error": "api_error",
                "transitions_added": 0,
                "library_matches": 0,
                "pro_transitions": 0,
                "sets_scanned": len(candidates),
            }
            _fetch_progress[entry_id].update(result)
            _cache_fetch_result(norm_key, result)
            return result

        result = {
            "transitions_added": transitions_added,
            "library_matches": library_matches,
            "pro_transitions": pro_transitions,
            "sets_scanned": len(candidates),
            "tl_track": tl_track.get("fulltrackname"),
        }
        if transitions_added == 0:
            result["error"] = "no_matches"
        _fetch_progress[entry_id].update(result)
        _cache_fetch_result(norm_key, result)
        return result
    finally:
        if entry_id in _fetch_progress:
            _fetch_progress[entry_id]["phase"] = "done"


def record_transition_raw(
    from_key: str,
    to_key: str,
    from_entry_id: Optional[str],
    to_entry_id: Optional[str],
    source: str = "1001tl",
) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute("""
            INSERT INTO dj_transitions (from_key, to_key, count, source, updated_at)
            VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(from_key, to_key, source) DO UPDATE SET
                count      = count + 1,
                updated_at = excluded.updated_at
        """, (from_key, to_key, source, now))
        if from_entry_id:
            conn.execute("INSERT OR REPLACE INTO transition_key_map VALUES (?, ?)", (from_key, from_entry_id))
        if to_entry_id:
            conn.execute("INSERT OR REPLACE INTO transition_key_map VALUES (?, ?)", (to_key, to_entry_id))
        conn.commit()
