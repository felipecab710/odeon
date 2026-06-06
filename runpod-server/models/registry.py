"""
Lazy model registry — loads models on first use, tracks GPU memory.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_loaded: Dict[str, Any] = {}
_lock = threading.Lock()


def is_loaded(name: str) -> bool:
    return name in _loaded


def loaded_models() -> List[str]:
    return list(_loaded.keys())


def get_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def gpu_info() -> Dict[str, Any]:
    import torch
    info: Dict[str, Any] = {"device": get_device(), "cuda_available": torch.cuda.is_available()}
    if torch.cuda.is_available():
        info["gpu_name"] = torch.cuda.get_device_name(0)
        info["vram_total_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
        info["vram_used_gb"] = round(torch.cuda.memory_allocated(0) / 1e9, 2)
    return info


def load_clap():
    """Load LAION-CLAP for text + audio embeddings."""
    with _lock:
        if "clap" in _loaded:
            return _loaded["clap"]
        logger.info("Loading CLAP model...")
        import laion_clap
        model = laion_clap.CLAP_Module(enable_fusion=False, amodel="HTSAT-tiny")
        model.load_ckpt()
        _loaded["clap"] = model
        logger.info("CLAP loaded on %s", get_device())
        return model


def load_muq():
    """Load MuQ-large for audio embeddings. Requires transformers + OpenMuQ."""
    with _lock:
        if "muq" in _loaded:
            return _loaded["muq"]
        logger.info("Loading MuQ-large...")
        # MuQ uses HuggingFace transformers — model card: OpenMuQ/MuQ-large-msd-iter
        from transformers import AutoModel
        model = AutoModel.from_pretrained(
            "OpenMuQ/MuQ-large-msd-iter",
            trust_remote_code=True,
        )
        device = get_device()
        model = model.to(device).eval()
        _loaded["muq"] = model
        logger.info("MuQ loaded on %s", device)
        return model


def load_mert():
    """Load MERT-v1-330M for musical feature extraction."""
    with _lock:
        if "mert" in _loaded:
            return _loaded["mert"]
        logger.info("Loading MERT-v1-330M...")
        from transformers import AutoModel
        model = AutoModel.from_pretrained("m-a-p/MERT-v1-330M", trust_remote_code=True)
        device = get_device()
        model = model.to(device).eval()
        _loaded["mert"] = model
        logger.info("MERT loaded on %s", device)
        return model


def unload(name: str) -> None:
    with _lock:
        if name in _loaded:
            del _loaded[name]
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
