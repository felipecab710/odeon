"""
Select catalog models — mirror of packages/shared/src/select-types.ts.
"""
from __future__ import annotations

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class CatalogEntryStatus(str, Enum):
    pending   = "pending"
    analyzing = "analyzing"
    ready     = "ready"
    error     = "error"


class MarkerType(str, Enum):
    hot_cue = "hot_cue"
    memory  = "memory"
    cue     = "cue"
    loop    = "loop"


class CatalogMarker(BaseModel):
    id:                str
    entry_id:          str
    type:              MarkerType = MarkerType.cue
    time_seconds:      float
    end_time_seconds:  Optional[float] = None  # loops only
    label:             Optional[str]   = None
    color:             str = "#ff6b35"
    created_at:        Optional[str]   = None


class CreateMarkerRequest(BaseModel):
    type:             MarkerType = MarkerType.cue
    time_seconds:     float
    end_time_seconds: Optional[float] = None
    label:            Optional[str]   = None
    color:            str = "#ff6b35"


class CatalogEntry(BaseModel):
    id:                   str
    file_path:            str
    file_name:            str
    # ID3 / tag metadata (populated on import via mutagen)
    title:                Optional[str]     = None
    artist:               Optional[str]     = None
    album:                Optional[str]     = None
    has_artwork:          bool              = False
    # Analysis results
    duration_seconds:     Optional[float]   = None
    sample_rate:          Optional[int]     = None
    channels:             Optional[int]     = None
    bpm:                  Optional[float]   = None
    key:                  Optional[str]     = None
    integrated_lufs:      Optional[float]   = None
    true_peak_db:         Optional[float]   = None
    rms_db:               Optional[float]   = None
    waveform_cache_path:  Optional[str]     = None
    beat_times:           Optional[List[float]] = None
    tags:                 List[str]         = Field(default_factory=list)
    collection_ids:       List[str]         = Field(default_factory=list)
    status:               CatalogEntryStatus = CatalogEntryStatus.pending
    added_at:             Optional[str]     = None
    error_message:        Optional[str]     = None


class CatalogCollection(BaseModel):
    id:          str
    name:        str
    description: Optional[str] = None
    entry_ids:   List[str]     = Field(default_factory=list)
    created_at:  Optional[str] = None


class ImportFolderRequest(BaseModel):
    folder_path:     str
    recursive:       bool = True
    extensions:      List[str] = Field(default=["wav", "flac", "aiff", "mp3", "m4a"])
    collection_name: Optional[str] = None


class AnalyzeEntryRequest(BaseModel):
    entry_id: str


class UpdateTagsRequest(BaseModel):
    entry_id: str
    tags:     List[str]


class CreateCollectionRequest(BaseModel):
    name:        str
    description: Optional[str] = None
    entry_ids:   List[str] = Field(default_factory=list)


class CompatibilityScore(BaseModel):
    entry_id_a: str
    entry_id_b: str
    bpm_delta:  Optional[float] = None
    key_compat: Optional[float] = None   # 0..1 Camelot wheel compatibility
    lufs_delta: Optional[float] = None
    overall:    Optional[float] = None   # 0..1


class SelectStats(BaseModel):
    total_entries:    int
    ready_entries:    int
    total_duration_s: float
    collections:      int
