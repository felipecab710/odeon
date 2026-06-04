"""
Track comparison and MixMove generation.

Rules (from spec):
  Level  : delta > 2 dB -> suggest gain adjustment
  EQ     : per-band delta > 2 dB -> suggest EQ move with band->processor mapping
  Stereo : width delta > threshold -> suggest width adjustment; warn if low-end wide
  Pan    : pan_proxy delta -> suggest pan movement
  Comp   : crest factor delta -> suggest compression/decompression
  Reverb : placeholder for v1

Every MixMove must carry evidence and confidence. No fake precision.
"""
from __future__ import annotations

import uuid
from typing import Optional

from ..models import (
    DawReadyParameters,
    MixMove,
    MixMoveCategory,
    MixMoveEvidence,
    MixMoveStatus,
    OdeonTrack,
    TrackAnalysis,
)


# ─────────────────────────────────────────────
#  Track delta struct
# ─────────────────────────────────────────────

def compare_tracks(ref: TrackAnalysis, user: TrackAnalysis) -> dict:
    """Return a delta dict comparing user against reference analysis."""
    deltas: dict = {}

    deltas["lufs_delta"] = user.integrated_lufs - ref.integrated_lufs
    deltas["rms_delta"] = user.rms_db - ref.rms_db
    deltas["crest_delta"] = user.crest_factor_db - ref.crest_factor_db
    deltas["true_peak_delta"] = user.true_peak_db - ref.true_peak_db

    if ref.frequency_profile and user.frequency_profile:
        rf = ref.frequency_profile
        uf = user.frequency_profile
        deltas["freq_deltas"] = {
            "sub_20_60": uf.sub_20_60 - rf.sub_20_60,
            "bass_60_160": uf.bass_60_160 - rf.bass_60_160,
            "low_mid_160_500": uf.low_mid_160_500 - rf.low_mid_160_500,
            "mid_500_2000": uf.mid_500_2000 - rf.mid_500_2000,
            "presence_2000_5000": uf.presence_2000_5000 - rf.presence_2000_5000,
            "brightness_5000_10000": uf.brightness_5000_10000 - rf.brightness_5000_10000,
            "air_10000_18000": uf.air_10000_18000 - rf.air_10000_18000,
        }
    else:
        deltas["freq_deltas"] = {}

    if ref.stereo_profile and user.stereo_profile:
        deltas["width_delta"] = user.stereo_profile.width_proxy - ref.stereo_profile.width_proxy
        deltas["pan_delta"] = user.stereo_profile.pan_proxy - ref.stereo_profile.pan_proxy
        deltas["user_width"] = user.stereo_profile.width_proxy
        deltas["ref_width"] = ref.stereo_profile.width_proxy
        deltas["user_pan"] = user.stereo_profile.pan_proxy
        deltas["ref_pan"] = ref.stereo_profile.pan_proxy
        deltas["user_sub"] = user.frequency_profile.sub_20_60 if user.frequency_profile else -120.0
    else:
        deltas["width_delta"] = None
        deltas["pan_delta"] = None

    return deltas


# ─────────────────────────────────────────────
#  Band -> EQ processor mapping
# ─────────────────────────────────────────────

_BAND_EQ: dict = {
    "sub_20_60": {"proc": "parametric_eq", "type": "low_shelf", "freq": 40.0, "q": 0.7},
    "bass_60_160": {"proc": "parametric_eq", "type": "bell", "freq": 100.0, "q": 1.2},
    "low_mid_160_500": {"proc": "parametric_eq", "type": "bell", "freq": 320.0, "q": 1.1},
    "mid_500_2000": {"proc": "parametric_eq", "type": "bell", "freq": 1000.0, "q": 1.0},
    "presence_2000_5000": {"proc": "parametric_eq", "type": "bell", "freq": 3000.0, "q": 1.2},
    "brightness_5000_10000": {"proc": "parametric_eq", "type": "high_shelf", "freq": 7500.0, "q": 0.7},
    "air_10000_18000": {"proc": "parametric_eq", "type": "high_shelf", "freq": 12000.0, "q": 0.7},
}

