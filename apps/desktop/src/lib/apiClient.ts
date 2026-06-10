/**
 * FastAPI analysis service client.
 * All methods call localhost:8000.
 */
import type {
  CatalogCollection,
  CatalogEntry,
  CatalogEntryStatus,
  CatalogMarker,
  CompatibilityScore,
  CreateMarkerRequest,
  ImportFolderRequest,
  MixBlueprint,
  OdeonProject,
  SelectStats,
  TrackBusGroup,
} from "@odeon/shared";

const BASE = "http://127.0.0.1:8000";

async function request<T>(
  method: string,
  path: string,
  body?: BodyInit,
  headers?: HeadersInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const apiClient = {
  health: () => request<{ status: string }>("GET", "/health"),

  createProject: (name: string, folderPath?: string) =>
    request<OdeonProject>(
      "POST",
      `/projects?name=${encodeURIComponent(name)}${folderPath ? `&folder_path=${encodeURIComponent(folderPath)}` : ""}`
    ),

  listProjects: () =>
    request<OdeonProject[]>("GET", "/projects"),

  deleteProject: (id: string) =>
    request<void>("DELETE", `/projects/${id}`),

  getProject: (id: string) =>
    request<OdeonProject>("GET", `/projects/${id}`),

  uploadReference: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<OdeonProject>("POST", `/projects/${projectId}/reference`, fd);
  },

  uploadUserStems: (projectId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return request<OdeonProject>("POST", `/projects/${projectId}/user-stems`, fd);
  },

  analyzeProject: (projectId: string) =>
    request<OdeonProject>("POST", `/projects/${projectId}/analyze`),

  analyzeTrack: (projectId: string, trackId: string) =>
    request<OdeonProject>("POST", `/projects/${projectId}/tracks/${trackId}/analyze`),

  deleteTrack: (projectId: string, trackId: string) =>
    request<OdeonProject>("DELETE", `/projects/${projectId}/tracks/${trackId}`),

  updateTrackGroups: (projectId: string, trackGroups: TrackBusGroup[]) =>
    request<OdeonProject>("PUT", `/projects/${projectId}/track-groups`, JSON.stringify({ track_groups: trackGroups }), {
      "Content-Type": "application/json",
    }),

  compareProject: (
    projectId: string,
    userTrackId?: string,
    refTrackId?: string
  ) => {
    const params = new URLSearchParams();
    if (userTrackId) params.set("user_track_id", userTrackId);
    if (refTrackId) params.set("ref_track_id", refTrackId);
    const qs = params.toString();
    return request<OdeonProject>(
      "POST",
      `/projects/${projectId}/compare${qs ? "?" + qs : ""}`
    );
  },

  exportBlueprint: (projectId: string) =>
    request<MixBlueprint>("GET", `/projects/${projectId}/export-blueprint`),

  // ── Select catalog ────────────────────────────────────────────
  select: {
    listEntries: (params?: { status?: CatalogEntryStatus; collection_id?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.collection_id) qs.set("collection_id", params.collection_id);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      if (params?.offset !== undefined) qs.set("offset", String(params.offset));
      const q = qs.toString();
      return request<CatalogEntry[]>("GET", `/select/entries${q ? "?" + q : ""}`);
    },

    getEntry: (id: string) =>
      request<CatalogEntry>("GET", `/select/entries/${id}`),

    deleteEntry: (id: string) =>
      request<{ deleted: string }>("DELETE", `/select/entries/${id}`),

    importFolder: (req: ImportFolderRequest) =>
      request<CatalogEntry[]>("POST", "/select/import", JSON.stringify(req), { "Content-Type": "application/json" }),

    analyzeEntry: (id: string) =>
      request<{ queued: string }>("POST", `/select/entries/${id}/analyze`),

    analyzeAll: () =>
      request<{ queued: number }>("POST", "/select/analyze-all"),

    updateTags: (id: string, tags: string[]) =>
      request<CatalogEntry>("PATCH", `/select/entries/${id}/tags`, JSON.stringify({ entry_id: id, tags }), { "Content-Type": "application/json" }),

    listCollections: () =>
      request<CatalogCollection[]>("GET", "/select/collections"),

    createCollection: (name: string, description?: string, entry_ids?: string[]) =>
      request<CatalogCollection>("POST", "/select/collections", JSON.stringify({ name, description, entry_ids: entry_ids ?? [] }), { "Content-Type": "application/json" }),

    deleteCollection: (id: string) =>
      request<{ deleted: string }>("DELETE", `/select/collections/${id}`),

    compatibility: (a: string, b: string) =>
      request<CompatibilityScore>("GET", `/select/compatibility?entry_id_a=${a}&entry_id_b=${b}`),

    stats: () =>
      request<SelectStats>("GET", "/select/stats"),

    listMarkers: (entryId: string) =>
      request<CatalogMarker[]>("GET", `/select/entries/${entryId}/markers`),

    createMarker: (entryId: string, req: CreateMarkerRequest) =>
      request<CatalogMarker>("POST", `/select/entries/${entryId}/markers`, JSON.stringify(req), { "Content-Type": "application/json" }),

    deleteMarker: (entryId: string, markerId: string) =>
      request<{ deleted: string }>("DELETE", `/select/entries/${entryId}/markers/${markerId}`),

    artworkUrl: (entryId: string) => `${BASE}/select/entries/${entryId}/artwork`,
    refreshMetadata: () => request<{ updated: number }>("POST", "/select/refresh-metadata"),
    rebuildWaveforms: () => request<{ rebuilt: number; total: number }>("POST", "/select/rebuild-waveforms"),
    previewUrl: (entryId: string) => `${BASE}/select/entries/${entryId}/preview`,
    stemPreviewUrl: (entryId: string, stemType: "vocals" | "drums" | "bass" | "other") =>
      `${BASE}/select/entries/${entryId}/stems/${stemType}/preview`,

    // ── Set Builder AI ──────────────────────────────────────────────
    suggestNext: (entryId: string, excludeIds: string[], limit = 8) => {
      const qs = new URLSearchParams({ entry_id: entryId, exclude_ids: excludeIds.join(","), limit: String(limit) });
      return request<SuggestResult[]>("GET", `/select/set/suggest?${qs}`);
    },

    autoOrder: (entryIds: string[]) =>
      request<string[]>("POST", "/select/set/auto-order", JSON.stringify({ entry_ids: entryIds }), { "Content-Type": "application/json" }),

    setFlow: (orderedIds: string[]) =>
      request<FlowEdge[]>("GET", `/select/set/flow?entry_ids=${orderedIds.join(",")}`),

    // ── Semantic search (Layer 2 + CLAP) ──────────────────────────
    semanticSearch: (q: string, limit = 20) =>
      request<SemanticResult[]>("GET", `/select/search?q=${encodeURIComponent(q)}&limit=${limit}`),

    searchStatus: () =>
      request<SearchStatus>("GET", "/select/search/status"),

    embedAll: () =>
      request<{ queued: number; already_embedded: number }>("POST", "/select/embed/all"),

    // ── Feature vector similarity ──────────────────────────────────
    similarTracks: (entryId: string, excludeIds: string[], limit = 10) => {
      const qs = new URLSearchParams({ exclude_ids: excludeIds.join(","), limit: String(limit) });
      return request<SimilarResult[]>("GET", `/select/entries/${entryId}/similar?${qs}`);
    },

    // ── Transition graph (Layer 3) ─────────────────────────────────
    recordTransition: (fromEntryId: string, toEntryId: string) =>
      request<{ recorded: boolean }>("POST", "/select/transitions/record",
        JSON.stringify({ from_entry_id: fromEntryId, to_entry_id: toEntryId }),
        { "Content-Type": "application/json" }),

    getTransitions: (entryId: string, excludeIds: string[], limit = 5) => {
      const qs = new URLSearchParams({ exclude_ids: excludeIds.join(","), limit: String(limit) });
      return request<TransitionResult[]>("GET", `/select/entries/${entryId}/transitions?${qs}`);
    },

    transitionStats: (entryId: string) =>
      request<TransitionStats>("GET", `/select/entries/${entryId}/transition-stats`),

    proDjStatus: () =>
      request<ProDjStatus>("GET", "/select/pro-dj/status"),

    fetch1001TL: (entryId: string) =>
      request<{ queued: boolean; track: string }>("POST", `/select/entries/${entryId}/fetch-1001tl`),

    tlFetchStatus: (entryId: string) =>
      request<TlFetchStatus>("GET", `/select/entries/${entryId}/tl-fetch-status`),

    fetch1001TLLibrary: (limit = 20) =>
      request<{ queued: number }>("POST", `/select/fetch-1001tl-library?limit=${limit}`),

    // ── ML pipeline ────────────────────────────────────────────────
    mlStatus: () =>
      request<MlServerStatus>("GET", "/select/ml/status"),

    embedRemote: (entryId: string, models = "clap,muq") =>
      request<{ entry_id: string; dims: Record<string, number>; stored: Record<string, boolean> }>(
        "POST", `/select/entries/${entryId}/embed-remote?models=${models}`),

    embedRemoteAll: (models = "clap,muq") =>
      request<{ queued: number; models: string[]; background: boolean }>(
        "POST", `/select/embed-remote-all?models=${models}`),

    analyzeMl: (entryId: string) =>
      request<{ entry_id: string; analysis: TrackAnalysisData; source: string }>(
        "POST", `/select/entries/${entryId}/analyze-ml`),

    getAnalysis: (entryId: string) =>
      request<{ entry_id: string; analysis: TrackAnalysisData; source: string; mert_features?: Record<string, unknown> }>(
        "GET", `/select/entries/${entryId}/analysis`),

    separate: (entryId: string) =>
      request<SeparateStemResult>("POST", `/select/entries/${entryId}/separate`),

    getStemJob: (entryId: string) =>
      request<StemJobData>("GET", `/select/entries/${entryId}/stem-job`),

    getStems: (entryId: string) =>
      request<StemPathsData>("GET", `/select/entries/${entryId}/stems`),

    stemsSummary: () =>
      request<{ entries: Record<string, StemSummaryEntry> }>("GET", "/select/stems/summary"),

    planTransition: (fromEntryId: string, toEntryId: string) =>
      request<TransitionPlanData>("POST", "/select/set/plan-transition",
        JSON.stringify({ from_entry_id: fromEntryId, to_entry_id: toEntryId }),
        { "Content-Type": "application/json" }),

    generateBridge: (fromEntryId: string, toEntryId: string, bars = 8) =>
      request<GenerationResultData>("POST", "/select/generate/bridge",
        JSON.stringify({ from_entry_id: fromEntryId, to_entry_id: toEntryId, bars }),
        { "Content-Type": "application/json" }),

    generateRiser: (entryId: string, bars = 4, intensity = 0.8) =>
      request<GenerationResultData>("POST", "/select/generate/riser",
        JSON.stringify({ entry_id: entryId, bars, intensity }),
        { "Content-Type": "application/json" }),

    generatedAudioUrl: (genId: string) => `${BASE}/select/generated/${genId}/audio`,
  },
};

