"""
Async HTTP client for the Odeon ML server on RunPod.

Set RUNPOD_URL in apps/api/.env:
  RUNPOD_URL=https://<pod-id>-8001.proxy.runpod.net
  RUNPOD_API_KEY=optional-bearer-token
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

RUNPOD_URL = os.environ.get("RUNPOD_URL", "").rstrip("/")
RUNPOD_API_KEY = os.environ.get("RUNPOD_API_KEY", "")
TIMEOUT = httpx.Timeout(300.0, connect=30.0)  # 5 min for large embeds


def is_configured() -> bool:
    return bool(RUNPOD_URL)


def _headers() -> Dict[str, str]:
    h: Dict[str, str] = {}
    if RUNPOD_API_KEY:
        h["Authorization"] = f"Bearer {RUNPOD_API_KEY}"
    return h


@dataclass
class EmbedResult:
    clap: Optional[List[float]] = None
    muq: Optional[List[float]] = None
    mert: Optional[List[float]] = None
    dims: Dict[str, int] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MlStatus:
    ok: bool
    gpu: Dict[str, Any]
    models_loaded: List[str]
    phases: Dict[str, Any]
    error: Optional[str] = None


async def get_status() -> MlStatus:
    if not is_configured():
        return MlStatus(ok=False, gpu={}, models_loaded=[], phases={}, error="RUNPOD_URL not set")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{RUNPOD_URL}/status", headers=_headers())
            r.raise_for_status()
            data = r.json()
            return MlStatus(
                ok=data.get("ok", True),
                gpu=data.get("gpu", {}),
                models_loaded=data.get("models_loaded", []),
                phases=data.get("phases", {}),
            )
    except Exception as e:
        logger.error("RunPod status failed: %s", e)
        return MlStatus(ok=False, gpu={}, models_loaded=[], phases={}, error=str(e))


async def embed_file(
    file_path: str,
    models: Optional[List[str]] = None,
) -> EmbedResult:
    """
    Upload a local audio file to RunPod and get embedding vectors.
    """
    if not is_configured():
        raise RuntimeError("RUNPOD_URL not configured")

    models = models or ["clap"]
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(file_path)

    model_str = ",".join(models)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        with open(path, "rb") as f:
            r = await client.post(
                f"{RUNPOD_URL}/embed",
                params={"models": model_str},
                files={"file": (path.name, f, "application/octet-stream")},
                headers=_headers(),
            )
        r.raise_for_status()
        data = r.json()

    embeddings = data.get("embeddings", {})
    return EmbedResult(
        clap=embeddings.get("clap"),
        muq=embeddings.get("muq"),
        mert=embeddings.get("mert"),
        dims=data.get("dims", {}),
        raw=data,
    )


async def embed_text(text: str) -> List[float]:
    """CLAP text embedding for semantic search."""
    if not is_configured():
        raise RuntimeError("RUNPOD_URL not configured")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{RUNPOD_URL}/embed/text",
            json={"text": text},
            headers={**_headers(), "Content-Type": "application/json"},
        )
        r.raise_for_status()
        data = r.json()
        return data["embedding"]


async def separate_file(file_path: str) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("RUNPOD_URL not configured")

    path = Path(file_path)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        with open(path, "rb") as f:
            r = await client.post(
                f"{RUNPOD_URL}/separate",
                files={"file": (path.name, f, "application/octet-stream")},
                headers=_headers(),
            )
        r.raise_for_status()
        return r.json()


async def analyze_file(file_path: str) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("RUNPOD_URL not configured")

    path = Path(file_path)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        with open(path, "rb") as f:
            r = await client.post(
                f"{RUNPOD_URL}/analyze",
                files={"file": (path.name, f, "application/octet-stream")},
                headers=_headers(),
            )
        r.raise_for_status()
        return r.json()


async def plan_transition(
    audio_a_path: str,
    audio_b_path: str,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("RUNPOD_URL not configured")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{RUNPOD_URL}/reason",
            json={
                "audio_a_path": audio_a_path,
                "audio_b_path": audio_b_path,
                "context": context or {},
            },
            headers={**_headers(), "Content-Type": "application/json"},
        )
        r.raise_for_status()
        return r.json()
