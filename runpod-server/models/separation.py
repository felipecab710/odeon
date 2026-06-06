"""
BS-RoFormer stem separation — Phase 3.
"""
from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

STEMS_DIR = Path("/workspace/stems")
STEMS_DIR.mkdir(parents=True, exist_ok=True)

_separator = None


def _load_separator():
    global _separator
    if _separator is not None:
        return _separator
    try:
        from audio_separator.separator import Separator
        sep = Separator(
            log_level=logging.WARNING,
            model_file_dir=str(STEMS_DIR / "models"),
        )
        # BS-RoFormer mini — fast, good quality
        sep.load_model("model_bs_roformer_ep_317_sdr_12.9755.ckpt")
        _separator = sep
        logger.info("BS-RoFormer separator loaded")
        return sep
    except Exception as e:
        logger.error("Failed to load separator: %s", e)
        return None


def separate(file_path: str) -> Dict[str, Any]:
    """Separate audio into vocals, drums, bass, other. Returns job_id + relative paths."""
    job_id = uuid.uuid4().hex[:12]
    out_dir = STEMS_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    sep = _load_separator()
    if sep is None:
        return {
            "status": "error",
            "message": "audio-separator not installed — pip install audio-separator",
            "job_id": job_id,
        }

    try:
        # audio-separator writes stems next to input by default; redirect via output_dir
        output_files = sep.separate(file_path)
        stems: Dict[str, Optional[str]] = {
            "vocals": None, "drums": None, "bass": None, "other": None,
        }
        for fpath in output_files or []:
            p = Path(fpath)
            name = p.stem.lower()
            dest = out_dir / p.name
            if not dest.exists():
                shutil.move(str(p), str(dest))
            for key in stems:
                if key in name:
                    stems[key] = f"{job_id}/{dest.name}"
                    break

        return {"status": "ok", "job_id": job_id, **stems}
    except Exception as e:
        logger.error("Separation failed: %s", e)
        return {"status": "error", "message": str(e), "job_id": job_id}


def is_available() -> bool:
    try:
        import audio_separator  # noqa: F401
        return True
    except ImportError:
        return False


def stem_path(relative: str) -> Optional[Path]:
    p = STEMS_DIR / relative
    return p if p.is_file() else None
