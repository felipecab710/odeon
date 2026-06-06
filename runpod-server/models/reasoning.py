"""
Transition reasoning — MOSS-Audio-8B when available, rule-based fallback from analysis JSON.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_moss_model = None
_moss_tokenizer = None


def _load_moss():
    global _moss_model, _moss_tokenizer
    if _moss_model is not None:
        return _moss_model, _moss_tokenizer
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        model_id = "OpenMOSS-Team/MOSS-Audio-8B-Thinking"
        _moss_tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
        _moss_model = AutoModelForCausalLM.from_pretrained(
            model_id, trust_remote_code=True, device_map="auto", torch_dtype="auto",
        )
        logger.info("MOSS-Audio-8B loaded")
        return _moss_model, _moss_tokenizer
    except Exception as e:
        logger.warning("MOSS unavailable: %s", e)
        return None, None


def _bar_at_seconds(seconds: float, bpm: float, beats_per_bar: int = 4) -> int:
    if bpm <= 0:
        return 0
    beats = seconds * bpm / 60
    return int(beats / beats_per_bar)


def _rule_based_plan(
    analysis_a: Dict[str, Any],
    analysis_b: Dict[str, Any],
    context: Dict[str, Any],
) -> Dict[str, Any]:
    bpm_a = context.get("bpm_a") or analysis_a.get("bpm") or 128
    bpm_b = context.get("bpm_b") or analysis_b.get("bpm") or 128
    duration_a = context.get("duration_a") or 300

    # Mix-out: prefer outro/breakdown on A
    mix_out_s = duration_a * 0.75
    for sec in reversed(analysis_a.get("sections") or []):
        if sec.get("label") in ("outro", "breakdown", "bridge"):
            mix_out_s = sec.get("start_seconds", mix_out_s)
            break

    # Mix-in: prefer intro/build on B
    mix_in_s = 0.0
    for sec in analysis_b.get("sections") or []:
        if sec.get("label") in ("intro", "build"):
            mix_in_s = sec.get("start_seconds", 0)
            break

    mix_out_bar = _bar_at_seconds(mix_out_s, bpm_a)
    mix_in_bar = _bar_at_seconds(mix_in_s, bpm_b)
    transition_bars = 16 if abs(bpm_a - bpm_b) <= 4 else 32

    vocal_a = analysis_a.get("vocal_enters_seconds")
    reason_parts = [
        f"Mix out of A around bar {mix_out_bar}",
        f"Bring in B from bar {mix_in_bar}",
    ]
    if vocal_a:
        reason_parts.append(f"A vocals from {vocal_a}s — avoid overlapping")

    steps: List[Dict[str, Any]] = [
        {"bar": mix_out_bar, "action": "apply_high_pass_on_A", "freq_hz": 400},
        {"bar": mix_out_bar + 4, "action": "fade_in_B", "duration_bars": 8},
        {"bar": mix_out_bar + 8, "action": "bass_swap_A_to_B"},
        {"bar": mix_out_bar + transition_bars - 4, "action": "remove_A_fully"},
    ]

    return {
        "status": "ok",
        "source": "rule_based",
        "mix_out_bar": mix_out_bar,
        "mix_in_bar": mix_in_bar,
        "transition_length_bars": transition_bars,
        "strategy": "high_pass_then_bass_swap",
        "steps": steps,
        "reason": ". ".join(reason_parts),
        "bpm_a": bpm_a,
        "bpm_b": bpm_b,
    }


def _moss_plan(context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    model, tokenizer = _load_moss()
    if model is None:
        return None
    try:
        prompt = (
            "You are a professional DJ. Given track A and B analysis JSON, "
            "return ONLY a JSON transition plan with mix_out_bar, mix_in_bar, "
            "transition_length_bars, strategy, steps[], reason.\n"
            f"context: {json.dumps(context)}"
        )
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        out = model.generate(**inputs, max_new_tokens=512)
        text = tokenizer.decode(out[0], skip_special_tokens=True)
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            plan = json.loads(m.group())
            plan["status"] = "ok"
            plan["source"] = "moss"
            return plan
    except Exception as e:
        logger.error("MOSS reasoning failed: %s", e)
    return None


def is_available() -> bool:
    return True  # rule-based fallback always available


def plan_transition(
    audio_a_path: str,
    audio_b_path: str,
    context: Dict[str, Any],
) -> Dict[str, Any]:
    analysis_a = context.get("analysis_a")
    analysis_b = context.get("analysis_b")

    if analysis_a and analysis_b:
        moss = _moss_plan(context)
        if moss:
            return moss
        return _rule_based_plan(analysis_a, analysis_b, context)

    return {
        "status": "error",
        "message": "Provide analysis_a and analysis_b in context",
    }
