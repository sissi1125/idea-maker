/**
 * 反馈学习 API client — feat-400.3 前端
 *
 * 从用户改稿里学偏好：系统只出「更新建议」，用户点接受才落到产品档案的表达约束，
 * 永远不改产品事实。
 */

import { apiFetch } from "./client";

export interface UpdateSuggestion {
  id: string;
  category: string;
  suggestion_text: string;
  target_group: "style" | "constraint";
  target_key: string;
  target_value: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

export async function listSuggestions(projectId: string): Promise<UpdateSuggestion[]> {
  const res = await apiFetch<{ suggestions: UpdateSuggestion[] }>(
    `/projects/${projectId}/feedback-learning/suggestions`,
  );
  return res.suggestions;
}

export async function generateSuggestions(projectId: string): Promise<{ created: unknown[] }> {
  return apiFetch(`/projects/${projectId}/feedback-learning/suggest`, { method: "POST" });
}

export async function acceptSuggestion(projectId: string, id: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/feedback-learning/suggestions/${id}/accept`, { method: "POST" });
}

export async function rejectSuggestion(projectId: string, id: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/feedback-learning/suggestions/${id}/reject`, { method: "POST" });
}

export async function recordFeedback(
  projectId: string,
  body: {
    evaluationId?: string;
    action: "adopted" | "edited" | "rejected";
    originalText?: string;
    editedText?: string;
    category?: string;
    note?: string;
  },
): Promise<{ id: string; category: string | null }> {
  return apiFetch(`/projects/${projectId}/feedback-learning/feedback`, { method: "POST", body });
}
