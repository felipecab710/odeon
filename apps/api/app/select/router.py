"""
Select API router — all /select/* endpoints.
"""
from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Set

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, FileResponse

from .compatibility import score as compat_score
from .embeddings import (
    init_embeddings_db, _feature_vec, similar_by_features,
    parse_text_query, score_entry_for_query,
    embed_text_clap, embed_audio_clap, upsert_clap_vec,
    get_clap_vecs_all, get_feature_vecs_all, _cosine, _clap_status,
)
from .transition_graph import (
    init_transition_db, record_transition, get_next_by_transitions,
    transition_stats, fetch_transitions_for_track, rebuild_key_map,
    get_fetch_progress,
)
from .markers import delete_marker, get_markers, init_markers_db, upsert_marker
from .metadata import get_artwork_bytes
from .models import (
    CatalogCollection,
    CatalogEntry,
    CatalogEntryStatus,
    CatalogMarker,
    CompatibilityScore,
    CreateCollectionRequest,
    CreateMarkerRequest,
    ImportFolderRequest,
    SelectStats,
    UpdateTagsRequest,
)
from .repository import (
    delete_collection,
    delete_entry,
    get_entry,
    get_stats,
    init_select_db,
    list_collections,
    list_entries,
    upsert_collection,
    upsert_entry,
)
from .scanner import scan_folder
from .metadata import read_file_metadata
from ..ml.pipeline import (
    init_ml_db, embed_entry, embed_all_ready,
    semantic_search_runpod, get_all_vecs as ml_get_all_vecs,
    similar_by_model, muq_similarity_map, get_analysis, get_stems,
    analyze_entry_ml, separate_entry, plan_transition_for_set,
    generate_bridge_for_set, generate_riser_for_entry, get_mert_features,
    enqueue_stem_job, get_stem_job, list_stem_jobs, get_stems_summary,
)
from ..ml.runpod_client import is_configured as runpod_configured, get_status as runpod_status

router = APIRouter(prefix="/select", tags=["select"])

# Ensure tables exist when router is loaded
init_select_db()
init_markers_db()
init_embeddings_db()
init_transition_db()
init_ml_db()

# Bounded thread pool: max 2 concurrent analyses to leave headroom for
# the audio engine and Studio API calls. librosa/numpy release the GIL
# so actual parallelism is real (not limited by Python threads).
_analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="odeon-analysis")
_stem_semaphore = asyncio.Semaphore(1)
_stem_inflight: Set[str] = set()


def _stem_priority_for_entry(entry: CatalogEntry) -> int:
    # Tracks in collections are more likely to be used for set building.
    return 80 if entry.collection_ids else 50


async def _run_separation_async(entry_id: str) -> None:
    if entry_id in _stem_inflight:
        return
    _stem_inflight.add(entry_id)
    try:
        async with _stem_semaphore:
            await separate_entry(entry_id)
    finally:
        _stem_inflight.discard(entry_id)


def _queue_separation(entry: CatalogEntry, *, force: bool = False) -> None:
    job = enqueue_stem_job(entry.id, priority=_stem_priority_for_entry(entry), force=force)
    if job.get("status") == "completed" and not force:
        return
    asyncio.create_task(_run_separation_async(entry.id))


# ─────────────────────────────────────────────
#  Waveform cache proxy (fallback for browser / Tauri plugin issues)
# ─────────────────────────────────────────────

@router.get("/waveform")
def get_waveform_cache(path: str):
    """Serve the raw binary .odeon.wavecache file by absolute path."""
    import os
    if not os.path.isfile(path):
        raise HTTPException(404, "Cache file not found")
    with open(path, "rb") as f:
        data = f.read()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ─────────────────────────────────────────────
#  Waveform-only rebuild (fast — skips BPM/key/LUFS)
# ─────────────────────────────────────────────

def _rebuild_one_waveform(entry_id: str) -> bool:
    from app.audio.waveform_cache import load_audio_stereo, build_and_cache_from_arrays
    from app.audio.analysis import compute_freq_colors
    entry = get_entry(entry_id)
    if not entry or entry.status != CatalogEntryStatus.ready:
        return False
    try:
        import librosa
        import numpy as np
        left, right, sr, duration, channels = load_audio_stereo(entry.file_path)
        mono = librosa.to_mono(np.stack([left, right]))
        freq_colors = compute_freq_colors(mono, sr)
        build_and_cache_from_arrays(entry.file_path, left, right, sr, duration, channels, freq_colors)
        return True
    except Exception as e:
        return False


@router.post("/entries/{entry_id}/rebuild-waveform")
async def rebuild_entry_waveform(entry_id: str):
    """Rebuild .odeon.wavecache for one READY entry (fast — waveform only)."""
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    if entry.status != CatalogEntryStatus.ready:
        raise HTTPException(400, "Entry must be analyzed (ready) before rebuilding waveform")
    ok = _rebuild_one_waveform(entry_id)
    if not ok:
        raise HTTPException(500, "Waveform rebuild failed")
    return {"rebuilt": True, "entry_id": entry_id}


