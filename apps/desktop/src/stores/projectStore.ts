/**
 * Project store — owns the OdeonProject state and API interactions.
 */
import { create } from "zustand";
import type { OdeonProject } from "@odeon/shared";
import { apiClient } from "../lib/apiClient";
import { trackGroupsFromApi, trackGroupsToApi } from "../lib/trackGroupSync";
import { useSelectionStore } from "./selectionStore";
import { useTimelineStore } from "./timelineStore";
import { useEngineStore } from "./engineStore";
import { useTrackGroupStore } from "./trackGroupStore";
import { engineClient } from "../lib/engineClient";
import { invalidateWaveformBitmap } from "../lib/waveformEngine";
import { ensureReferenceStemBusGroup } from "../lib/referenceStemGroup";

export interface PendingTrack {
  id: string;
  fileName: string;
  role: "reference" | "user";
  status: "uploading" | "analyzing" | "done";
  operation: string;   // human-readable current step
}

interface ProjectState {
  project: OdeonProject | null;
  isLoading: boolean;
  loadingLabel: string | null;
  pendingTracks: PendingTrack[];
  error: string | null;

  // Actions
  createProject: (name?: string) => Promise<void>;
  uploadReference: (file: File) => Promise<void>;
  uploadUserStems: (files: File[]) => Promise<void>;
  analyzeProject: () => Promise<void>;
  analyzeTrack: (trackId: string, opts?: { manageLoading?: boolean }) => Promise<void>;
  compareProject: (userTrackId?: string, refTrackId?: string) => Promise<void>;
  exportBlueprint: () => Promise<void>;
  setProject: (p: OdeonProject) => void;
  saveTrackGroups: () => Promise<void>;
  setClipStart: (trackId: string, seconds: number) => void;
  setTrackColor: (trackId: string, color: string) => void;
  deleteTrack: (trackId: string) => Promise<void>;
  clearError: () => void;
}

let referenceUploadInFlight = false;

function normalizeProject(p: OdeonProject): OdeonProject {
  return { ...p, track_groups: p.track_groups ?? [] };
}

function syncTrackGroupsFromProject(p: OdeonProject) {
  const normalized = normalizeProject(p);
  const validIds = new Set(normalized.tracks.map((t) => t.id));
  useTrackGroupStore.getState().hydrateFromProject(
    trackGroupsFromApi(normalized.track_groups, validIds),
  );
  return normalized;
}

