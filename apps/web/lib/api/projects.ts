/**
 * Projects API — feat-200.5 Week 5
 *
 * 端点（Week 1 后端）：
 *   GET    /projects            → { projects }
 *   POST   /projects            → { project }
 *   GET    /projects/:id        → { project }
 *   PUT    /projects/:id        → { project }
 *   DELETE /projects/:id        → 204
 *   GET    /projects/:id/settings → { settings }
 *   PUT    /projects/:id/settings → { settings }
 */

import { apiFetch } from "./client";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  emoji: string | null;
  description: string | null;
  docsCount: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  projectId: string;
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  thinkingDepth: string | null;
  retrievalMode: string | null;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  emoji?: string;
  description?: string;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<{ projects: Project[] }> {
  return apiFetch("/projects");
}

export async function getProject(id: string): Promise<{ project: Project }> {
  return apiFetch(`/projects/${id}`);
}

export async function createProject(input: CreateProjectInput): Promise<{ project: Project }> {
  return apiFetch("/projects", { method: "POST", body: input });
}

export async function updateProject(
  id: string,
  input: Partial<CreateProjectInput>,
): Promise<{ project: Project }> {
  return apiFetch(`/projects/${id}`, { method: "PUT", body: input });
}

export async function deleteProject(id: string): Promise<void> {
  return apiFetch(`/projects/${id}`, { method: "DELETE" });
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(projectId: string): Promise<{ settings: ProjectSettings }> {
  return apiFetch(`/projects/${projectId}/settings`);
}

export async function updateSettings(
  projectId: string,
  input: Partial<ProjectSettings>,
): Promise<{ settings: ProjectSettings }> {
  return apiFetch(`/projects/${projectId}/settings`, { method: "PUT", body: input });
}
