"""
Embedding inference — CLAP, MuQ, MERT.
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .registry import get_device, load_clap, load_muq, load_mert, is_loaded

logger = logging.getLogger(__name__)


def embed_clap_audio(file_path: str) -> Optional[List[float]]:
    try:
        model = load_clap()
        vec = model.get_audio_embedding_from_filelist([file_path], use_tensor=False)[0]
        return vec.tolist()
    except Exception as e:
        logger.error("CLAP audio embed failed: %s", e)
        return None


def embed_clap_text(text: str) -> Optional[List[float]]:
    try:
        model = load_clap()
        vec = model.get_text_embedding([text], use_tensor=False)[0]
        return vec.tolist()
    except Exception as e:
        logger.error("CLAP text embed failed: %s", e)
        return None


def embed_muq(file_path: str) -> Optional[List[float]]:
    """
    MuQ-large audio embedding via mean-pooled hidden states.
    Returns 1024-dim vector (model-dependent).
    """
    try:
        import torch
        import torchaudio

        model = load_muq()
        device = get_device()

        waveform, sr = torchaudio.load(file_path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Resample to 24kHz if needed (MuQ standard)
        if sr != 24000:
            waveform = torchaudio.functional.resample(waveform, sr, 24000)
            sr = 24000

        # Truncate to 30s for embedding (full track mean-pool)
        max_samples = sr * 30
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

        with torch.no_grad():
            inputs = {"waveform": waveform.to(device), "sample_rate": sr}
            # MuQ models expose forward() or encode() depending on checkpoint
            if hasattr(model, "encode"):
                out = model.encode(waveform.to(device), sr)
            else:
                out = model(waveform.to(device))

            if isinstance(out, dict):
                hidden = out.get("last_hidden_state") or out.get("hidden_states", [None])[-1]
            elif hasattr(out, "last_hidden_state"):
                hidden = out.last_hidden_state
            else:
                hidden = out

            vec = hidden.mean(dim=1).squeeze().cpu().numpy()

        return vec.tolist()
    except Exception as e:
        logger.error("MuQ embed failed: %s", e)
        return None


def embed_mert(file_path: str) -> Optional[List[float]]:
    """
    MERT-v1-330M — mean-pooled layer-12 features for track-level similarity.
    """
    try:
        import torch
        import torchaudio

        model = load_mert()
        device = get_device()

        waveform, sr = torchaudio.load(file_path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        if sr != 24000:
            waveform = torchaudio.functional.resample(waveform, sr, 24000)
            sr = 24000

        max_samples = sr * 30
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

        with torch.no_grad():
            # MERT expects raw waveform input via processor
            from transformers import AutoFeatureExtractor
            if not hasattr(embed_mert, "_processor"):
                embed_mert._processor = AutoFeatureExtractor.from_pretrained(  # type: ignore
                    "m-a-p/MERT-v1-330M", trust_remote_code=True
                )
            processor = embed_mert._processor  # type: ignore

            inputs = processor(
                waveform.squeeze().numpy(),
                sampling_rate=sr,
                return_tensors="pt",
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}
            out = model(**inputs, output_hidden_states=True)
            # Layer 12 features (MERT paper recommendation)
            hidden = out.hidden_states[12] if out.hidden_states else out.last_hidden_state
            vec = hidden.mean(dim=1).squeeze().cpu().numpy()

        return vec.tolist()
    except Exception as e:
        logger.error("MERT embed failed: %s", e)
        return None


def embed_all(file_path: str, models: List[str]) -> Dict[str, Optional[List[float]]]:
    """Run requested embedding models on a local file path."""
    result: Dict[str, Optional[List[float]]] = {}
    for m in models:
        if m == "clap":
            result["clap"] = embed_clap_audio(file_path)
        elif m == "muq":
            result["muq"] = embed_muq(file_path)
        elif m == "mert":
            result["mert"] = embed_mert(file_path)
        else:
            result[m] = None
    return result


def save_upload_to_temp(data: bytes, filename: str) -> str:
    suffix = Path(filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        return f.name