@router.post("/rebuild-waveforms")
async def rebuild_waveforms():
    """Rebuild .odeon.wavecache for all READY entries (skips BPM/key analysis)."""
    entries = [e for e in list_entries(limit=5000) if e.status == CatalogEntryStatus.ready]
    import threading
    results = []
    lock = asyncio.Lock()

    def _worker(entry_id: str):
        ok = _rebuild_one_waveform(entry_id)
        results.append(ok)

    # Use daemon threads so uvicorn reloads don't block on these
    threads = [threading.Thread(target=_worker, args=(e.id,), daemon=True) for e in entries]
    for t in threads:
        t.start()

    # Wait for all in an executor so the event loop stays free
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: [t.join() for t in threads])
    return {"rebuilt": sum(1 for r in results if r), "total": len(entries)}


# ─────────────────────────────────────────────
#  Metadata refresh
# ─────────────────────────────────────────────

def _do_refresh_metadata() -> int:
    """Re-reads ID3 tags for every entry and updates title/artist/album/has_artwork."""
    entries = list_entries(limit=5000)
    updated = 0
    for entry in entries:
        try:
            meta = read_file_metadata(entry.file_path)
            entry.title = meta.get("title")
            entry.artist = meta.get("artist")
            entry.album = meta.get("album")
            entry.has_artwork = meta.get("has_artwork", False)
            upsert_entry(entry)
            updated += 1
        except Exception:
            pass
    return updated


@router.post("/refresh-metadata")
async def refresh_metadata():
    """Background-safe: re-reads ID3 tags for all catalog entries."""
    loop = asyncio.get_event_loop()
    updated = await loop.run_in_executor(_analysis_executor, _do_refresh_metadata)
    return {"updated": updated}


# ─────────────────────────────────────────────
#  Catalog entries
# ─────────────────────────────────────────────

@router.get("/entries", response_model=List[CatalogEntry])
def list_catalog_entries(
    status: Optional[CatalogEntryStatus] = None,
    collection_id: Optional[str] = None,
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
):
    return list_entries(status=status, collection_id=collection_id, limit=limit, offset=offset)


@router.get("/entries/{entry_id}", response_model=CatalogEntry)
def get_catalog_entry(entry_id: str):
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")
    return entry


@router.delete("/entries/{entry_id}")
def delete_catalog_entry(entry_id: str):
    if not delete_entry(entry_id):
        raise HTTPException(404, f"Entry not found: {entry_id}")
    return {"deleted": entry_id}


@router.get("/entries/{entry_id}/artwork")
def get_entry_artwork(entry_id: str):
    """Return embedded album art as JPEG/PNG bytes."""
    entry = get_entry(entry_id)
    if not entry or not entry.has_artwork:
        raise HTTPException(404, "No artwork")
    data = get_artwork_bytes(entry.file_path)
    if not data:
        raise HTTPException(404, "No artwork")
    # Detect JPEG vs PNG by magic bytes
    mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return Response(content=data, media_type=mime, headers={
        "Cache-Control": "public, max-age=86400, immutable",
    })


@router.get("/entries/{entry_id}/preview")
def preview_entry_audio(entry_id: str):
    """Stream audio file for in-app preview playback."""
    import os
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    path = entry.file_path
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found on disk")
    suffix = path.rsplit(".", 1)[-1].lower()
    media_types = {
        "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac",
        "m4a": "audio/mp4", "aac": "audio/aac", "ogg": "audio/ogg",
        "aiff": "audio/aiff", "aif": "audio/aiff",
    }
    mime = media_types.get(suffix, "audio/mpeg")
    return FileResponse(path, media_type=mime, headers={"Accept-Ranges": "bytes"})


# ─────────────────────────────────────────────
#  Folder import
# ─────────────────────────────────────────────