_BAND_LABELS: dict = {
    "sub_20_60": "sub (20–60 Hz)",
    "bass_60_160": "bass (60–160 Hz)",
    "low_mid_160_500": "low-mid (160–500 Hz)",
    "mid_500_2000": "mid (500–2000 Hz)",
    "presence_2000_5000": "presence (2–5 kHz)",
    "brightness_5000_10000": "brightness (5–10 kHz)",
    "air_10000_18000": "air (10–18 kHz)",
}


def _id() -> str:
    return str(uuid.uuid4())


# ─────────────────────────────────────────────
#  MixMove generators
# ─────────────────────────────────────────────

def _level_move(
    user_track_id: str,
    ref_track_id: str,
    lufs_delta: float,
    user_lufs: float,
    ref_lufs: float,
) -> Optional[MixMove]:
    if abs(lufs_delta) < 2.0:
        return None
    direction = "louder" if lufs_delta > 0 else "quieter"
    gain_suggestion = round(-lufs_delta * 0.8, 1)  # conservative 80% of delta
    confidence = min(0.9, 0.5 + abs(lufs_delta) / 20.0)
    return MixMove(
        id=_id(),
        target_track_id=user_track_id,
        reference_track_id=ref_track_id,
        category=MixMoveCategory.level,
        observation=(
            f"Your stem is {abs(lufs_delta):.1f} LUFS {direction} than the reference "
            f"(user: {user_lufs:.1f} LUFS, reference: {ref_lufs:.1f} LUFS)."
        ),
        suggested_action=(
            f"Apply a gain of {gain_suggestion:+.1f} dB to bring the level closer to the reference."
        ),
        confidence=round(confidence, 2),
        evidence=MixMoveEvidence(
            user_db=round(user_lufs, 2),
            reference_db=round(ref_lufs, 2),
            delta_db=round(lufs_delta, 2),
        ),
        daw_ready_parameters=DawReadyParameters(
            processor="gain",
            gain_db=round(gain_suggestion, 2),
        ),
        status=MixMoveStatus.suggested,
    )


def _eq_move(
    user_track_id: str,
    ref_track_id: str,
    band: str,
    delta: float,
    user_db: float,
    ref_db: float,
) -> Optional[MixMove]:
    if abs(delta) < 2.0:
        return None
    eq = _BAND_EQ[band]
    label = _BAND_LABELS[band]
    direction = "more" if delta > 0 else "less"
    gain_suggestion = round(-delta * 0.7, 1)
    confidence = min(0.85, 0.45 + abs(delta) / 18.0)
    return MixMove(
        id=_id(),
        target_track_id=user_track_id,
        reference_track_id=ref_track_id,
        category=MixMoveCategory.eq,
        observation=(
            f"Your stem has {abs(delta):.1f} dB {direction} energy in the {label} band "
            f"than the reference (user: {user_db:.1f} dB, reference: {ref_db:.1f} dB)."
        ),
        suggested_action=(
            f"Apply a {eq['type'].replace('_', ' ')} EQ around {eq['freq']:.0f} Hz "
            f"with {gain_suggestion:+.1f} dB gain, Q ≈ {eq['q']}."
        ),
        confidence=round(confidence, 2),
        evidence=MixMoveEvidence(
            band=band,
            user_db=round(user_db, 2),
            reference_db=round(ref_db, 2),
            delta_db=round(delta, 2),
        ),
        daw_ready_parameters=DawReadyParameters(
            processor=eq["proc"],
            type=eq["type"],
            frequency_hz=float(eq["freq"]),
            gain_db=round(gain_suggestion, 2),
            q=float(eq["q"]),
        ),
        status=MixMoveStatus.suggested,
    )


