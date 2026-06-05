/**
 * FastAPI analysis service client.
 * All methods call localhost:8000.
 */
import type { OdeonProject, MixBlueprint, TrackBusGroup } from "@odeon/shared";

const BASE = "http://localhost:8000";

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
};