function applyAnalyzedProject(p: OdeonProject, analyzedTrackId?: string) {
  const normalized = syncTrackGroupsFromProject(p);
  const stemTracks = normalized.tracks.filter((t) => t.role === "reference_stem");
  if (stemTracks.length > 0) {
    ensureReferenceStemBusGroup(stemTracks);
  } else if (analyzedTrackId) {
    const analyzed = normalized.tracks.find((t) => t.id === analyzedTrackId);
    if (
      analyzed?.role === "reference_full_mix" &&
      normalized.status !== "stems_separated"
    ) {
      return {
        project: normalized,
        error: "Stem separation did not produce tracks. Ensure Demucs is installed and try Analyze + Stems again.",
      };
    }
  }
  return { project: normalized, error: null as string | null };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isLoading: false,
  loadingLabel: null,
  pendingTracks: [],
  error: null,

  setProject: (p) => set({ project: syncTrackGroupsFromProject(p) }),

  saveTrackGroups: async () => {
    const { project } = get();
    if (!project) return;
    const groups = useTrackGroupStore.getState().groups;
    try {
      const updated = await apiClient.updateTrackGroups(
        project.id,
        trackGroupsToApi(groups),
      );
      set({ project: syncTrackGroupsFromProject(updated), error: null });
    } catch (e: unknown) {
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),

  setClipStart: (trackId, seconds) =>
    set((s) => {
      if (!s.project) return {};
      const t = Math.max(0, Math.round(seconds * 1000) / 1000);
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((tr) =>
            tr.id === trackId ? { ...tr, clip_start_seconds: t } : tr
          ),
        },
      };
    }),

  setTrackColor: (trackId, color) => {
    invalidateWaveformBitmap(trackId);
    set((s) => {
      if (!s.project) return {};
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((tr) =>
            tr.id === trackId ? { ...tr, color } : tr
          ),
        },
      };
    });
  },

  deleteTrack: async (trackId) => {
    const { project } = get();
    if (!project) return;

    const removedIds = new Set<string>([trackId]);
    const target = project.tracks.find((t) => t.id === trackId);
    if (target?.role === "reference_full_mix") {
      for (const t of project.tracks) {
        if (t.role === "reference_stem") removedIds.add(t.id);
      }
    }

    const prevTracks = project.tracks;
    const prevIndex = prevTracks.findIndex((t) => t.id === trackId);

    try {
      const updated = await apiClient.deleteTrack(project.id, trackId);
      set({ project: syncTrackGroupsFromProject(updated), error: null });

      for (const id of removedIds) {
        engineClient.removeTrack(id).catch(() => {});
        invalidateWaveformBitmap(id);
        useEngineStore.getState().removeTrack(id);
        useTimelineStore.getState().clearTrackHeight(id);
        useTrackGroupStore.getState().removeTrackFromAllGroups(id);
      }

      const sel = useSelectionStore.getState();
      if (sel.selectedTrackId && removedIds.has(sel.selectedTrackId)) {
        const remaining = updated.tracks;
        const next = remaining[prevIndex] ?? remaining[prevIndex - 1] ?? remaining[0];
        sel.selectTrack(next?.id ?? null);
      }
      if (sel.compareUserTrackId && removedIds.has(sel.compareUserTrackId)) {
        sel.setCompareUserTrack(null);
      }
      if (sel.compareRefTrackId && removedIds.has(sel.compareRefTrackId)) {
        sel.setCompareRefTrack(null);
      }
    } catch (e: unknown) {
      set({ error: String(e) });
    }
  },

  createProject: async (name = "Untitled Project") => {
    set({ isLoading: true, loadingLabel: "creating project", error: null });
    try {
      const project = await apiClient.createProject(name);
      set({ project, isLoading: false, loadingLabel: null });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false, loadingLabel: null });
    }
  },

  uploadReference: async (file) => {
    const { project } = get();
    if (!project || referenceUploadInFlight) return;
    referenceUploadInFlight = true;
    const pendingId = `pending-ref-${Date.now()}`;
    set((s) => ({
      isLoading: true,
      loadingLabel: "uploading & analyzing…",
      error: null,
      pendingTracks: [
        ...s.pendingTracks,
        { id: pendingId, fileName: file.name, role: "reference", status: "uploading", operation: `Uploading ${file.name}…` },
      ],
    }));
    try {
      // Switch status to analyzing once upload is underway
      setTimeout(() => {
        set((s) => ({
          pendingTracks: s.pendingTracks.map((p) =>
            p.id === pendingId
              ? { ...p, status: "analyzing", operation: `Reading waveform: ${file.name}` }
              : p
          ),
        }));
      }, 400);

      const updated = await apiClient.uploadReference(project.id, file);
      const normalized = syncTrackGroupsFromProject(updated);
      const refId = normalized.reference_track_id;
      set((s) => ({
        project: normalized,
        isLoading: Boolean(refId),
        loadingLabel: refId ? "analyzing & separating stems…" : null,
        pendingTracks: s.pendingTracks.filter((p) => p.id !== pendingId),
      }));
      if (refId) {
        try {
          await get().analyzeTrack(refId, { manageLoading: false });
        } finally {
          set({ isLoading: false, loadingLabel: null });
        }
      }
    } catch (e: unknown) {
      set((s) => ({
        error: String(e),
        isLoading: false,
        loadingLabel: null,
        pendingTracks: s.pendingTracks.filter((p) => p.id !== pendingId),
      }));
    } finally {
      referenceUploadInFlight = false;
    }
  },

  uploadUserStems: async (files) => {
    const { project } = get();
    if (!project) return;
    const newPending: PendingTrack[] = files.map((f, i) => ({
      id: `pending-user-${Date.now()}-${i}`,
      fileName: f.name,
      role: "user" as const,
      status: "uploading" as const,
      operation: `Uploading ${f.name}…`,
    }));
    set((s) => ({
      isLoading: true,
      loadingLabel: `importing ${files.length} stem${files.length > 1 ? "s" : ""}…`,
      error: null,
      pendingTracks: [...s.pendingTracks, ...newPending],
    }));
    try {
      setTimeout(() => {
        set((s) => ({
          pendingTracks: s.pendingTracks.map((p) =>
            newPending.find((np) => np.id === p.id)
              ? { ...p, status: "analyzing", operation: `Reading waveform: ${p.fileName}` }
              : p
          ),
        }));
      }, 400);

      const updated = await apiClient.uploadUserStems(project.id, files);
      const pendingIds = new Set(newPending.map((p) => p.id));
      set((s) => ({
        project: syncTrackGroupsFromProject(updated),
        isLoading: false,
        loadingLabel: null,
        pendingTracks: s.pendingTracks.filter((p) => !pendingIds.has(p.id)),
      }));
    } catch (e: unknown) {
      const pendingIds = new Set(newPending.map((p) => p.id));
      set((s) => ({
        error: String(e),
        isLoading: false,
        loadingLabel: null,
        pendingTracks: s.pendingTracks.filter((p) => !pendingIds.has(p.id)),
      }));
    }
  },

  analyzeProject: async () => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, loadingLabel: "analyzing tracks…", error: null });
    try {
      const ref = project.tracks.find(
        (t) =>
          t.role === "reference_full_mix" &&
          (t.analysis_status === "pending" || t.analysis_status === "failed"),
      );
      if (ref) {
        await get().analyzeTrack(ref.id, { manageLoading: false });
        const after = get().project;
        const morePending = after?.tracks.some(
          (t) =>
            t.id !== ref.id &&
            (t.analysis_status === "pending" || t.analysis_status === "failed"),
        );
        if (morePending && after) {
          set({ isLoading: true, loadingLabel: "analyzing remaining tracks…" });
          const updated = await apiClient.analyzeProject(after.id);
          set({
            project: syncTrackGroupsFromProject(updated),
            isLoading: false,
            loadingLabel: null,
          });
        } else {
          set({ isLoading: false, loadingLabel: null });
        }
        return;
      }

      const updated = await apiClient.analyzeProject(project.id);
      set({
        project: syncTrackGroupsFromProject(updated),
        isLoading: false,
        loadingLabel: null,
      });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false, loadingLabel: null });
    }
  },

  analyzeTrack: async (trackId: string, opts?: { manageLoading?: boolean }) => {
    const { project } = get();
    if (!project) return;
    const manageLoading = opts?.manageLoading !== false;
    const isReference = project.tracks.find((t) => t.id === trackId)?.role === "reference_full_mix";

    set((s) => ({
      ...(manageLoading
        ? {
            isLoading: true,
            loadingLabel: isReference ? "analyzing & separating stems…" : "analyzing…",
          }
        : {}),
      error: null,
      project: s.project
        ? {
            ...s.project,
            tracks: s.project.tracks.map((t) =>
              t.id === trackId ? { ...t, analysis_status: "analyzing" as const } : t
            ),
          }
        : null,
    }));
    try {
      const updated = await apiClient.analyzeTrack(project.id, trackId);
      const { project: nextProject, error: stemError } = applyAnalyzedProject(updated, trackId);
      set({
        project: nextProject,
        ...(manageLoading ? { isLoading: false, loadingLabel: null } : {}),
        ...(stemError ? { error: stemError } : {}),
      });
    } catch (e: unknown) {
      set((s) => ({
        error: String(e),
        ...(manageLoading ? { isLoading: false, loadingLabel: null } : {}),
        project: s.project
          ? {
              ...s.project,
              tracks: s.project.tracks.map((t) =>
                t.id === trackId ? { ...t, analysis_status: "failed" as const } : t
              ),
            }
          : null,
      }));
    }
  },

  compareProject: async (userTrackId, refTrackId) => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, loadingLabel: "generating mix moves…", error: null });
    try {
      const updated = await apiClient.compareProject(project.id, userTrackId, refTrackId);
      set({ project: updated, isLoading: false, loadingLabel: null });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false, loadingLabel: null });
    }
  },

  exportBlueprint: async () => {
    const { project } = get();
    if (!project) return;
    try {
      const blueprint = await apiClient.exportBlueprint(project.id);
      const blob = new Blob([JSON.stringify(blueprint, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, "_")}_mix_blueprint.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      set({ error: String(e) });
    }
  },
}));