def _stereo_move(
    user_track_id: str,
    ref_track_id: str,
    width_delta: float,
    user_width: float,
    ref_width: float,
    user_sub_db: float,
) -> list[MixMove]:
    moves: list[MixMove] = []

    if abs(width_delta) >= 0.15:
        direction = "wider" if width_delta > 0 else "narrower"
        factor = round(ref_width / user_width, 2) if user_width > 0.01 else 1.0
        confidence = min(0.80, 0.40 + abs(width_delta) / 2.0)
        moves.append(
            MixMove(
                id=_id(),
                target_track_id=user_track_id,
                reference_track_id=ref_track_id,
                category=MixMoveCategory.stereo,
                observation=(
                    f"Your stem is {direction} than the reference "
                    f"(user width proxy: {user_width:.2f}, reference: {ref_width:.2f})."
                ),
                suggested_action=(
                    f"Adjust stereo width by a factor of approximately {factor:.2f} "
                    f"to match the reference image."
                ),
                confidence=round(confidence, 2),
                evidence=MixMoveEvidence(
                    user_value=round(user_width, 3),
                    reference_value=round(ref_width, 3),
                    delta=round(width_delta, 3),
                ),
                daw_ready_parameters=DawReadyParameters(
                    processor="stereo_width",
                    width_factor=round(factor, 3),
                ),
                status=MixMoveStatus.suggested,
            )
        )

    # Warn about wide sub-bass
    if user_sub_db > -40 and user_width > 0.3:
        moves.append(
            MixMove(
                id=_id(),
                target_track_id=user_track_id,
                reference_track_id=ref_track_id,
                category=MixMoveCategory.stereo,
                observation=(
                    "Your stem has significant energy in the sub-bass range with a wide stereo image. "
                    "Wide low frequencies can cause phase cancellation on mono systems."
                ),
                suggested_action=(
                    "Consider high-passing the side channel below 80 Hz or using a "
                    "multiband stereo tool to mono frequencies below 100 Hz."
                ),
                confidence=0.75,
                evidence=MixMoveEvidence(
                    description="Wide sub-bass detected",
                    user_value=round(user_sub_db, 2),
                    user_db=round(user_sub_db, 2),
                ),
                daw_ready_parameters=DawReadyParameters(
                    processor="stereo_width",
                    type="mono_low",
                    frequency_hz=80.0,
                    width_factor=0.0,
                ),
                status=MixMoveStatus.suggested,
            )
        )

    return moves


def _pan_move(
    user_track_id: str,
    ref_track_id: str,
    pan_delta: float,
    user_pan: float,
    ref_pan: float,
) -> Optional[MixMove]:
    if abs(pan_delta) < 0.08:
        return None
    direction = "right" if pan_delta > 0 else "left"
    pan_suggestion = round(ref_pan, 2)
    confidence = min(0.70, 0.35 + abs(pan_delta) / 2.0)
    return MixMove(
        id=_id(),
        target_track_id=user_track_id,
        reference_track_id=ref_track_id,
        category=MixMoveCategory.pan,
        observation=(
            f"Your stem is panned more to the {direction} relative to the reference "
            f"(user pan proxy: {user_pan:+.2f}, reference: {ref_pan:+.2f})."
        ),
        suggested_action=(
            f"Move the pan position toward {pan_suggestion:+.2f} to match the reference."
        ),
        confidence=round(confidence, 2),
        evidence=MixMoveEvidence(
            user_value=round(user_pan, 3),
            reference_value=round(ref_pan, 3),
            delta=round(pan_delta, 3),
        ),
        daw_ready_parameters=DawReadyParameters(
            processor="pan",
            pan=float(pan_suggestion),
        ),
        status=MixMoveStatus.suggested,
    )


