"""
Select marker repository — cue points, hot cues, memory points, loops.
All stored as JSON rows in the select_markers SQLite table.
"""
from __future__ import annotations

import json
import sqlite3
from typing import List, Optional

from ..db.repository import DB_PATH
from .models import CatalogMarker


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_markers_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS select_markers (
                id       TEXT PRIMARY KEY,
                entry_id TEXT NOT NULL,
                data     TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_markers_entry ON select_markers(entry_id)"
        )
        conn.commit()


def upsert_marker(marker: CatalogMarker) -> CatalogMarker:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO select_markers(id, entry_id, data) VALUES(?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (marker.id, marker.entry_id, marker.model_dump_json()),
        )
        conn.commit()
    return marker


def get_markers(entry_id: str) -> List[CatalogMarker]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT data FROM select_markers WHERE entry_id = ? ORDER BY rowid",
            (entry_id,),
        ).fetchall()
    return [CatalogMarker(**json.loads(r["data"])) for r in rows]


def get_marker(marker_id: str) -> Optional[CatalogMarker]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM select_markers WHERE id = ?", (marker_id,)
        ).fetchone()
    return CatalogMarker(**json.loads(row["data"])) if row else None


def delete_marker(marker_id: str) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM select_markers WHERE id = ?", (marker_id,))
        conn.commit()
    return cur.rowcount > 0
