/**
 * Feedbacks API client — feat-200.7 Week 7
 *
 * 对接后端 FeedbacksController（feat-200.4）：
 *   POST /generations/:id/feedback  upsert（首次提交或覆盖）
 *   GET  /generations/:id/feedback
 *
 * 设计取舍：
 *   - 4 维评分都是可选（后端允许部分提交），前端不强校验；
 *   - editDiff/comment 也可选；
 *   - 重新提交走同一个 POST，后端 ON CONFLICT 自动 update（不暴露 PUT 路由）。
 *
 * 类型镜像 apps/api/src/feedbacks/feedbacks.types.ts，避免共享包循环依赖。
 */

import { apiFetch } from "./client";

export const FEEDBACK_DIMENSIONS = ["relevance", "accuracy", "creativity", "overall"] as const;
export type FeedbackDimension = (typeof FEEDBACK_DIMENSIONS)[number];

export interface FeedbackInput {
  relevance?: number | null;
  accuracy?: number | null;
  creativity?: number | null;
  overall?: number | null;
  editDiff?: string | null;
  comment?: string | null;
}

export interface FeedbackRow {
  id: string;
  generationId: string;
  userId: string;
  relevance: number | null;
  accuracy: number | null;
  creativity: number | null;
  overall: number | null;
  editDiff: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 提交（首次或覆盖）：后端 ON CONFLICT(generation_id) DO UPDATE */
export async function submitFeedback(
  generationId: string,
  input: FeedbackInput,
): Promise<{ feedback: FeedbackRow }> {
  return apiFetch<{ feedback: FeedbackRow }>(
    `/generations/${generationId}/feedback`,
    { method: "POST", body: input },
  );
}

/** 查询：未提交过返回 { feedback: null } */
export async function getFeedback(
  generationId: string,
): Promise<{ feedback: FeedbackRow | null }> {
  return apiFetch<{ feedback: FeedbackRow | null }>(
    `/generations/${generationId}/feedback`,
  );
}
