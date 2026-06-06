"""
Musical analysis — Music Flamingo when available, librosa beat-grid fallback.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """Analyze this music track and return ONLY valid JSON:
{
  "sections": [{"label": "intro|build|drop|breakdown|outro", "start_seconds": 0, "end_seconds": 32, "bars": 8}],
  "mix_in_safe": true,
  "mix_out_safe": false,
  "vocal_enters_seconds": null,
  "energy_arc": "builds|plateaus|drops",
  "rhythm_pattern": "description",
  "mood": "description",
  "transition_notes": "where and how to mix in/out"
}"""

_flamingo_model = None
_flamingo_processor = None


def _load_flamingo():
    global _flamingo_model, _flamingo_processor
    if _flamingo_model is not None:
        return _flamingo_model, _flamingo_processor
    try:
        from transformers import AutoModelForCausalLM, AutoProcessor
        model_id = "nvidia/music-flamingo-hf"
        _flamingo_processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        _flamingo_model = AutoModelForCausalLM.from_pretrained(
            model_id, trust_remote_code=True, device_map="auto",
        )
        logger.info("Music Flamingo loaded")
        return _flamingo_model, _flamingo_processor
    except Exception as e:
        logger.warning("Music Flamingo unavailable: %s", e)
        return None, None


def _parse_json(text: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    return None


def _flamingo_analyze(file_path: str) -> Optional[Dict[str, Any]]:
    model, processor = _load_flamingo()
    if model is None:
        return None
    try:
        import librosa
        audio, sr = librosa.load(file_path, sr=16000, mono=True, duration=120)
        inputs = processor(text=ANALYSIS_PROMPT, audio=audio, sampling_rate=sr, return_tensors="pt")
        inputs = {k: v.to(model.device) for k, v in inputs.items()}
        out = model.generate(**inputs, max_new_tokens=512)
        text = processor.decode(out[0], skip_special_tokens=True)
        parsed = _parse_json(text)
        if parsed:
            parsed["source"] = "music_flamingo"
            return parsed
    except Exception as e:
        logger.error("Flamingo inference failed: %s", e)
    return None


def _librosa_analyze(file_path: str) -> Dict[str, Any]:
    """Beat-grid + energy heuristic — always available."""
    import librosa

    y, sr = librosa.load(file_path, sr=22050, mono=True)
    duration = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    bpm = float(tempo) if hasattr(tempo, "__float__") else float(tempo[0])

    # Energy curve in 16 segments
    n_seg = 16
    seg_len = max(1, len(y) // n_seg)
    energies = [float(np.sqrt(np.mean(y[i * seg_len:(i + 1) * seg_len] ** 2))) for i in range(n_seg)]
    peak_idx = int(np.argmax(energies))
    energy_arc = "builds" if peak_idx > n_seg // 3 else "plateaus"

    labels = ["intro", "build", "drop", "breakdown", "drop", "bridge", "outro"]
    sections: List[Dict[str, Any]] = []
    beats_per_bar = 4
    for i, label in enumerate(labels):
        start_pct = i / len(labels)
        end_pct = (i + 1) / len(labels)
        start_s = start_pct * duration
        end_s = end_pct * duration
        bars = max(1, int((end_s - start_s) * bpm / 60 / beats_per_bar))
        sections.append({
            "label": label,
            "start_seconds": round(start_s, 2),
            "end_seconds": round(end_s, 2),
            "bars": bars,
        })

    # Vocal proxy: spectral centroid spike mid-track
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    vocal_enters = float(np.argmax(cent) / len(cent) * duration * 0.4)

    return {
        "source": "librosa_heuristic",
        "bpm": round(bpm, 1),
        "beat_times": beat_times[:200],
        "sections": sections,
        "mix_in_safe": True,
        "mix_out_safe": peak_idx >= n_seg - 3,
        "vocal_enters_seconds": round(vocal_enters, 1),
        "energy_arc": energy_arc,
        "rhythm_pattern": "4-on-floor" if bpm >= 118 and bpm <= 140 else "varied",
        "mood": "energetic" if peak_idx < n_seg * 0.6 else "atmospheric",
        "transition_notes": f"Mix out during breakdown (~{round(duration * 0.75)}s). Clean intro first {round(duration * 0.08)}s.",
    }


def is_available() -> bool:
    return True  # librosa heuristic always available


def analyze(file_path: str) -> Dict[str, Any]:
    result = _flamingo_analyze(file_path)
    if result:
        return {"status": "ok", "analysis": result}
    analysis = _librosa_analyze(file_path)
    return {"status": "ok", "analysis": analysis, "fallback": True}
