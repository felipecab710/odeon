"""
Odeon data directory layout.

Release builds set ODEON_DATA_DIR to the app support folder via the Tauri launcher.
Development defaults to <repo>/audio/.
"""
from __future__ import annotations

import os
from pathlib import Path


def data_root() -> Path:
    env = os.environ.get("ODEON_DATA_DIR", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    # apps/api/app/paths.py → repo root is 4 parents up from app/
    return Path(__file__).resolve().parents[3] / "audio"


DATA_ROOT = data_root()

UPLOADS_DIR = DATA_ROOT / "uploads"
STEMS_DIR = DATA_ROOT / "stems"
PROJECTS_DIR = DATA_ROOT / "projects"
REPORTS_DIR = DATA_ROOT / "reports"
RENDERS_DIR = DATA_ROOT / "renders"
DB_PATH = DATA_ROOT / "odeon.db"


def ensure_data_dirs() -> None:
    for d in (UPLOADS_DIR, STEMS_DIR, PROJECTS_DIR, REPORTS_DIR, RENDERS_DIR):
        d.mkdir(parents=True, exist_ok=True)
