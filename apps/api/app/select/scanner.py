"""
Folder scanner — discovers audio files and queues them as pending catalog entries.
Reads ID3/VorbisComment/MP4 tags immediately on import so Title/Artist/Album
columns are populated before analysis completes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from .metadata import read_file_metadata
from .models import CatalogEntry, CatalogEntryStatus
from .repository import get_entry_by_path, upsert_entry

AUDIO_EXTENSIONS = frozenset(["wav", "flac", "aiff", "aif", "mp3", "m4a", "ogg"])


def scan_folder(
    folder_path: str,
    recursive: bool = True,
    extensions: List[str] | None = None,
    collection_ids: List[str] | None = None,
) -> List[CatalogEntry]:
    """
    Scan folder_path for audio files. Each new file gets a pending CatalogEntry.
    Files already in the catalog are returned as-is (no duplicate inserts).
    """
    root = Path(folder_path)
    if not root.is_dir():
        return []

    exts = frozenset(extensions or list(AUDIO_EXTENSIONS))
    pattern = "**/*" if recursive else "*"
    now = datetime.now(timezone.utc).isoformat()

    new_entries: List[CatalogEntry] = []
    for path in root.glob(pattern):
        if not path.is_file():
            continue
        if path.suffix.lstrip(".").lower() not in exts:
            continue

        existing = get_entry_by_path(str(path))
        if existing:
            new_entries.append(existing)
            continue

        meta = read_file_metadata(str(path))
        entry = CatalogEntry(
            id=str(uuid.uuid4()),
            file_path=str(path),
            file_name=path.name,
            title=meta.get("title"),
            artist=meta.get("artist"),
            album=meta.get("album"),
            has_artwork=meta.get("has_artwork", False),
            status=CatalogEntryStatus.pending,
            added_at=now,
            collection_ids=list(collection_ids or []),
        )
        upsert_entry(entry)
        new_entries.append(entry)

    return new_entries
