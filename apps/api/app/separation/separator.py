"""
Stem separation abstractions.
The app works without any ML model installed (NoOpStemSeparator).
DemucsStemSeparator activates when `demucs` is on PATH.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class StemResult:
    stem_type: str        # "drums" | "bass" | "vocals" | "other"
    file_path: str
    name: str


@dataclass
class StemSeparationResult:
    success: bool
    stems: List[StemResult] = field(default_factory=list)
    error: Optional[str] = None
    separator_used: str = "none"


class StemSeparator(ABC):
    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def separate(self, input_file_path: str, output_dir: str) -> StemSeparationResult: ...


class NoOpStemSeparator(StemSeparator):
    """
    Fallback: reports unavailability without crashing the app.
    Use until Demucs or another model is installed.
    """

    def is_available(self) -> bool:
        return False

    def separate(self, input_file_path: str, output_dir: str) -> StemSeparationResult:
        return StemSeparationResult(
            success=False,
            error="No stem separator available. Install demucs (`pip install demucs`) to enable stem separation.",
            separator_used="none",
        )


class DemucsStemSeparator(StemSeparator):
    """
    Runs Demucs (htdemucs model by default) via CLI.
    Maps output: drums, bass, vocals, other -> StemResult list.
    """

    STEM_TYPES = ["drums", "bass", "vocals", "other"]

    def __init__(self, model: str = "htdemucs"):
        self.model = model

    def is_available(self) -> bool:
        return shutil.which("demucs") is not None

    def separate(self, input_file_path: str, output_dir: str) -> StemSeparationResult:
        if not self.is_available():
            return StemSeparationResult(
                success=False,
                error="demucs binary not found on PATH.",
                separator_used="demucs",
            )

        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        input_path = Path(input_file_path)

        logger.info("DemucsStemSeparator: separating %s with model %s", input_path.name, self.model)

        cmd = [
            "demucs",
            "-n", self.model,
            "--out", str(out_path),
            "--filename", "{stem}.wav",
            "-j", "2",
            str(input_path),
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired:
            return StemSeparationResult(
                success=False,
                error="Demucs timed out after 600 seconds.",
                separator_used="demucs",
            )
        except Exception as exc:
            return StemSeparationResult(
                success=False,
                error=f"Demucs process error: {exc}",
                separator_used="demucs",
            )

        if result.returncode != 0:
            logger.error("Demucs stderr: %s", result.stderr)
            return StemSeparationResult(
                success=False,
                error=f"Demucs exited with code {result.returncode}: {result.stderr[:500]}",
                separator_used="demucs",
            )

        # Demucs with --filename {stem}.wav writes to:
        #   <out_path>/<model>/<stem>.wav
        # Older defaults use <out_path>/<model>/<track_name>/<stem>.wav
        stem_dir = out_path / self.model
        track_subdirs = [d for d in stem_dir.iterdir() if d.is_dir()] if stem_dir.is_dir() else []

        def resolve_stem_file(stem_type: str) -> Optional[Path]:
            flat = stem_dir / f"{stem_type}.wav"
            if flat.exists():
                return flat
            for sub in track_subdirs:
                nested = sub / f"{stem_type}.wav"
                if nested.exists():
                    return nested
            return None

        stems: list[StemResult] = []
        for stem_type in self.STEM_TYPES:
            stem_file = resolve_stem_file(stem_type)
            if stem_file is not None:
                stems.append(
                    StemResult(
                        stem_type=stem_type,
                        file_path=str(stem_file),
                        name=f"Reference {stem_type.capitalize()}",
                    )
                )
            else:
                logger.warning("Expected stem not found for %s under %s", stem_type, stem_dir)

        if not stems:
            return StemSeparationResult(
                success=False,
                error=f"Demucs ran but produced no output in {stem_dir}",
                separator_used="demucs",
            )

        logger.info("DemucsStemSeparator: produced %d stems", len(stems))
        return StemSeparationResult(success=True, stems=stems, separator_used="demucs")


# Future: class RoFormerStemSeparator(StemSeparator): ...
# Future: class UVRStemSeparator(StemSeparator): ...


def get_separator() -> StemSeparator:
    """Return the best available separator."""
    demucs = DemucsStemSeparator()
    if demucs.is_available():
        return demucs
    return NoOpStemSeparator()
