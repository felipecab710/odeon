"""
SQLite repository — thin wrapper around a JSON-column-based store.
For v1 simplicity each project is stored as a single JSON blob.
The DB lives at audio/odeon.db (created automatically).
"""
from __future__ import annotations

import json
import sqlite3
from typing import List, Optional

from ..models import OdeonProject

from ..paths import DB_PATH


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
            """
        )
        conn.commit()


def save_project(project: OdeonProject) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)",
            (project.id, project.model_dump_json()),
        )
        conn.commit()


def load_project(project_id: str) -> Optional[OdeonProject]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
    if row is None:
        return None
    return OdeonProject.model_validate_json(row["data"])


def list_projects() -> List[OdeonProject]:
    with _conn() as conn:
        rows = conn.execute("SELECT data FROM projects").fetchall()
    return [OdeonProject.model_validate_json(r["data"]) for r in rows]


def delete_project(project_id: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
