"""
Odeon ML Server — runs on RunPod GPU pod, port 8001.

Endpoints:
  GET  /status
  POST /embed          multipart file upload + models query param
  POST /embed/text     JSON {text} → CLAP text vector
  POST /embed/path     JSON {file_path, models} → vectors (pod-local paths)
  POST /separate       multipart file
  POST /analyze        multipart file
  POST /reason         JSON {audio_a_path, audio_b_path, context}
  POST /generate/bridge
  POST /generate/riser
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from models.embeddings import embed_all, embed_clap_text, save_upload_to_temp
from models.registry import dependency_status, gpu_info, is_loaded, loaded_models
from models import separation, analysis, reasoning, generation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Odeon ML Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional API key auth
_API_KEY = os.environ.get("ODEON_ML_API_KEY", "")


def _check_auth(authorization: Optional[str] = None) -> None:
    if not _API_KEY:
        return
    if not authorization or authorization != f"Bearer {_API_KEY}":
        raise HTTPException(401, "Unauthorized")


# ─── Request models ────────────────────────────────────────────────────────────

class EmbedPathRequest(BaseModel):
    file_path: str
    models: List[str] = ["clap", "muq", "mert"]


class EmbedTextRequest(BaseModel):
    text: str


class ReasonRequest(BaseModel):
    audio_a_path: str
    audio_b_path: str
    context: Dict[str, Any] = {}


class GenerateBridgeRequest(BaseModel):
    prompt: str
    bpm: int = 128
    key: str = "A min"
    bars: int = 8
    extra: Optional[Dict[str, Any]] = None


class GenerateRiserRequest(BaseModel):
    bpm: int = 128
    key: str = "A min"
    bars: int = 4
    intensity: float = 0.8


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _save_upload(upload: UploadFile) -> str:
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty file")
    return save_upload_to_temp(data, upload.filename or "audio.wav")


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/status")
def status():
    deps = dependency_status()
    return {
        "ok": True,
        "service": "odeon-ml-server",
        "version": "0.1.0",
        "gpu": gpu_info(),
        "models_loaded": loaded_models(),
        "dependencies": deps,
        "phases": {
            "embeddings": {
                "clap": deps.get("laion_clap", False),
                "muq": deps.get("transformers", False),
                "mert": deps.get("transformers", False),
            },
            "separation": separation.is_available(),
            "analysis": analysis.is_available(),
            "reasoning": reasoning.is_available(),
            "generation": generation.is_available(),
        },
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/embed")
async def embed_file(
    file: UploadFile = File(...),
    models: str = Query(default="clap", description="Comma-separated: clap,muq,mert"),
):
    """Upload audio file, return embedding vectors."""
    tmp = await _save_upload(file)
    try:
        model_list = [m.strip() for m in models.split(",") if m.strip()]
        result = embed_all(tmp, model_list)
        dims = {k: len(v) if v else 0 for k, v in result.items()}
        errors = {k: f"{k} embedding failed — check server logs" for k, v in result.items() if not v}
        if errors and all(v is None for v in result.values()):
            raise HTTPException(
                500,
                detail={
                    "message": "All embedding models failed",
                    "errors": errors,
                    "hint": "Run: pip install -r requirements.txt (laion-clap for CLAP)",
                },
            )
        return {"embeddings": result, "dims": dims, "models": model_list, "errors": errors or None}
    finally:
        Path(tmp).unlink(missing_ok=True)


@app.post("/embed/path")
def embed_path(req: EmbedPathRequest):
    """Embed a file already on the pod filesystem (e.g. /workspace/...)."""
    if not Path(req.file_path).is_file():
        raise HTTPException(404, f"File not found: {req.file_path}")
    result = embed_all(req.file_path, req.models)
    dims = {k: len(v) if v else 0 for k, v in result.items()}
    return {"embeddings": result, "dims": dims, "models": req.models}


@app.post("/embed/text")
def embed_text(req: EmbedTextRequest):
    """CLAP text embedding for semantic search queries."""
    vec = embed_clap_text(req.text)
    if vec is None:
        raise HTTPException(500, "CLAP text embedding failed — is laion-clap installed?")
    return {"embedding": vec, "dim": len(vec), "model": "clap"}


@app.post("/separate")
async def separate_file(file: UploadFile = File(...)):
    tmp = await _save_upload(file)
    try:
        return separation.separate(tmp)
    finally:
        Path(tmp).unlink(missing_ok=True)


@app.post("/analyze")
async def analyze_file(file: UploadFile = File(...)):
    tmp = await _save_upload(file)
    try:
        return analysis.analyze(tmp)
    finally:
        Path(tmp).unlink(missing_ok=True)


@app.post("/reason")
def reason(req: ReasonRequest):
    return reasoning.plan_transition(req.audio_a_path, req.audio_b_path, req.context)


@app.post("/generate/bridge")
def gen_bridge(req: GenerateBridgeRequest):
    return generation.generate_bridge(req.prompt, req.bpm, req.key, req.bars, req.extra)


@app.post("/generate/riser")
def gen_riser(req: GenerateRiserRequest):
    return generation.generate_riser(req.bpm, req.key, req.bars, req.intensity)


@app.get("/files/stems/{job_path:path}")
def download_stem(job_path: str):
    p = separation.stem_path(job_path)
    if not p:
        raise HTTPException(404, f"Stem not found: {job_path}")
    return FileResponse(str(p), media_type="audio/wav")


@app.get("/files/generated/{filename}")
def download_generated(filename: str):
    p = generation.generated_path(filename)
    if not p:
        raise HTTPException(404, f"Generated file not found: {filename}")
    return FileResponse(str(p), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
