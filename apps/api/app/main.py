"""
Odeon FastAPI analysis service.
Runs on localhost:8000. The Tauri frontend calls this over HTTP.
"""
from __future__ import annotations

import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .audio.analysis import analyze_track, quick_analyze
from .audio.compare import generate_mix_moves
from .db.repository import init_db, load_project, save_project
from .models import (
    AnalysisStatus,
    MixBlueprint,
    OdeonProject,
    OdeonTrack,
    ProjectStatus,
    StemType,
    TrackBusGroup,
    TrackGroupsUpdate,
    TrackRole,
    BlueprintProjectSummary,
    BlueprintTrackSummary,
)
from .separation.separator import get_separator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  Storage paths
# ─────────────────────────────────────────────

_BASE = Path(__file__).parent.parent.parent.parent.parent / "audio"
UPLOADS_DIR = _BASE / "uploads"
STEMS_DIR = _BASE / "stems"
PROJECTS_DIR = _BASE / "projects"
REPORTS_DIR = _BASE / "reports"
RENDERS_DIR = _BASE / "renders"

for _d in (UPLOADS_DIR, STEMS_DIR, PROJECTS_DIR, REPORTS_DIR, RENDERS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────
#  App
# ─────────────────────────────────────────────

app = FastAPI(title="Odeon Analysis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from .select.router import router as select_router
app.include_router(select_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("Odeon API ready. Storage root: %s", _BASE)


# ─────────────────────────────────────────────
#  Health
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    separator = get_separator()
    return {
        "status": "ok",
        "version": "0.1.0",
        "stem_separator": separator.__class__.__name__,
        "stem_separation_available": separator.is_available(),
    }


# ─────────────────────────────────────────────
#  Waveform cache (Pro Tools-style pyramid sidecar)
# ─────────────────────────────────────────────

@app.get("/waveform-cache")
def get_waveform_cache(path: str, format: str = Query(default="json", pattern="^(json|binary)$")):
    """Return the `.odeon.wavecache` sidecar. Builds on first request if missing.

    format=json   → JSON response (browser fallback)
    format=binary → raw v2 binary bytes (Tauri desktop fast path)
    """
    from .audio.waveform_cache import (
        build_and_cache_waveform,
        cache_path_for,
        read_waveform_cache,
        read_waveform_cache_as_json,
    )

    audio = Path(path)
    if not audio.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {path}")

    if format == "binary":
        sidecar = cache_path_for(path)
        if not sidecar.exists():
            try:
                build_and_cache_waveform(path)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Waveform cache build failed: {exc}")
        return Response(content=sidecar.read_bytes(), media_type="application/octet-stream")

    data = read_waveform_cache_as_json(path)
    if data is None:
        try:
            data, _ = build_and_cache_waveform(path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Waveform cache build failed: {exc}")

    return JSONResponse(data)


@app.get("/waveform-cache/tile")
def get_waveform_cache_tile(
    path: str,
    block_size: int = Query(..., description="Pyramid block size (64, 256, 1024, 4096, 16384)"),
    chunk: int = Query(default=0, ge=0, description="Chunk index (0-based, 6000 buckets each)"),
):
    """Return a slice of one pyramid level — for partial loading of very long files."""
    from .audio.waveform_cache import (
        build_and_cache_waveform,
        cache_path_for,
        read_waveform_cache_tile,
    )

    audio = Path(path)
    if not audio.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {path}")

    sidecar = cache_path_for(path)
    if not sidecar.exists():
        try:
            build_and_cache_waveform(path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Waveform cache build failed: {exc}")

    tile = read_waveform_cache_tile(path, block_size, chunk)
    if tile is None:
        raise HTTPException(status_code=404, detail=f"No pyramid level {block_size} in cache")

    return JSONResponse(tile)


# ─────────────────────────────────────────────
#  Projects
# ─────────────────────────────────────────────

@app.post("/projects", response_model=OdeonProject)
def create_project(name: str = "Untitled Project", folder_path: Optional[str] = None):
    """
    Create a new project.  If folder_path is given the project folder is placed
    inside it; otherwise it defaults to ~/Music/Odeon Projects/.

    Folder structure (mirrors Ardour):
        {folder_path}/{name}/
            {name}.odeon          ← JSON session file (human-readable)
            {name}.odeon.bak      ← written on every subsequent save
            audio/                ← uploaded source files
            stems/                ← Demucs-separated stems
            export/               ← rendered bounces
            analysis/             ← per-track analysis JSON cache
            peaks/                ← waveform peak files (future)
    """
    from pathlib import Path as _Path

    base = _Path(folder_path) if folder_path else (_Path.home() / "Music" / "Odeon Projects")
    project_dir = base / name

    # Create every sub-directory up front
    for sub in ("audio", "stems", "export", "analysis", "peaks"):
        (project_dir / sub).mkdir(parents=True, exist_ok=True)

    now = _now()
    project = OdeonProject(
        id=_uid(),
        name=name,
        created_at=now,
        updated_at=now,
        sample_rate=44100,
        status=ProjectStatus.empty,
        folder_path=str(project_dir),
    )
    save_project(project)
    _write_session_file(project)
    return project


@app.get("/projects", response_model=List[OdeonProject])
def list_projects_endpoint():
    """Return all saved projects, newest first."""
    from .db.repository import list_projects
    projects = list_projects()
    projects.sort(key=lambda p: p.updated_at, reverse=True)
    return projects


@app.get("/projects/{project_id}", response_model=OdeonProject)
def get_project(project_id: str):
    return _get_or_404(project_id)


@app.delete("/projects/{project_id}", status_code=204)
def delete_project_endpoint(project_id: str):
    from .db.repository import delete_project
    delete_project(project_id)


@app.get("/projects/{project_id}/tracks", response_model=List[OdeonTrack])
def get_tracks(project_id: str):
    return _get_or_404(project_id).tracks


@app.get("/projects/{project_id}/mix-moves")
def get_mix_moves(project_id: str):
    return _get_or_404(project_id).mix_moves


@app.put("/projects/{project_id}/track-groups", response_model=OdeonProject)
def update_track_groups(project_id: str, body: TrackGroupsUpdate):
    """Persist Pro Tools–style track/bus groups on the project."""
    project = _get_or_404(project_id)
    valid_ids = {t.id for t in project.tracks}

    cleaned: list[TrackBusGroup] = []
    for g in body.track_groups:
        track_ids = [tid for tid in g.track_ids if tid in valid_ids]
        if not track_ids:
            continue
        cleaned.append(g.model_copy(update={"track_ids": track_ids}))

    project.track_groups = cleaned
    project.updated_at = _now()
    save_project(project)
    _write_session_file(project)
    return project


# ─────────────────────────────────────────────
#  Reference upload
# ─────────────────────────────────────────────

@app.post("/projects/{project_id}/reference", response_model=OdeonProject)
async def upload_reference(project_id: str, file: UploadFile = File(...)):
    project = _get_or_404(project_id)

    dest = Path(project.folder_path) / "audio" if project.folder_path else UPLOADS_DIR / project_id
    dest.mkdir(parents=True, exist_ok=True)
    file_path = dest / _safe_name(file.filename or "reference.wav")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Replace any previous reference upload — never accumulate duplicate full-mix tracks
    project.tracks = [
        t for t in project.tracks
        if t.role not in (TrackRole.reference_full_mix, TrackRole.reference_stem)
    ]

    track_id = _uid()
    ref_track = OdeonTrack(
        id=track_id,
        project_id=project_id,
        name="Reference Full Mix",
        role=TrackRole.reference_full_mix,
        stem_type=StemType.full_mix,
        file_path=str(file_path),
        color="#4A90D9",
        analysis_status=AnalysisStatus.pending,
    )
    project.tracks.append(ref_track)
    project.reference_track_id = track_id
    project.status = ProjectStatus.reference_uploaded
    project.updated_at = _now()

    # Fast waveform-only pass so the track renders immediately
    try:
        ref_track.analysis = quick_analyze(str(file_path))
    except Exception as exc:
        logger.warning("Quick-analyze failed for reference: %s", exc)

    save_project(project)
    _write_session_file(project)
    return project


# ─────────────────────────────────────────────
#  User stem import
# ─────────────────────────────────────────────

_USER_STEM_COLOR = {
    "drums": "#C0392B",
    "bass": "#D68910",
    "vocals": "#1A8747",
    "music": "#6C3483",
    "fx": "#1F618D",
    "other": "#616A6B",
    "unknown": "#5D6D7E",
}


@app.post("/projects/{project_id}/user-stems", response_model=OdeonProject)
async def upload_user_stems(project_id: str, files: List[UploadFile] = File(...)):
    project = _get_or_404(project_id)

    dest = Path(project.folder_path) / "audio" if project.folder_path else UPLOADS_DIR / project_id / "user"
    dest.mkdir(parents=True, exist_ok=True)

    for file in files:
        file_path = dest / _safe_name(file.filename or "stem.wav")
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        stem_type = _guess_stem_type(file.filename or "")
        track = OdeonTrack(
            id=_uid(),
            project_id=project_id,
            name=_user_stem_name(file.filename or "stem.wav"),
            role=TrackRole.user_stem,
            stem_type=stem_type,
            file_path=str(file_path),
            color=_USER_STEM_COLOR.get(stem_type.value, "#5D6D7E"),
            analysis_status=AnalysisStatus.pending,
        )
        # Fast waveform-only pass
        try:
            track.analysis = quick_analyze(str(file_path))
        except Exception as exc:
            logger.warning("Quick-analyze failed for stem %s: %s", file.filename, exc)

        project.tracks.append(track)

    project.status = ProjectStatus.user_stems_imported
    project.updated_at = _now()
    save_project(project)
    _write_session_file(project)
    return project


# ─────────────────────────────────────────────
#  Analyze all pending tracks
# ─────────────────────────────────────────────

_STEM_COLORS = {
    "drums": "#E84C3D",
    "bass": "#F39C12",
    "vocals": "#2ECC71",
    "other": "#9B59B6",
}


def _separate_reference_stems(project: OdeonProject, project_id: str, track: OdeonTrack) -> None:
    """Run Demucs on a reference full-mix track and append reference_stem tracks."""
    if track.role != TrackRole.reference_full_mix:
        return

    stem_out_dir = (
        Path(project.folder_path) / "stems"
        if project.folder_path
        else STEMS_DIR / project_id / "reference"
    )
    separator = get_separator()
    if not separator.is_available():
        logger.info("Stem separator unavailable — inserting placeholder stems for track %s", track.id)
        project.tracks = [t for t in project.tracks if t.role != TrackRole.reference_stem]
        for stem_type_name in ("drums", "bass", "vocals", "music"):
            placeholder = OdeonTrack(
                id=_uid(),
                project_id=project_id,
                name=f"{stem_type_name.capitalize()} (Stem separation pending)",
                role=TrackRole.reference_stem,
                stem_type=StemType(stem_type_name),
                file_path=track.file_path,
                color=_STEM_COLORS.get(stem_type_name, "#888888"),
                analysis_status=AnalysisStatus.pending,
                muted=True,
            )
            project.tracks.append(placeholder)
        return

    logger.info("Separating stems for reference track %s", track.id)
    sep_result = separator.separate(track.file_path, str(stem_out_dir))
    if not sep_result.success:
        logger.error("Stem separation failed for track %s: %s", track.id, sep_result.error)
        return

    project.tracks = [t for t in project.tracks if t.role != TrackRole.reference_stem]
    for stem in sep_result.stems:
        stem_track = OdeonTrack(
            id=_uid(),
            project_id=project_id,
            name=stem.name,
            role=TrackRole.reference_stem,
            stem_type=StemType(stem.stem_type),
            file_path=stem.file_path,
            color=_STEM_COLORS.get(stem.stem_type, "#888888"),
            analysis_status=AnalysisStatus.pending,
        )
        try:
            stem_track.analysis = quick_analyze(stem.file_path)
        except Exception:
            pass
        project.tracks.append(stem_track)
    project.status = ProjectStatus.stems_separated


def _run_track_analysis(project: OdeonProject, track: OdeonTrack) -> None:
    track.analysis_status = AnalysisStatus.analyzing
    try:
        track.analysis = analyze_track(track.file_path)
        track.analysis_status = AnalysisStatus.complete
        if track.analysis.tempo and not project.bpm:
            project.bpm = track.analysis.tempo
        if track.analysis.sample_rate:
            project.sample_rate = track.analysis.sample_rate
    except Exception as exc:
        logger.error("Analysis failed for track %s: %s", track.id, exc)
        track.analysis_status = AnalysisStatus.failed


@app.post("/projects/{project_id}/analyze", response_model=OdeonProject)
def analyze_project(project_id: str):
    project = _get_or_404(project_id)

    for track in project.tracks:
        if track.analysis_status not in (AnalysisStatus.pending, AnalysisStatus.failed):
            continue
        _run_track_analysis(project, track)
        if (
            track.role == TrackRole.reference_full_mix
            and track.analysis_status == AnalysisStatus.complete
        ):
            _separate_reference_stems(project, project_id, track)

    if project.status != ProjectStatus.stems_separated:
        project.status = ProjectStatus.analyzed
    project.updated_at = _now()
    save_project(project)
    _write_session_file(project)
    return project


# ─────────────────────────────────────────────
#  Per-track analyze (full analysis + stems for reference)
# ─────────────────────────────────────────────

@app.delete("/projects/{project_id}/tracks/{track_id}", response_model=OdeonProject)
def delete_track(project_id: str, track_id: str):
    """Remove a track from the project. Deleting reference full-mix also removes its stems."""
    project = _get_or_404(project_id)
    track = next((t for t in project.tracks if t.id == track_id), None)
    if track is None:
        raise HTTPException(status_code=404, detail=f"Track {track_id} not found in project {project_id}")

    if track.role == TrackRole.reference_full_mix:
        project.tracks = [
            t for t in project.tracks
            if t.role not in (TrackRole.reference_full_mix, TrackRole.reference_stem)
        ]
        project.reference_track_id = None
    else:
        project.tracks = [t for t in project.tracks if t.id != track_id]

    if project.reference_track_id == track_id:
        project.reference_track_id = None

    project.mix_moves = [
        m for m in project.mix_moves
        if m.target_track_id != track_id and m.reference_track_id != track_id
    ]
    project.updated_at = _now()
    save_project(project)
    _write_session_file(project)
    return project


@app.post("/projects/{project_id}/tracks/{track_id}/analyze", response_model=OdeonProject)
def analyze_single_track(project_id: str, track_id: str):
    """
    Full analysis for one track.
    For reference_full_mix tracks: also separates stems (Demucs) and
    adds them to the project. Existing reference stems are replaced.
    """
    project = _get_or_404(project_id)
    track = next((t for t in project.tracks if t.id == track_id), None)
    if track is None:
        raise HTTPException(status_code=404, detail=f"Track {track_id} not found in project {project_id}")

    _run_track_analysis(project, track)
    if track.analysis_status == AnalysisStatus.failed:
        project.updated_at = _now()
        save_project(project)
        raise HTTPException(status_code=500, detail=f"Analysis failed for track {track_id}")

    if track.role == TrackRole.reference_full_mix:
        _separate_reference_stems(project, project_id, track)

    project.updated_at = _now()
    save_project(project)
    _write_session_file(project)
    return project


# ─────────────────────────────────────────────
#  Compare: generate MixMoves
# ─────────────────────────────────────────────

@app.post("/projects/{project_id}/compare", response_model=OdeonProject)
def compare_project(
    project_id: str,
    user_track_id: str | None = None,
    ref_track_id: str | None = None,
):
    project = _get_or_404(project_id)
    track_map = {t.id: t for t in project.tracks}

    pairs: list[tuple[OdeonTrack, OdeonTrack]] = []

    if user_track_id and ref_track_id:
        u = track_map.get(user_track_id)
        r = track_map.get(ref_track_id)
        if u and r:
            pairs = [(r, u)]
    else:
        # Auto-pair by stem_type
        ref_stems = {t.stem_type: t for t in project.tracks if t.role == TrackRole.reference_stem}
        user_stems = [t for t in project.tracks if t.role == TrackRole.user_stem]
        for user_t in user_stems:
            ref_t = ref_stems.get(user_t.stem_type)
            if ref_t is None:
                ref_track = next(
                    (t for t in project.tracks if t.role == TrackRole.reference_full_mix), None
                )
                if ref_track:
                    ref_t = ref_track
            if ref_t:
                pairs.append((ref_t, user_t))

    new_moves: list = []
    for ref_t, user_t in pairs:
        if ref_t.analysis and user_t.analysis:
            moves = generate_mix_moves(ref_t, user_t)
            new_moves.extend(moves)

    project.mix_moves = new_moves
    project.status = ProjectStatus.compared
    project.updated_at = _now()
    save_project(project)
    return project


# ─────────────────────────────────────────────
#  Mix Blueprint export
# ─────────────────────────────────────────────

@app.get("/projects/{project_id}/export-blueprint")
def export_blueprint(project_id: str):
    project = _get_or_404(project_id)

    ref_track = next(
        (t for t in project.tracks if t.id == project.reference_track_id), None
    )
    user_tracks = [t for t in project.tracks if t.role == TrackRole.user_stem]

    blueprint = MixBlueprint(
        exported_at=_now(),
        project=BlueprintProjectSummary(
            id=project.id,
            name=project.name,
            bpm=project.bpm,
            sample_rate=project.sample_rate,
        ),
        reference_track=BlueprintTrackSummary(
            id=ref_track.id,
            name=ref_track.name,
            stem_type=ref_track.stem_type,
            analysis=ref_track.analysis,
        ) if ref_track else None,
        user_tracks=[
            BlueprintTrackSummary(
                id=t.id,
                name=t.name,
                stem_type=t.stem_type,
                analysis=t.analysis,
            )
            for t in user_tracks
        ],
        mix_moves=project.mix_moves,
    )
    return JSONResponse(content=blueprint.model_dump(mode="json"))


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def _get_or_404(project_id: str) -> OdeonProject:
    project = load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")
    return project


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_name(filename: str) -> str:
    return Path(filename).name.replace(" ", "_")


def _write_session_file(project: OdeonProject) -> None:
    """Write / overwrite the human-readable {name}.odeon JSON session file."""
    if not project.folder_path:
        return
    folder = Path(project.folder_path)
    session_file = folder / f"{project.name}.odeon"
    # Rotate backup before overwriting
    if session_file.exists():
        session_file.replace(folder / f"{project.name}.odeon.bak")
    try:
        session_file.write_text(project.model_dump_json(indent=2))
    except Exception as exc:
        logger.warning("Could not write session file: %s", exc)


def _guess_stem_type(filename: str) -> StemType:
    name = filename.lower()
    if any(k in name for k in ("drum", "kick", "snare", "hat", "perc")):
        return StemType.drums
    if "bass" in name:
        return StemType.bass
    if any(k in name for k in ("voc", "vocal", "voice", "lead", "bg")):
        return StemType.vocals
    if any(k in name for k in ("synth", "keys", "piano", "guitar", "music", "melody")):
        return StemType.music
    if any(k in name for k in ("fx", "effect", "sfx", "foley")):
        return StemType.fx
    return StemType.unknown


def _user_stem_name(filename: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").title()
    if not stem.lower().startswith("my "):
        stem = "My " + stem
    return stem