export interface SuggestResult {
  entry_id: string;
  title: string;
  artist?: string | null;
  bpm?: number | null;
  key?: string | null;
  duration_seconds?: number | null;
  has_artwork: boolean;
  overall: number;
  bpm_delta?: number | null;
  key_compat?: number | null;
  lufs_delta?: number | null;
}

export interface FlowEdge {
  from_id: string;
  to_id: string;
  overall?: number | null;
  bpm_delta?: number | null;
  key_compat?: number | null;
  lufs_delta?: number | null;
  from_key?: string | null;
  to_key?: string | null;
  from_bpm?: number | null;
  to_bpm?: number | null;
}

export interface SemanticResult {
  entry_id: string;
  title: string;
  artist?: string | null;
  bpm?: number | null;
  key?: string | null;
  duration_seconds?: number | null;
  has_artwork: boolean;
  score: number;
  method: "clap" | "metadata";
}

export interface SimilarResult {
  entry_id: string;
  title: string;
  artist?: string | null;
  bpm?: number | null;
  key?: string | null;
  duration_seconds?: number | null;
  has_artwork: boolean;
  similarity: number;
  bpm_delta?: number | null;
}

export interface TransitionResult {
  entry_id: string | null;
  title: string;
  artist?: string | null;
  bpm?: number | null;
  key?: string | null;
  has_artwork: boolean;
  transition_count: number;
  pro_count?: number;
  user_count?: number;
  source: string;
  in_library?: boolean;
}

