/**
 * Feedbacks 模块共享类型 — feat-200.4 Week 4
 *
 * 4 维评分：均为可选 1-5 整数；用户可只评其中几维而不强迫填满。
 * edit_diff：用户编辑后的最终文本（前端跟原 result_notes 做行级 diff 给运营看就够，
 *   后端不解析）。
 */

export const FEEDBACK_DIMENSIONS = ["relevance", "accuracy", "creativity", "overall"] as const;
export type FeedbackDimension = (typeof FEEDBACK_DIMENSIONS)[number];

export interface FeedbackRatings {
  relevance?: number | null;
  accuracy?: number | null;
  creativity?: number | null;
  overall?: number | null;
}

export interface FeedbackInput extends FeedbackRatings {
  editDiff?: string | null;
  comment?: string | null;
}

export interface FeedbackRow extends FeedbackRatings {
  id: string;
  generationId: string;
  userId: string;
  editDiff: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}
