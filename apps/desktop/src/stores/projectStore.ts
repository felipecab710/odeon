/**
 * Project store — owns the OdeonProject state and API interactions.
 */
import { create } from "zustand";
import type { OdeonProject } from "@odeon/shared";
import { apiClient } from "../lib/apiClient";

interface ProjectState {
  project: OdeonProject | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createProject: (name?: string) => Promise<void>;
  uploadReference: (file: File) => Promise<void>;
  uploadUserStems: (files: File[]) => Promise<void>;
  analyzeProject: () => Promise<void>;
  compareProject: (userTrackId?: string, refTrackId?: string) => Promise<void>;
  exportBlueprint: () => Promise<void>;
  setProject: (p: OdeonProject) => void;
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isLoading: false,
  error: null,

  setProject: (p) => set({ project: p }),
  clearError: () => set({ error: null }),

  createProject: async (name = "Untitled Project") => {
    set({ isLoading: true, error: null });
    try {
      const project = await apiClient.createProject(name);
      set({ project, isLoading: false });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false });
    }
  },

  uploadReference: async (file) => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, error: null });
    try {
      const updated = await apiClient.uploadReference(project.id, file);
      set({ project: updated, isLoading: false });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false });
    }
  },

  uploadUserStems: async (files) => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, error: null });
    try {
      const updated = await apiClient.uploadUserStems(project.id, files);
      set({ project: updated, isLoading: false });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false });
    }
  },

  analyzeProject: async () => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, error: null });
    try {
      const updated = await apiClient.analyzeProject(project.id);
      set({ project: updated, isLoading: false });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false });
    }
  },

  compareProject: async (userTrackId, refTrackId) => {
    const { project } = get();
    if (!project) return;
    set({ isLoading: true, error: null });
    try {
      const updated = await apiClient.compareProject(project.id, userTrackId, refTrackId);
      set({ project: updated, isLoading: false });
    } catch (e: unknown) {
      set({ error: String(e), isLoading: false });
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
