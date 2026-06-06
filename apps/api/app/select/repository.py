"""
Select catalog SQLite repository.
Tables are created in the same odeon.db file used by the project store.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from ..db.repository import DB_PATH
from .models import CatalogCollection, CatalogEntry, CatalogEntryStatus


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_select_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS select_entries (
                id           TEXT PRIMARY KEY,
                file_path    TEXT NOT NULL UNIQUE,
                data         TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS select_collections (
                id   TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
            """
        )
        conn.commit()

    # Any entry left in "analyzing" at startup means the process was killed
    # mid-analysis. Reset them to "pending" so they re-enter the queue.
    _reset_stuck_analyzing()


def _reset_stuck_analyzing() -> None:
    rows = []
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, data FROM select_entries"
        ).fetchall()

    updated = []
    for row in rows:
        data = json.loads(row["data"])
        if data.get("status") == "analyzing":
            data["status"] = "pending"
            data["error_message"] = None
            updated.append((json.dumps(data), row["id"]))

    if updated:
        with _conn() as conn:
            conn.executemany(
                "UPDATE select_entries SET data = ? WHERE id = ?", updated
            )
            conn.commit()


# ─────────────────────────────────────────────
#  Entries
# ─────────────────────────────────────────────

def upsert_entry(entry: CatalogEntry) -> CatalogEntry:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO select_entries(id, file_path, data) VALUES(?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET data=excluded.data, file_path=excluded.file_path",
            (entry.id, entry.file_path, entry.model_dump_json()),
        )
        conn.commit()
    return entry


def get_entry(entry_id: str) -> Optional[CatalogEntry]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM select_entries WHERE id=?", (entry_id,)
        ).fetchone()
    if not row:
        return None
    return CatalogEntry.model_validate_json(row["data"])


def get_entry_by_path(file_path: str) -> Optional[CatalogEntry]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM select_entries WHERE file_path=?", (file_path,)
        ).fetchone()
    if not row:
        return None
    return CatalogEntry.model_validate_json(row["data"])


def list_entries(
    status: Optional[CatalogEntryStatus] = None,
    collection_id: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
) -> List[CatalogEntry]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT data FROM select_entries ORDER BY id LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

    entries = [CatalogEntry.model_validate_json(r["data"]) for r in rows]

    if status is not None:
        entries = [e for e in entries if e.status == status]
    if collection_id is not None:
        entries = [e for e in entries if collection_id in e.collection_ids]

    return entries


def delete_entry(entry_id: str) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM select_entries WHERE id=?", (entry_id,))
        conn.commit()
    return cur.rowcount > 0


# ─────────────────────────────────────────────
#  Collections
# ─────────────────────────────────────────────

def upsert_collection(col: CatalogCollection) -> CatalogCollection:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO select_collections(id, data) VALUES(?,?) "
            "ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (col.id, col.model_dump_json()),
        )
        conn.commit()
    return col


def get_collection(col_id: str) -> Optional[CatalogCollection]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM select_collections WHERE id=?", (col_id,)
        ).fetchone()
    if not row:
        return None
    return CatalogCollection.model_validate_json(row["data"])


def list_collections() -> List[CatalogCollection]:
    with _conn() as conn:
        rows = conn.execute("SELECT data FROM select_collections ORDER BY id").fetchall()
    return [CatalogCollection.model_validate_json(r["data"]) for r in rows]


def delete_collection(col_id: str) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM select_collections WHERE id=?", (col_id,))
        conn.commit()
    return cur.rowcount > 0


# ─────────────────────────────────────────────
#  Stats
# ─────────────────────────────────────────────

def get_stats() -> dict:
    with _conn() as conn:
        rows = conn.execute("SELECT data FROM select_entries").fetchall()
    entries = [CatalogEntry.model_validate_json(r["data"]) for r in rows]
    ready = [e for e in entries if e.status == CatalogEntryStatus.ready]
    total_dur = sum(e.duration_seconds or 0 for e in ready)
    with _conn() as conn:
        n_cols = conn.execute("SELECT COUNT(*) FROM select_collections").fetchone()[0]
    return {
        "total_entries": len(entries),
        "ready_entries": len(ready),
        "total_duration_s": total_dur,
        "collections": n_cols,
    }