@router.post("/import", response_model=List[CatalogEntry])
async def import_folder(req: ImportFolderRequest):
    """Scan folder and add discovered audio files to the catalog."""
    collection_ids: List[str] = []

    if req.collection_name:
        col = CatalogCollection(
            id=str(uuid.uuid4()),
            name=req.collection_name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        upsert_collection(col)
        collection_ids = [col.id]

    entries = scan_folder(
        req.folder_path,
        recursive=req.recursive,
        extensions=req.extensions,
        collection_ids=collection_ids,
    )
    # Precompute stems in background so timeline/set workflows don't block later.
    for entry in entries:
        _queue_separation(entry)
    return entries


# ─────────────────────────────────────────────
#  Analysis
# ─────────────────────────────────────────────

_ANALYSIS_TIMEOUT_S = 180  # 3 minutes max per track


def _run_analysis(entry_id: str) -> None:
    """Background task: run full audio analysis and update entry."""
    from ..audio.analysis import analyze_track, estimate_key_placeholder
    import soundfile as sf
    import numpy as np

    entry = get_entry(entry_id)
    if not entry:
        return

    entry.status = CatalogEntryStatus.analyzing
    upsert_entry(entry)

    try:
        result = analyze_track(entry.file_path)
        # Key estimation
        try:
            data, sr = sf.read(entry.file_path, dtype="float32", always_2d=True)
            mono = data.mean(axis=1)
            entry.key = estimate_key_placeholder(mono, int(sr))
        except Exception:
            pass

        # Check if we were already marked as timed-out while the thread ran
        fresh = get_entry(entry_id)
        if fresh and fresh.status == CatalogEntryStatus.error:
            return  # Timeout already wrote an error — don't overwrite

        entry.duration_seconds    = result.duration_seconds
        entry.sample_rate         = result.sample_rate
        entry.channels            = result.channels
        entry.bpm                 = result.tempo
        entry.beat_times          = result.beat_times
        entry.integrated_lufs     = result.integrated_lufs
        entry.true_peak_db        = result.true_peak_db
        entry.rms_db              = result.rms_db
        entry.waveform_cache_path = result.waveform_cache_path
        entry.status              = CatalogEntryStatus.ready

    except Exception as exc:
        entry.status        = CatalogEntryStatus.error
        entry.error_message = str(exc)

    upsert_entry(entry)

    # Auto-embed on RunPod after successful analysis
    if entry.status == CatalogEntryStatus.ready and runpod_configured():
        import threading
        def _auto_embed():
            import asyncio
            try:
                asyncio.run(embed_entry(entry_id, models=["clap", "muq"]))
            except Exception:
                pass
        threading.Thread(target=_auto_embed, daemon=True).start()


async def _run_analysis_async(entry_id: str) -> None:
    """Submit one analysis job to the bounded thread pool with a hard timeout."""
    loop = asyncio.get_event_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(_analysis_executor, _run_analysis, entry_id),
            timeout=_ANALYSIS_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        entry = get_entry(entry_id)
        if entry and entry.status == CatalogEntryStatus.analyzing:
            entry.status = CatalogEntryStatus.error
            entry.error_message = f"Analysis timed out after {_ANALYSIS_TIMEOUT_S}s — file may be corrupt or unusually large."
            upsert_entry(entry)


@router.post("/entries/{entry_id}/analyze")
async def analyze_entry(entry_id: str):
    """Enqueue full analysis for a catalog entry (non-blocking)."""
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")
    asyncio.create_task(_run_analysis_async(entry_id))
    return {"queued": entry_id}


@router.post("/analyze-all")
async def analyze_all_pending():
    """Enqueue analysis for all pending entries (max 2 run concurrently)."""
    pending = list_entries(status=CatalogEntryStatus.pending)
    for e in pending:
        asyncio.create_task(_run_analysis_async(e.id))
    return {"queued": len(pending)}


# ─────────────────────────────────────────────
#  Tags
# ─────────────────────────────────────────────

@router.patch("/entries/{entry_id}/tags", response_model=CatalogEntry)
def update_tags(entry_id: str, req: UpdateTagsRequest):
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")
    entry.tags = req.tags
    return upsert_entry(entry)


# ─────────────────────────────────────────────
#  Collections
# ─────────────────────────────────────────────

@router.get("/collections", response_model=List[CatalogCollection])
def list_select_collections():
    return list_collections()


@router.post("/collections", response_model=CatalogCollection)
def create_collection(req: CreateCollectionRequest):
    col = CatalogCollection(
        id=str(uuid.uuid4()),
        name=req.name,
        description=req.description,
        entry_ids=req.entry_ids,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return upsert_collection(col)


@router.delete("/collections/{col_id}")
def delete_select_collection(col_id: str):
    if not delete_collection(col_id):
        raise HTTPException(404, f"Collection not found: {col_id}")
    return {"deleted": col_id}


# ─────────────────────────────────────────────
#  Compatibility
# ─────────────────────────────────────────────

@router.get("/compatibility", response_model=CompatibilityScore)
def get_compatibility(entry_id_a: str, entry_id_b: str):
    a = get_entry(entry_id_a)
    b = get_entry(entry_id_b)
    if not a:
        raise HTTPException(404, f"Entry not found: {entry_id_a}")
    if not b:
        raise HTTPException(404, f"Entry not found: {entry_id_b}")
    return compat_score(a, b)


# ─────────────────────────────────────────────
#  Markers  (cue / hot cue / memory / loop)
# ─────────────────────────────────────────────

@router.get("/entries/{entry_id}/markers", response_model=List[CatalogMarker])
def list_markers(entry_id: str):
    return get_markers(entry_id)


@router.post("/entries/{entry_id}/markers", response_model=CatalogMarker)
def create_marker(entry_id: str, req: CreateMarkerRequest):
    import uuid
    from datetime import datetime, timezone
    if not get_entry(entry_id):
        raise HTTPException(404, f"Entry not found: {entry_id}")
    marker = CatalogMarker(
        id=str(uuid.uuid4()),
        entry_id=entry_id,
        type=req.type,
        time_seconds=req.time_seconds,
        end_time_seconds=req.end_time_seconds,
        label=req.label,
        color=req.color,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return upsert_marker(marker)


@router.delete("/entries/{entry_id}/markers/{marker_id}")
def remove_marker(entry_id: str, marker_id: str):
    if not delete_marker(marker_id):
        raise HTTPException(404, f"Marker not found: {marker_id}")
    return {"deleted": marker_id}


# ─────────────────────────────────────────────
#  Semantic search (Layer 2 + CLAP Layer 2b)
# ─────────────────────────────────────────────

@router.get("/search")
async def semantic_search(q: str, limit: int = Query(default=20, le=100)):
    """
    Natural-language search across the library.
    
    Priority: RunPod CLAP → local CLAP → metadata keyword parser.
    
    Examples:
      ?q=dark+minimal+groover+126+bpm
      ?q=peak+time+tech+house+8B
      ?q=melodic+sunrise+set+A+minor
    """
    all_entries = list_entries(status="ready", limit=5000)
    if not all_entries:
        return []

    # RunPod CLAP (GPU) — best quality when embeddings are stored
    if runpod_configured():
        runpod_results = await semantic_search_runpod(q, limit=limit)
        if runpod_results:
            return runpod_results

    clap_available = _clap_status()

    if clap_available:
        # Try CLAP text embedding → cosine against stored audio embeddings
        text_vec = embed_text_clap(q)
        if text_vec:
            stored = get_clap_vecs_all()
            scored = []
            entry_map = {e.id: e for e in all_entries}
            for entry_id, audio_vec in stored.items():
                if entry_id in entry_map:
                    sim = _cosine(text_vec, audio_vec)
                    scored.append((sim, entry_map[entry_id]))
            scored.sort(reverse=True)
            return [
                {
                    "entry_id": e.id,
                    "title": e.title or e.file_name,
                    "artist": e.artist,
                    "bpm": e.bpm,
                    "key": e.key,
                    "duration_seconds": e.duration_seconds,
                    "has_artwork": e.has_artwork,
                    "score": s,
                    "method": "clap",
                }
                for s, e in scored[:limit]
            ]

    # Fallback: parse text query + score by metadata
    parsed = parse_text_query(q)
    scored = []
    for e in all_entries:
        s = score_entry_for_query(e, parsed)
        if s > 0.05:
            scored.append((s, e))
    scored.sort(key=lambda x: x[0], reverse=True)

    return [
        {
            "entry_id": e.id,
            "title": e.title or e.file_name,
            "artist": e.artist,
            "bpm": e.bpm,
            "key": e.key,
            "duration_seconds": e.duration_seconds,
            "has_artwork": e.has_artwork,
            "score": s,
            "method": "metadata",
            "parsed": parsed,
        }
        for s, e in scored[:limit]
    ]


@router.get("/search/status")
async def search_status():
    """Returns which embedding mode is active and CLAP/RunPod readiness."""
    clap_ready = _clap_status()
    stored_clap  = 0
    stored_muq   = 0
    stored_mert  = 0
    stored_feats = 0
    try:
        stored_clap  = len(get_clap_vecs_all()) or len(ml_get_all_vecs("clap"))
        stored_muq   = len(ml_get_all_vecs("muq"))
        stored_mert  = len(ml_get_all_vecs("mert"))
        stored_feats = len(get_feature_vecs_all())
    except Exception:
        pass

    runpod = None
    if runpod_configured():
        runpod = await runpod_status()
        runpod = {
            "configured": True,
            "ok": runpod.ok,
            "gpu": runpod.gpu,
            "models_loaded": runpod.models_loaded,
            "error": runpod.error,
        }
    else:
        runpod = {"configured": False, "hint": "Set RUNPOD_URL in apps/api/.env"}

    active = "metadata"
    if runpod.get("configured") and stored_clap > 0:
        active = "runpod_clap"
    elif clap_ready and stored_clap > 0:
        active = "local_clap"

    return {
        "clap_available": active != "metadata",
        "clap_embedded_tracks": stored_clap,
        "muq_embedded_tracks": stored_muq,
        "mert_embedded_tracks": stored_mert,
        "feature_embedded_tracks": stored_feats,
        "active_mode": active,
        "runpod": runpod,
        "install_hint": (
            None if (clap_ready or runpod.get("configured")) else
            "Set RUNPOD_URL or pip install laion-clap for semantic search"
        ),
    }


@router.get("/ml/status")
async def ml_status():
    """RunPod ML server connectivity and GPU info."""
    if not runpod_configured():
        return {"configured": False, "hint": "Set RUNPOD_URL in apps/api/.env"}
    status = await runpod_status()
    return {
        "configured": True,
        "ok": status.ok,
        "gpu": status.gpu,
        "models_loaded": status.models_loaded,
        "phases": status.phases,
        "error": status.error,
    }


@router.post("/entries/{entry_id}/embed-remote")
async def embed_entry_remote(
    entry_id: str,
    models: str = Query(default="clap", description="Comma-separated: clap,muq,mert"),
):
    """
    Upload track audio to RunPod GPU and store embedding vectors locally.
    Requires RUNPOD_URL to be set.
    """
    if not runpod_configured():
        raise HTTPException(400, "RUNPOD_URL not configured — set it in apps/api/.env")
    model_list = [m.strip() for m in models.split(",") if m.strip()]
    result = await embed_entry(entry_id, models=model_list)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/embed-remote-all")
async def embed_remote_all(
    models: str = Query(default="clap,muq"),
    background: bool = Query(default=True),
):
    """
    Embed all ready tracks missing vectors via RunPod.
    Runs in background by default (can take minutes for large libraries).
    """
    if not runpod_configured():
        raise HTTPException(400, "RUNPOD_URL not configured")

    model_list = [m.strip() for m in models.split(",") if m.strip()]

    if background:
        import threading
        def _run():
            import asyncio
            asyncio.run(embed_all_ready(models=model_list))
        t = threading.Thread(target=_run, daemon=True)
        t.start()
        entries = list_entries(status="ready", limit=5000)
        return {"queued": len(entries), "models": model_list, "background": True}

    return await embed_all_ready(models=model_list)


@router.post("/embed/all")
def embed_all_tracks(background_tasks=None):
    """
    Compute CLAP embeddings for all ready tracks (runs in background).
    Requires laion-clap to be installed.
    """
    import asyncio

    if not _clap_status():
        raise HTTPException(400, "laion-clap not installed. Run: pip install laion-clap")

    entries = list_entries(status="ready", limit=5000)
    stored  = get_clap_vecs_all()
    missing = [e for e in entries if e.id not in stored and e.file_path]

    def _run():
        for e in missing:
            try:
                vec = embed_audio_clap(e.file_path)
                if vec:
                    upsert_clap_vec(e.id, vec)
            except Exception:
                pass

    import threading
    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return {"queued": len(missing), "already_embedded": len(stored)}


# ─────────────────────────────────────────────
#  Feature-vector similarity (always available)
# ─────────────────────────────────────────────

@router.get("/entries/{entry_id}/similar")
def similar_tracks(
    entry_id: str,
    limit: int = Query(default=10, le=30),
    exclude_ids: str = "",
):
    """
    Return tracks most similar to entry_id.
    Priority: MuQ embedding → MERT → BPM/key/LUFS feature vectors.
    """
    anchor = get_entry(entry_id)
    if not anchor:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    exclude = set(filter(None, exclude_ids.split(",")))
    exclude.add(entry_id)

    method = "features"
    scored_pairs: list = []

    for model in ("muq", "mert", "clap"):
        pairs = similar_by_model(entry_id, model=model, limit=limit, exclude_ids=exclude)
        if pairs:
            scored_pairs = pairs
            method = model
            break

    if not scored_pairs:
        candidates = list_entries(status="ready", limit=5000)
        feat = similar_by_features(anchor, candidates, limit=limit, exclude_ids=exclude)
        scored_pairs = [(s, e.id) for s, e in feat]
        method = "features"

    results = []
    for sim, eid in scored_pairs:
        e = get_entry(eid)
        if e:
            results.append({
                "entry_id": e.id,
                "title": e.title or e.file_name,
                "artist": e.artist,
                "bpm": e.bpm,
                "key": e.key,
                "duration_seconds": e.duration_seconds,
                "has_artwork": e.has_artwork,
                "similarity": sim,
                "method": method,
                "bpm_delta": abs(e.bpm - anchor.bpm) if e.bpm and anchor.bpm else None,
            })
    return results


# ─────────────────────────────────────────────
#  Transition graph (Layer 3)
# ─────────────────────────────────────────────

@router.post("/transitions/record")
def record_set_transition(body: dict):
    """
    Record that the user placed track B immediately after track A in a set.
    Called from Set Builder when user reorders cards.
    
    body = { from_entry_id, to_entry_id }
    """
    from_id = body.get("from_entry_id")
    to_id   = body.get("to_entry_id")
    if not from_id or not to_id:
        raise HTTPException(400, "from_entry_id and to_entry_id required")

    fa = get_entry(from_id)
    ta = get_entry(to_id)
    if not fa or not ta:
        raise HTTPException(404, "Entry not found")

    record_transition(
        from_entry_id=from_id,
        to_entry_id=to_id,
        from_artist=fa.artist,
        from_title=fa.title or fa.file_name,
        to_artist=ta.artist,
        to_title=ta.title or ta.file_name,
    )
    return {"recorded": True}


@router.get("/entries/{entry_id}/transitions")
def get_transitions(entry_id: str, limit: int = 5, exclude_ids: str = ""):
    """
    Return the most-played-after tracks for this entry from the transition graph.
    Combines user-recorded transitions + 1001tracklists data.
    """
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    exclude = set(filter(None, exclude_ids.split(",")))
    exclude.add(entry_id)

    nexts = get_next_by_transitions(
        entry_id=entry_id,
        artist=entry.artist,
        title=entry.title or entry.file_name,
        exclude_ids=exclude,
        limit=limit,
        include_unmatched=True,
    )

    result = []
    for n in nexts:
        if n.get("in_library") is False or not n.get("entry_id"):
            result.append({
                "entry_id": n.get("entry_id"),
                "title": n.get("title") or "unknown",
                "artist": n.get("artist"),
                "bpm": None,
                "key": None,
                "has_artwork": False,
                "transition_count": n["transition_count"],
                "pro_count": n.get("pro_count", 0),
                "user_count": n.get("user_count", 0),
                "source": n["source"],
                "in_library": False,
            })
            continue
        e = get_entry(n["entry_id"])
        if e:
            result.append({
                "entry_id": e.id,
                "title": e.title or e.file_name,
                "artist": e.artist,
                "bpm": e.bpm,
                "key": e.key,
                "has_artwork": e.has_artwork,
                "transition_count": n["transition_count"],
                "pro_count": n.get("pro_count", 0),
                "user_count": n.get("user_count", 0),
                "source": n["source"],
                "in_library": True,
            })

    return result


@router.get("/entries/{entry_id}/transition-stats")
def get_transition_stats(entry_id: str):
    """How many unique 'next track' possibilities exist in the graph for this track."""
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    stats = transition_stats(entry.artist, entry.title or entry.file_name)
    return stats


@router.get("/pro-dj/status")
def pro_dj_status_endpoint():
    """Whether Parse.bot API key is configured for 1001tracklists pro-DJ data."""
    from .tl_provider import pro_dj_status
    return pro_dj_status()


@router.post("/entries/{entry_id}/fetch-1001tl")
def fetch_1001tl(entry_id: str, background_tasks=None):
    """
    Fetch pro-DJ transitions from 1001tracklists via Parse.bot.
    Requires PARSE_API_KEY in apps/api/.env.
    """
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    all_entries = list_entries(status="ready", limit=5000)
    rebuild_key_map(all_entries)

    import threading
    def _run():
        fetch_transitions_for_track(
            artist=entry.artist or "",
            title=entry.title or entry.file_name,
            entry_id=entry_id,
        )
    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return {"queued": True, "track": entry.title or entry.file_name}


@router.get("/entries/{entry_id}/tl-fetch-status")
def tl_fetch_status(entry_id: str):
    """Poll while a 1001TL background fetch is running."""
    return get_fetch_progress(entry_id)


@router.post("/fetch-1001tl-library")
def fetch_1001tl_library(limit: int = 50):
    """Prefetch pro-DJ data for up to `limit` library tracks (background)."""
    from .tl_provider import is_pro_dj_configured
    if not is_pro_dj_configured():
        return {"queued": 0, "error": "no_api_key"}

    entries = list_entries(status="ready", limit=5000)
    rebuild_key_map(entries)
    targets = entries[:limit]

    import threading
    def _run():
        for e in targets:
            try:
                fetch_transitions_for_track(
                    artist=e.artist or "",
                    title=e.title or e.file_name,
                    entry_id=e.id,
                )
            except Exception:
                pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return {"queued": len(targets)}


# ─────────────────────────────────────────────
#  Auto-cue suggestions from beat grid
# ─────────────────────────────────────────────

@router.get("/entries/{entry_id}/suggest-cues")
def suggest_cues(entry_id: str, count: int = Query(default=8, le=8)):
    """
    Suggest cue positions for a track using beat_times and structure analysis.
    Algorithm:
     1. Take beat_times array from the CatalogEntry.
     2. Find downbeats (every 4th beat) → candidate positions.
     3. Cluster candidates at phrase boundaries (32-beat = 8 bar gaps).
     4. Return up to `count` positions with intent labels.
    """
    import math

    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    beat_times = entry.beat_times or []
    duration = entry.duration_seconds or 0

    if not beat_times or duration < 10:
        return []

    bpm = entry.bpm
    if bpm is None or bpm <= 0:
        # Estimate from beat_times
        if len(beat_times) >= 2:
            intervals = [beat_times[i+1] - beat_times[i] for i in range(min(20, len(beat_times)-1))]
            avg_interval = sum(intervals) / len(intervals)
            bpm = 60.0 / avg_interval if avg_interval > 0 else 128.0
        else:
            bpm = 128.0

    beats_per_bar = 4
    bars_per_phrase = 8  # 8-bar phrase = standard EDM structure

    # Build phrase boundary candidates (every 8 bars = 32 beats)
    candidates = []
    phrase_beats = beats_per_bar * bars_per_phrase  # 32

    for i, t in enumerate(beat_times):
        if i % phrase_beats == 0 and t > 1.0:
            candidates.append((t, i))

    # If too few candidates, fall back to 4-bar (16-beat) boundaries
    if len(candidates) < 4:
        candidates = [(t, i) for i, t in enumerate(beat_times) if i % (beats_per_bar * 4) == 0 and t > 1.0]

    # Label them by position in the track
    result = []
    total_beats = len(beat_times)
    for pos, (t, beat_idx) in enumerate(candidates[:count]):
        pct = t / duration
        if pct < 0.06:
            label = "Intro"
        elif pct < 0.18:
            label = "Build"
        elif pct < 0.35:
            label = "Drop"
        elif pct < 0.52:
            label = "Break"
        elif pct < 0.68:
            label = "Drop 2"
        elif pct < 0.85:
            label = "Bridge"
        else:
            label = "Outro"

        bar_number = beat_idx // beats_per_bar
        result.append({
            "time_seconds": round(t, 4),
            "beat_index": beat_idx,
            "bar_number": bar_number,
            "label": label,
            "pct": round(pct * 100, 1),
        })

    return result


# ─────────────────────────────────────────────
#  Set Builder AI — suggest next tracks
# ─────────────────────────────────────────────

@router.get("/set/suggest")
def suggest_next_track(
    entry_id: str,
    exclude_ids: str = "",
    limit: int = Query(default=8, le=20),
):
    """
    Return the top N most-compatible catalog entries to play after entry_id.
    exclude_ids = comma-separated IDs to omit (tracks already in the set).
    """
    anchor = get_entry(entry_id)
    if not anchor:
        raise HTTPException(404, f"Entry not found: {entry_id}")

    exclude = set(filter(None, exclude_ids.split(",")))
    exclude.add(entry_id)

    candidates = [e for e in list_entries(status="ready", limit=2000) if e.id not in exclude]

    muq_sims = muq_similarity_map(entry_id, [c.id for c in candidates])

    scored = []
    for c in candidates:
        s = compat_score(anchor, c)
        if s.overall is not None:
            overall = s.overall
            if c.id in muq_sims:
                # Blend 60% harmonic/BPM + 40% sonic similarity
                overall = 0.6 * overall + 0.4 * max(0.0, muq_sims[c.id])
            scored.append({
                "entry_id": c.id,
                "title": c.title or c.file_name,
                "artist": c.artist,
                "bpm": c.bpm,
                "key": c.key,
                "duration_seconds": c.duration_seconds,
                "has_artwork": c.has_artwork,
                "overall": overall,
                "bpm_delta": s.bpm_delta,
                "key_compat": s.key_compat,
                "lufs_delta": s.lufs_delta,
                "sonic_sim": muq_sims.get(c.id),
            })

    scored.sort(key=lambda x: x["overall"], reverse=True)
    return scored[:limit]


@router.post("/set/auto-order")
def auto_order_set(body: dict):
    """
    Greedy nearest-neighbour ordering of a set.
    body = { "entry_ids": [...] }
    Returns ordered list of entry IDs.
    """
    ids: list[str] = body.get("entry_ids", [])
    if len(ids) < 2:
        return ids

    entries = [get_entry(eid) for eid in ids]
    entries = [e for e in entries if e is not None]
    if not entries:
        return ids

    # Start from the track with the highest BPM (peak energy opener heuristic)
    start = max(entries, key=lambda e: (e.bpm or 0))
    ordered = [start]
    remaining = [e for e in entries if e.id != start.id]

    while remaining:
        current = ordered[-1]
        best_score = -1.0
        best = remaining[0]
        for c in remaining:
            s = compat_score(current, c)
            sc = s.overall if s.overall is not None else 0.0
            if sc > best_score:
                best_score = sc
                best = c
        ordered.append(best)
        remaining.remove(best)

    return [e.id for e in ordered]


@router.get("/set/flow")
def set_flow(entry_ids: str):
    """
    Return pairwise compatibility scores for an ordered set.
    entry_ids = comma-separated ordered IDs.
    """
    ids = [i for i in entry_ids.split(",") if i]
    if len(ids) < 2:
        return []

    result = []
    for i in range(len(ids) - 1):
        a = get_entry(ids[i])
        b = get_entry(ids[i + 1])
        if a and b:
            s = compat_score(a, b)
            result.append({
                "from_id": ids[i],
                "to_id": ids[i + 1],
                "overall": s.overall,
                "bpm_delta": s.bpm_delta,
                "key_compat": s.key_compat,
                "lufs_delta": s.lufs_delta,
                "from_key": a.key,
                "to_key": b.key,
                "from_bpm": a.bpm,
                "to_bpm": b.bpm,
            })

    return result


# ─────────────────────────────────────────────
#  ML pipeline — analyze, separate, plan, generate
# ─────────────────────────────────────────────

@router.post("/entries/{entry_id}/analyze-ml")
async def analyze_entry_ml_endpoint(entry_id: str):
    """Run Music Flamingo (or librosa fallback) analysis via RunPod."""
    result = await analyze_entry_ml(entry_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/entries/{entry_id}/analysis")
def get_entry_analysis(entry_id: str):
    """Return stored ML analysis JSON for a track."""
    data = get_analysis(entry_id)
    if not data:
        raise HTTPException(404, "No analysis stored — run POST /analyze-ml first")
    entry = get_entry(entry_id)
    mert = get_mert_features(entry_id)
    return {
        "entry_id": entry_id,
        "title": entry.title if entry else None,
        **data,
        "mert_features": mert,
    }


@router.post("/entries/{entry_id}/separate")
async def separate_entry_endpoint(entry_id: str, wait: bool = Query(default=False)):
    """Queue or run separation for a track. Default: queue in background."""
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found")
    enqueue_stem_job(entry_id, priority=_stem_priority_for_entry(entry))
    if wait:
        result = await separate_entry(entry_id)
        if "error" in result:
            raise HTTPException(400, result["error"])
        return result
    _queue_separation(entry, force=True)
    return {"queued": entry_id, "job": get_stem_job(entry_id)}


@router.get("/entries/{entry_id}/stems")
def get_entry_stems(entry_id: str):
    stems = get_stems(entry_id)
    if not stems:
        raise HTTPException(404, "No stems stored — run POST /separate first")
    return {"entry_id": entry_id, **stems}


_STEM_TYPES = ("vocals", "drums", "bass", "other")


@router.get("/entries/{entry_id}/stems/{stem_type}/preview")
def preview_entry_stem(entry_id: str, stem_type: str):
    """Stream a separated stem WAV for in-app preview."""
    if stem_type not in _STEM_TYPES:
        raise HTTPException(400, f"stem_type must be one of: {', '.join(_STEM_TYPES)}")
    stems = get_stems(entry_id)
    if not stems:
        raise HTTPException(404, "No stems stored — run POST /separate first")
    path_key = f"{stem_type}_path"
    file_path = stems.get(path_key)
    if not file_path or not Path(file_path).is_file():
        raise HTTPException(404, f"Stem not found: {stem_type}")
    return FileResponse(file_path, media_type="audio/wav", headers={"Accept-Ranges": "bytes"})


@router.get("/entries/{entry_id}/stem-job")
def get_entry_stem_job(entry_id: str):
    job = get_stem_job(entry_id)
    if not job:
        raise HTTPException(404, "No stem job found")
    return job


@router.get("/stems/summary")
def stems_summary():
    """Which catalog entries have separated stems (for table indicators)."""
    return {"entries": get_stems_summary()}


@router.get("/stem-jobs")
def get_all_stem_jobs(
    status: Optional[str] = Query(default=None, pattern="^(queued|running|completed|failed)?$"),
    limit: int = Query(default=200, ge=1, le=2000),
):
    return {"jobs": list_stem_jobs(status=status, limit=limit)}


@router.post("/stems/enqueue-all")
async def enqueue_all_stems(force: bool = Query(default=False)):
    entries = list_entries(limit=5000)
    for entry in entries:
        _queue_separation(entry, force=force)
    return {"queued": len(entries), "force": force}


@router.post("/set/plan-transition")
async def plan_set_transition(body: dict):
    """
    AI transition plan between two tracks.
    body = { from_entry_id, to_entry_id }
    """
    from_id = body.get("from_entry_id")
    to_id = body.get("to_entry_id")
    if not from_id or not to_id:
        raise HTTPException(400, "from_entry_id and to_entry_id required")
    result = await plan_transition_for_set(from_id, to_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/generate/bridge")
async def generate_bridge_endpoint(body: dict):
    """Generate transition bridge audio between two tracks."""
    from_id = body.get("from_entry_id")
    to_id = body.get("to_entry_id")
    bars = int(body.get("bars", 8))
    if not from_id or not to_id:
        raise HTTPException(400, "from_entry_id and to_entry_id required")
    if not runpod_configured():
        raise HTTPException(400, "RUNPOD_URL not configured")
    result = await generate_bridge_for_set(from_id, to_id, bars=bars)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/generate/riser")
async def generate_riser_endpoint(body: dict):
    """Generate riser/impact audio for a track."""
    entry_id = body.get("entry_id")
    if not entry_id:
        raise HTTPException(400, "entry_id required")
    if not runpod_configured():
        raise HTTPException(400, "RUNPOD_URL not configured")
    result = await generate_riser_for_entry(
        entry_id,
        bars=int(body.get("bars", 4)),
        intensity=float(body.get("intensity", 0.8)),
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/generated/{gen_id}/audio")
def serve_generated_audio(gen_id: str):
    """Serve a locally stored generated audio file."""
    import sqlite3
    from ..db.repository import DB_PATH
    conn = sqlite3.connect(str(DB_PATH))
    row = conn.execute(
        "SELECT file_path FROM generated_audio WHERE id = ?", (gen_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Generated audio not found")
    path = row[0]
    if not Path(path).is_file():
        raise HTTPException(404, "Audio file missing on disk")
    return FileResponse(path, media_type="audio/wav")


# ─────────────────────────────────────────────
#  Stats
# ─────────────────────────────────────────────

@router.get("/stats", response_model=SelectStats)
def select_stats():
    return SelectStats(**get_stats())