def _compression_move(
    user_track_id: str,
    ref_track_id: str,
    crest_delta: float,
    user_crest: float,
    ref_crest: float,
) -> Optional[MixMove]:
    if abs(crest_delta) < 2.0:
        return None

    if crest_delta > 0:
        # user more dynamic than reference -> suggest more compression
        observation = (
            f"Your stem is more dynamic than the reference "
            f"(crest factor: user {user_crest:.1f} dB, reference {ref_crest:.1f} dB). "
            f"A higher crest factor indicates less compression."
        )
        action = (
            f"Consider adding approximately {abs(crest_delta):.1f} dB more compression "
            f"(try ratio 3:1–4:1, medium attack 20–40 ms, auto release)."
        )
        confidence = min(0.72, 0.40 + crest_delta / 20.0)
        daw_params = DawReadyParameters(
            processor="compressor",
            ratio=3.5,
            attack_ms=25.0,
            release_ms=120.0,
        )
    else:
        # user more compressed than reference -> warn
        observation = (
            f"Your stem appears more compressed than the reference "
            f"(crest factor: user {user_crest:.1f} dB, reference {ref_crest:.1f} dB). "
            f"Over-compression reduces transient punch."
        )
        action = (
            "Consider reducing compression (lower ratio or raise threshold) "
            "to restore transient dynamics closer to the reference."
        )
        confidence = 0.60
        daw_params = DawReadyParameters(
            processor="compressor",
            type="reduce",
            ratio=2.0,
        )

    return MixMove(
        id=_id(),
        target_track_id=user_track_id,
        reference_track_id=ref_track_id,
        category=MixMoveCategory.compression,
        observation=observation,
        suggested_action=action,
        confidence=round(confidence, 2),
        evidence=MixMoveEvidence(
            user_value=round(user_crest, 2),
            reference_value=round(ref_crest, 2),
            delta=round(crest_delta, 2),
        ),
        daw_ready_parameters=daw_params,
        status=MixMoveStatus.suggested,
    )


def _reverb_placeholder(
    user_track_id: str,
    ref_track_id: str,
) -> MixMove:
    return MixMove(
        id=_id(),
        target_track_id=user_track_id,
        reference_track_id=ref_track_id,
        category=MixMoveCategory.reverb,
        observation=(
            "Space and reverb analysis is not yet available in this version of Odeon."
        ),
        suggested_action=(
            "Reverb/space estimation coming in a future release. "
            "Compare reverb tails manually by listening to both stems."
        ),
        confidence=0.0,
        evidence=MixMoveEvidence(description="reverb analysis placeholder"),
        daw_ready_parameters=DawReadyParameters(processor="reverb", type="placeholder"),
        status=MixMoveStatus.suggested,
    )


# ─────────────────────────────────────────────
#  Main entry point
# ─────────────────────────────────────────────

def generate_mix_moves(
    ref_track: OdeonTrack,
    user_track: OdeonTrack,
) -> list[MixMove]:
    """
    Compare user_track against ref_track and generate editable MixMoves.
    Both tracks must have analysis populated.
    """
    ref_a = ref_track.analysis
    user_a = user_track.analysis
    if ref_a is None or user_a is None:
        return []

    deltas = compare_tracks(ref_a, user_a)
    moves: list[MixMove] = []

    # Level
    level = _level_move(
        user_track.id,
        ref_track.id,
        lufs_delta=deltas["lufs_delta"],
        user_lufs=user_a.integrated_lufs,
        ref_lufs=ref_a.integrated_lufs,
    )
    if level:
        moves.append(level)

    # EQ — per band
    for band, delta in deltas.get("freq_deltas", {}).items():
        if ref_a.frequency_profile and user_a.frequency_profile:
            user_db = getattr(user_a.frequency_profile, band)
            ref_db = getattr(ref_a.frequency_profile, band)
            eq = _eq_move(user_track.id, ref_track.id, band, delta, user_db, ref_db)
            if eq:
                moves.append(eq)

    # Stereo
    if deltas.get("width_delta") is not None:
        stereo_moves = _stereo_move(
            user_track.id,
            ref_track.id,
            width_delta=deltas["width_delta"],
            user_width=deltas["user_width"],
            ref_width=deltas["ref_width"],
            user_sub_db=deltas.get("user_sub", -120.0),
        )
        moves.extend(stereo_moves)

    # Pan
    if deltas.get("pan_delta") is not None:
        pan = _pan_move(
            user_track.id,
            ref_track.id,
            pan_delta=deltas["pan_delta"],
            user_pan=deltas["user_pan"],
            ref_pan=deltas["ref_pan"],
        )
        if pan:
            moves.append(pan)

    # Compression
    comp = _compression_move(
        user_track.id,
        ref_track.id,
        crest_delta=deltas["crest_delta"],
        user_crest=user_a.crest_factor_db,
        ref_crest=ref_a.crest_factor_db,
    )
    if comp:
        moves.append(comp)

    # Reverb placeholder
    moves.append(_reverb_placeholder(user_track.id, ref_track.id))

    return moves
