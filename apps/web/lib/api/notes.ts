/**
 * Notes API client — feat-200.7 Week 7
 *
 * 对接后端 NotesController：
 *   POST   /projects/:pid/notes
 *   GET    /projects/:pid/notes?limit=&offset=
 *   GET    /projects/:pid/notes/:noteId
 *   PATCH  /projects/:pid/notes/:noteId
 *   DELETE /projects/:pid/notes/:noteId
 */

import { apiFetch } from "./client";

export interface Note {
  id: string;
  projectId: string;
  generationId: string | null;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteInput {
  generationId?: string | null;
  title: string;
  content: string;
  tags?: string[];
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
}

export async function listNotes(
  projectId: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ notes: Note[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiFetch<{ notes: Note[]; total: number }>(
    `/projects/${projectId}/notes${qs ? `?${qs}` : ""}`,
  );
}

export async function getNote(projectId: string, noteId: string): Promise<{ note: Note }> {
  return apiFetch<{ note: Note }>(`/projects/${projectId}/notes/${noteId}`);
}

export async function createNote(
  projectId: string,
  input: CreateNoteInput,
): Promise<{ note: Note }> {
  return apiFetch<{ note: Note }>(`/projects/${projectId}/notes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateNote(
  projectId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<{ note: Note }> {
  return apiFetch<{ note: Note }>(`/projects/${projectId}/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteNote(projectId: string, noteId: string): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/notes/${noteId}`, { method: "DELETE" });
}