export interface TransitionStats {
  unique_next_tracks: number;
  total_transitions: number;
  sources: number;
  has_data: boolean;
}

export interface ProDjStatus {
  configured: boolean;
  provider: string;
  signup_url: string;
}

export interface TlFetchStatus {
  phase: "idle" | "searching" | "scanning" | "done";
  scanned?: number;
  total?: number;
  error?: "no_api_key" | "api_error" | "track_not_found" | "no_sets" | "no_matches" | "blocked" | "fetch_failed" | "disabled";
  library_matches?: number;
  pro_transitions?: number;
  tl_track?: string;
}

export interface SearchStatus {
  clap_available: boolean;
  clap_embedded_tracks: number;
  feature_embedded_tracks: number;
  active_mode: "runpod_clap" | "local_clap" | "metadata";
  install_hint: string | null;
}

export interface MlServerStatus {
  configured: boolean;
  ok?: boolean;
  gpu?: Record<string, unknown>;
  models_loaded?: string[];
  phases?: Record<string, unknown>;
  error?: string | null;
}

export interface TrackAnalysisData {
  source?: string;
  sections?: { label: string; start_seconds: number; end_seconds: number; bars: number }[];
  mix_in_safe?: boolean;
  mix_out_safe?: boolean;
  vocal_enters_seconds?: number | null;
  energy_arc?: string;
  rhythm_pattern?: string;
  mood?: string;
  transition_notes?: string;
}

export interface TransitionStepData {
  bar: number;
  action: string;
  freq_hz?: number;
  duration_bars?: number;
}

export interface TransitionPlanData {
  status: string;
  source?: string;
  mix_out_bar?: number;
  mix_in_bar?: number;
  transition_length_bars?: number;
  strategy?: string;
  steps?: TransitionStepData[];
  reason?: string;
}

export interface StemSummaryEntry {
  has_stems: boolean;
  job_status?: "queued" | "running" | "completed" | "failed" | null;
  stems?: { vocals: boolean; drums: boolean; bass: boolean; other: boolean };
  last_error?: string | null;
}

export interface StemJobData {
  entry_id: string;
  status: "queued" | "running" | "completed" | "failed";
  priority?: number;
  attempts?: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SeparateStemResult {
  queued?: string;
  job?: StemJobData;
  entry_id?: string;
  job_id?: string;
  stems?: Record<string, string>;
  error?: string;
}

export interface StemPathsData {
  entry_id: string;
  job_id?: string;
  vocals_path?: string | null;
  drums_path?: string | null;
  bass_path?: string | null;
  other_path?: string | null;
}

export interface GenerationResultData {
  status: string;
  source?: string;
  job_id?: string;
  local_path?: string;
  duration_seconds?: number;
}
