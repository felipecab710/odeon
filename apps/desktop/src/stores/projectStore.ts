/**
 * Project store — owns the OdeonProject state and API interactions.
 */
import { create } from "zustand";
import type { OdeonProject } from "@odeon/shared";
import { apiClient } from "../lib/apiClient";

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
  analyzeTrack: (trackId: string) => Promise<void>;
  compareProject: (userTrackId?: string, refTrackId?: string) => Promise<void>;
  exportBlueprint: () => Promise<void>;
  setProject: (p: OdeonProject) => void;
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isLoading: false,
  loadingLabel: null,
  pendingTracks: [],
  error: null,

  setProject: (p) => set({ project: p }),
  clearError: () => set({ error: null }),

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
    if (!project) return;
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
      set((s) => ({
        project: updated,
        isLoading: false,
        loadingLabel: null,
        pendingTracks: s.pendingTracks.filter((p) => p.id !== pendingId),
      }));
    } catch (e: unknown) {
      set((s) => ({
        error: String(e),
        isLoading: false,
        loadingLabel: null,
        pendingTracks: s.pendingTracks.filter((p) => p.id !== pendingId),
      }));
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
        project: updated,
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
      const updated = await apiClient.analyzeProject(project.id);
      set({ project: updated, isLoading: false, loadingLabel: null });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false, loadingLabel: null });
    }
  },

  analyzeTrack: async (trackId: string) => {
    const { project } = get();
    if (!project) return;
    // Mark the track as analyzing optimistically so the UI responds immediately
    set((s) => ({
      isLoading: true,
      loadingLabel: "analyzing…",
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
      set({ project: updated, isLoading: false, loadingLabel: null });
    } catch (e: unknown) {
      // Revert the optimistic status back to failed
      set((s) => ({
        error: String(e),
        isLoading: false,
        loadingLabel: null,
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
