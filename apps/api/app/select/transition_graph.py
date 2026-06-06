"""
DJ Transition Graph — Layer 3 intelligence.

Two data sources, unified schema:
  1. User transitions — recorded when the user reorders or adds tracks in Set Builder.
     Builds a proprietary graph over time.

  2. 1001tracklists.com — scrapes public DJ set tracklists to learn which
     tracks professional DJs play after a given track.
     Rate-limited, respectful, and cached permanently.

Matching: transitions are stored by (artist, title) normalised form so they
can match across different versions/IDs of the same track.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote_plus

from ..db.repository import DB_PATH


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
) -> List[Dict]:
    """
    Return the most-played-after tracks for a given entry_id.
    Combines user recordings and 1001TL data.
    """
    fk = _normalise(artist, title)
    exclude = exclude_ids or set()

    with _conn() as conn:
        rows = conn.execute("""
            SELECT dt.to_key, SUM(dt.count) as total, dt.source
            FROM dj_transitions dt
            WHERE dt.from_key = ?
            GROUP BY dt.to_key
            ORDER BY total DESC
            LIMIT 50
        """, (fk,)).fetchall()

        result = []
        for row in rows:
            to_key = row["to_key"]
            # Resolve to entry_id via key map
            map_row = conn.execute(
                "SELECT entry_id FROM transition_key_map WHERE norm_key = ?", (to_key,)
            ).fetchone()
            if map_row and map_row["entry_id"] not in exclude:
                result.append({
                    "entry_id": map_row["entry_id"],
                    "transition_count": row["total"],
                    "source": row["source"],
                })
                if len(result) >= limit:
                    break

    return result


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


# ─── 1001tracklists.com fetcher ───────────────────────────────────────────────

_TL_BASE  = "https://www.1001tracklists.com"
_RATE_SEC = 3.0        # be a respectful citizen — 3 s between requests
_last_req = 0.0


def _tl_get(url: str) -> Optional[str]:
    """Rate-limited HTTP GET."""
    global _last_req
    import urllib.request

    gap = time.time() - _last_req
    if gap < _RATE_SEC:
        time.sleep(_RATE_SEC - gap)

    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; OdeonDJ/1.0; +https://odeon.app)",
                "Accept": "text/html",
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            _last_req = time.time()
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        _last_req = time.time()
        return None


def _parse_tl_tracklist_page(html: str) -> List[Tuple[str, str]]:
    """
    Parse a 1001tracklists tracklist page into [(artist, title)] in order.
    The site renders server-side so basic regex works.
    """
    # Tracks appear in <div class="tlpTog"> ... <span class="trackValue">ARTIST - TITLE</span>
    # Multiple patterns for robustness
    tracks: List[Tuple[str, str]] = []

    patterns = [
        r'<span[^>]+class="[^"]*trackValue[^"]*"[^>]*>([^<]+)</span>',
        r'<meta[^>]+itemprop="name"[^>]+content="([^"]+)"',
    ]

    for pat in patterns:
        for m in re.finditer(pat, html):
            raw = m.group(1).strip()
            if " - " in raw:
                artist, _, title = raw.partition(" - ")
                tracks.append((artist.strip(), title.strip()))
        if tracks:
            break

    return tracks


def fetch_transitions_for_track(
    artist: str,
    title: str,
    entry_id: str,
    max_sets: int = 10,
) -> Dict:
    """
    Search 1001tracklists for sets containing this track, parse transitions.
    Results are cached in tl_fetch_cache to avoid repeated fetches.
    Returns summary dict.
    """
    from datetime import datetime, timezone

    norm_key = _normalise(artist, title)
    now = datetime.now(timezone.utc).isoformat()

    # Check cache first (1 week TTL)
    with _conn() as conn:
        cached = conn.execute(
            "SELECT fetched_at, result_json FROM tl_fetch_cache WHERE norm_key = ?",
            (norm_key,)
        ).fetchone()

    if cached and cached["fetched_at"]:
        from datetime import datetime as dt
        cached_dt = dt.fromisoformat(cached["fetched_at"].replace("Z", "+00:00"))
        age_days = (dt.now(timezone.utc) - cached_dt).days
        if age_days < 7:
            return json.loads(cached["result_json"] or "{}")

    # Search 1001TL for tracklists containing this track
    search_q = quote_plus(f"{artist} {title}")
    search_url = f"{_TL_BASE}/search/tracklist/{search_q}.html"
    html = _tl_get(search_url)

    if not html:
        return {"error": "fetch_failed", "transitions_added": 0}

    # Find tracklist links
    tl_links = re.findall(
        r'href="(/tracklist/[^"]+\.html)"',
        html
    )
    tl_links = list(dict.fromkeys(tl_links))[:max_sets]  # dedupe, cap

    transitions_added = 0

    for link in tl_links:
        tl_html = _tl_get(f"{_TL_BASE}{link}")
        if not tl_html:
            continue

        tracks = _parse_tl_tracklist_page(tl_html)

        # Find our track in the tracklist
        for i, (a, t) in enumerate(tracks):
            if _normalise(a, t) == norm_key:
                # Record transition to next track
                if i + 1 < len(tracks):
                    na, nt = tracks[i + 1]
                    # Check if the next track is in our library
                    next_norm = _normalise(na, nt)
                    with _conn() as conn:
                        next_row = conn.execute(
                            "SELECT entry_id FROM transition_key_map WHERE norm_key = ?",
                            (next_norm,)
                        ).fetchone()
                        next_entry_id = next_row["entry_id"] if next_row else None

                    record_transition_raw(norm_key, next_norm, entry_id, next_entry_id, source="1001tl")
                    transitions_added += 1

                # Also record from prev to our track
                if i > 0:
                    pa, pt = tracks[i - 1]
                    prev_norm = _normalise(pa, pt)
                    with _conn() as conn:
                        prev_row = conn.execute(
                            "SELECT entry_id FROM transition_key_map WHERE norm_key = ?",
                            (prev_norm,)
                        ).fetchone()
                        prev_entry_id = prev_row["entry_id"] if prev_row else None
                    record_transition_raw(prev_norm, norm_key, prev_entry_id, entry_id, source="1001tl")

    # Cache result
    result = {"transitions_added": transitions_added, "sets_scanned": len(tl_links)}
    with _conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO tl_fetch_cache (norm_key, fetched_at, result_json)
            VALUES (?, ?, ?)
        """, (norm_key, now, json.dumps(result)))
        conn.commit()

    return result


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
