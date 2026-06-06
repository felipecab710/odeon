"""
Audio file metadata extraction using mutagen.
Reads ID3, VorbisComment, MP4, FLAC tags and embedded artwork.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional


def read_file_metadata(file_path: str) -> dict:
    """
    Return dict with title, artist, album, has_artwork.
    Falls back to None for any field that can't be read.
    """
    result: dict = {"title": None, "artist": None, "album": None, "has_artwork": False}
    try:
        from mutagen import File as MFile
        easy = MFile(file_path, easy=True)
        if easy is not None:
            def first(key: str) -> Optional[str]:
                v = easy.get(key)
                return str(v[0]) if v else None
            result["title"]  = first("title")
            result["artist"] = first("artist") or first("albumartist")
            result["album"]  = first("album")

        # Detect embedded artwork using the full (non-easy) interface
        raw = MFile(file_path)
        if raw is not None:
            result["has_artwork"] = _has_artwork(raw)
    except Exception:
        pass
    return result


def _has_artwork(raw) -> bool:
    try:
        tags = getattr(raw, "tags", None) or {}
        # ID3 (MP3)
        for key in tags:
            if hasattr(key, "startswith") and key.startswith("APIC"):
                return True
        # FLAC pictures
        if getattr(raw, "pictures", None):
            return True
        # MP4 covr
        if "covr" in tags:
            return True
        # Ogg
        if "metadata_block_picture" in tags:
            return True
    except Exception:
        pass
    return False


def get_artwork_bytes(file_path: str) -> Optional[bytes]:
    """Extract embedded album art; returns raw bytes or None."""
    try:
        from mutagen import File as MFile
        raw = MFile(file_path)
        if raw is None:
            return None
        tags = getattr(raw, "tags", None) or {}

        # ID3 — APIC frame
        for key in tags:
            if hasattr(key, "startswith") and key.startswith("APIC"):
                return bytes(tags[key].data)

        # FLAC pictures
        pics = getattr(raw, "pictures", [])
        if pics:
            return bytes(pics[0].data)

        # MP4 covr
        if "covr" in tags:
            item = tags["covr"]
            if item:
                return bytes(item[0])

        # Ogg / Vorbis — base64 encoded
        if "metadata_block_picture" in tags:
            import base64
            raw_b64 = tags["metadata_block_picture"]
            if raw_b64:
                block = base64.b64decode(raw_b64[0])
                # FlacPicture block: skip header to get to the raw image data
                from mutagen.flac import Picture
                pic = Picture(block)
                return bytes(pic.data)
    except Exception:
        pass
    return None
