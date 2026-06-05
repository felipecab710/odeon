"""
Odeon Pydantic models — mirror of packages/shared TypeScript types.
Field names are kept identical so serialized JSON matches across the stack.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────
#  Enums
# ─────────────────────────────────────────────

class TrackRole(str, Enum):
    reference_full_mix = "reference_full_mix"
    reference_stem = "reference_stem"
    user_stem = "user_stem"
    analysis = "analysis"


class StemType(str, Enum):
    full_mix = "full_mix"
    drums = "drums"
    bass = "bass"
    vocals = "vocals"
    music = "music"
    other = "other"
    fx = "fx"
    unknown = "unknown"


class AnalysisStatus(str, Enum):
    pending = "pending"
    analyzing = "analyzing"
    complete = "complete"
    failed = "failed"
    skipped = "skipped"


class ProjectStatus(str, Enum):
    empty = "empty"
    reference_uploaded = "reference_uploaded"
    stems_separated = "stems_separated"
    user_stems_imported = "user_stems_imported"
    analyzed = "analyzed"
    compared = "compared"
    ready = "ready"


class MixMoveCategory(str, Enum):
    level = "level"
    pan = "pan"
    eq = "eq"
    compression = "compression"
    reverb = "reverb"
    stereo = "stereo"
    arrangement = "arrangement"


class MixMoveStatus(str, Enum):
    suggested = "suggested"
    accepted = "accepted"
    ignored = "ignored"


# ─────────────────────────────────────────────
#  Analysis Sub-Models
# ─────────────────────────────────────────────

class FrequencyProfile(BaseModel):
    sub_20_60: float
    bass_60_160: float
    low_mid_160_500: float
    mid_500_2000: float
    presence_2000_5000: float
    brightness_5000_10000: float
    air_10000_18000: float


class StereoProfile(BaseModel):
    left_rms: float
    right_rms: float
    mid_energy: float
    side_energy: float
    side_to_mid_ratio: float
    phase_correlation: float
    pan_proxy: float      # -1.0 (full left) .. 1.0 (full right)
    width_proxy: float    # 0.0 (mono) .. 1.0+ (wide)


class SectionEnergy(BaseModel):
    label: str
    start_seconds: float
    end_seconds: float
    rms_db: float


class TrackAnalysis(BaseModel):
    duration_seconds: float
    sample_rate: int
    channels: int
    integrated_lufs: float
    true_peak_db: float
    rms_db: float
    peak_db: float
    crest_factor_db: float
    frequency_profile: Optional[FrequencyProfile] = None
    stereo_profile: Optional[StereoProfile] = None
    tempo: Optional[float] = None
    section_energy: Optional[List[SectionEnergy]] = None
    warnings: List[str] = Field(default_factory=list)
    # Waveform display data — downsampled peak + RMS envelopes (~4096 points each)
    waveform_peaks: Optional[List[float]] = None   # mono summary (back-compat)
    waveform_rms: Optional[List[float]] = None
    waveform_peaks_l: Optional[List[float]] = None  # Pro Tools stereo L peak
    waveform_peaks_r: Optional[List[float]] = None  # Pro Tools stereo R peak
    waveform_rms_l: Optional[List[float]] = None
    waveform_rms_r: Optional[List[float]] = None
    waveform_cache_path: Optional[str] = None  # sidecar .odeon.wavecache


# ─────────────────────────────────────────────
#  MixMove
# ─────────────────────────────────────────────

class MixMoveEvidence(BaseModel):
    band: Optional[str] = None
    user_db: Optional[float] = None
    reference_db: Optional[float] = None
    delta_db: Optional[float] = None
    user_value: Optional[float] = None
    reference_value: Optional[float] = None
    delta: Optional[float] = None
    description: Optional[str] = None


class DawReadyParameters(BaseModel):
    processor: str
    type: Optional[str] = None
    frequency_hz: Optional[float] = None
    gain_db: Optional[float] = None
    q: Optional[float] = None
    ratio: Optional[float] = None
    threshold_db: Optional[float] = None
    attack_ms: Optional[float] = None
    release_ms: Optional[float] = None
    width_factor: Optional[float] = None
    pan: Optional[float] = None
    extra: Optional[Dict[str, Any]] = None


class MixMove(BaseModel):
    id: str
    target_track_id: str
    reference_track_id: str
    category: MixMoveCategory
    observation: str
    suggested_action: str
    confidence: float
    evidence: MixMoveEvidence
    daw_ready_parameters: DawReadyParameters
    status: MixMoveStatus = MixMoveStatus.suggested


# ─────────────────────────────────────────────
#  Track + Project
# ─────────────────────────────────────────────

class OdeonTrack(BaseModel):
    id: str
    project_id: str
    name: str
    role: TrackRole
    stem_type: StemType
    file_path: str
    color: str = "#4A90D9"
    muted: bool = False
    soloed: bool = False
    volume_db: float = 0.0
    pan: float = 0.0
    clip_start_seconds: float = 0.0
    analysis_status: AnalysisStatus = AnalysisStatus.pending
    analysis: Optional[TrackAnalysis] = None


class TrackGroupSharing(BaseModel):
    gain: bool = True
    gain_relative: bool = True
    muting: bool = True
    soloing: bool = True
    record_enable: bool = True
    selection: bool = True
    active_state: bool = True
    color: bool = True
    monitoring: bool = True


class TrackBusGroup(BaseModel):
    id: str
    name: str
    color: str
    active: bool = True
    track_ids: List[str] = Field(default_factory=list)
    sharing: TrackGroupSharing = Field(default_factory=TrackGroupSharing)


class TrackGroupsUpdate(BaseModel):
    track_groups: List[TrackBusGroup]


class OdeonProject(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    bpm: Optional[float] = None
    sample_rate: int = 44100
    status: ProjectStatus = ProjectStatus.empty
    reference_track_id: Optional[str] = None
    tracks: List[OdeonTrack] = Field(default_factory=list)
    mix_moves: List[MixMove] = Field(default_factory=list)
    track_groups: List[TrackBusGroup] = Field(default_factory=list)
    report_path: Optional[str] = None
    folder_path: Optional[str] = None   # absolute path to the project folder on disk


# ─────────────────────────────────────────────
#  Mix Blueprint
# ─────────────────────────────────────────────

class BlueprintProjectSummary(BaseModel):
    id: str
    name: str
    bpm: Optional[float]
    sample_rate: int


class BlueprintTrackSummary(BaseModel):
    id: str
    name: str
    stem_type: StemType
    analysis: Optional[TrackAnalysis]


class MixBlueprint(BaseModel):
    schema_version: str = "1.0"
    exported_at: str
    project: BlueprintProjectSummary
    reference_track: Optional[BlueprintTrackSummary]
    user_tracks: List[BlueprintTrackSummary]
    mix_moves: List[MixMove]
    product_note: str = (
        "Odeon estimates plausible mix characteristics and produces "
        "human-editable DAW-ready guidance. It does not recover exact "
        "plugin settings or claim to know the original engineer's chain."
    )
