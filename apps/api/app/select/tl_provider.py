"""
1001tracklists pro-DJ data via Parse.bot API (stable, handles Cloudflare).

Discovery uses 1001tracklists public AJAX search (no captcha).
Tracklist contents are fetched through Parse.bot get_tracklist.

Set PARSE_API_KEY in apps/api/.env — free tier: 100 credits/month.
https://parse.bot/marketplace/ec03e43b-6798-40ce-86c9-02832adedc4c/1001tracklists-com-api
"""
from __future__ import annotations

import os
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import httpx

_TL_BASE = "https://www.1001tracklists.com"
_TL_AJAX_SUFFIX = "&noIDFieldCheck=true&fixedMode=true&sf=p"
_PARSE_BASE = "https://api.parse.bot/scraper/b93889bc-63b3-4524-8ff6-be513ab4401a"
_PARSE_MIN_GAP = 0.6  # stay under free-tier rate limits
_last_parse_req = 0.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://www.1001tracklists.com/",
}


def get_parse_api_key() -> Optional[str]:
    return os.getenv("PARSE_API_KEY") or os.getenv("PARSE_BOT_API_KEY")


def is_pro_dj_configured() -> bool:
    return bool(get_parse_api_key())


def pro_dj_status() -> Dict:
    key = get_parse_api_key()
    return {
        "configured": bool(key),
        "provider": "parse.bot",
        "signup_url": "https://parse.bot/marketplace/ec03e43b-6798-40ce-86c9-02832adedc4c/1001tracklists-com-api",
    }


def _primary_artist(artist: Optional[str]) -> str:
    if not artist:
        return ""
    return re.split(r"\s*[&,]\s*|\s+(?:feat|ft)\.?\s+", artist, maxsplit=1)[0].strip()


def _tl_ajax(path: str) -> Optional[dict]:
    try:
        with httpx.Client(timeout=15.0, headers=_HEADERS) as client:
            r = client.get(f"{_TL_BASE}{path}")
            r.raise_for_status()
            return r.json()
    except Exception:
        return None


def resolve_tl_track(artist: str, title: str) -> Optional[dict]:
    queries: List[str] = []
    for q in (title, f"{_primary_artist(artist)} {title}", f"{artist} {title}"):
        q = q.strip()
        if q and q not in queries:
            queries.append(q)

    for query in queries:
        payload = _tl_ajax(f"/ajax/search_track.php?p={quote_plus(query)}{_TL_AJAX_SUFFIX}")
        if not payload or not payload.get("success"):
            continue
        data = payload.get("data") or {}
        if not isinstance(data, dict) or not data:
            continue
        first = next(iter(data.values()))
        if isinstance(first, dict) and first.get("object") == "track":
            return first.get("properties") or first
    return None


def search_tl_tracklist_urls(artist: str, title: str, tl_track: Optional[dict] = None, limit: int = 12) -> List[str]:
    tl_track = tl_track or resolve_tl_track(artist, title)
    tl_artist = ""
    if tl_track:
        for key, val in tl_track.items():
            if str(key).isdigit() and isinstance(val, dict) and val.get("object") == "artist":
                tl_artist = (val.get("properties") or {}).get("artistname") or ""
                break

    queries = list(dict.fromkeys(filter(None, [
        title,
        f"{_primary_artist(tl_artist or artist)} {title}",
        f"{tl_artist} {title}".strip() if tl_artist else "",
    ])))

    seen: set[str] = set()
    urls: List[str] = []
    for query in queries:
        payload = _tl_ajax(f"/ajax/search_tracklist.php?p={quote_plus(query)}{_TL_AJAX_SUFFIX}")
        if not payload or not payload.get("success"):
            continue
        for item in payload.get("data") or []:
            if not isinstance(item, dict) or item.get("informal") == "nothing found":
                continue
            props = item.get("properties") or {}
            uid = props.get("id_unique")
            if not uid or uid in seen:
                continue
            seen.add(uid)
            slug = re.sub(r"[^a-z0-9]+", "-", (props.get("url_name") or "").lower()).strip("-")
            urls.append(f"{_TL_BASE}/tracklist/{uid}/{slug}.html")
            if len(urls) >= limit:
                return urls
    return urls


def _parse_get_tracklist(url: str) -> Optional[List[Tuple[str, str]]]:
    """Fetch ordered (artist, title) pairs from a tracklist via Parse.bot."""
    global _last_parse_req

    api_key = get_parse_api_key()
    if not api_key:
        return None

    gap = time.time() - _last_parse_req
    if gap < _PARSE_MIN_GAP:
        time.sleep(_PARSE_MIN_GAP - gap)

    try:
        with httpx.Client(timeout=45.0) as client:
            r = client.get(
                f"{_PARSE_BASE}/get_tracklist",
                params={"url": url},
                headers={"X-API-Key": api_key},
            )
            _last_parse_req = time.time()
            if r.status_code == 401:
                return None
            r.raise_for_status()
            body = r.json()
    except Exception:
        _last_parse_req = time.time()
        return None

    data = body.get("data") if isinstance(body, dict) else None
    if not data:
        return None

    tracks: List[Tuple[str, str]] = []
    for item in data.get("tracks") or []:
        if not isinstance(item, dict):
            continue
        artist = (item.get("artist") or "").strip()
        track_title = (item.get("title") or "").strip()
        if not track_title:
            continue
        # Parse sometimes returns combined "Artist - Title" in title field
        if not artist and " - " in track_title:
            artist, _, track_title = track_title.partition(" - ")
        tracks.append((artist.strip(), track_title.strip()))
    return tracks or None
