/**
 * 内容评测 API client — feat-400.2 前端
 *
 * 一条内容先过一道「硬规则检查」（代码死规则，不合格直接拦），过了才让大模型考官打分，
 * 最后给个去向：可发布 / 要人工看 / 要改 / 直接毙。
 */

import { apiFetch } from "./client";

export type Decision = "publish_candidate" | "human_review" | "revise" | "blocked";

export interface GateFailure {
  rule: string;
  detail: string;
}
export interface ContentScores {
  factualFaithfulness: number;
  audienceFit: number;
  platformFit: number;
  clarity: number;
  differentiation: number;
  styleFit: number;
  issues: Array<{ severity: string; category: string; evidence?: string; recommendation: string }>;
}
export interface EvaluateResult {
  variantId: string;
  gatePassed: boolean;
  gateFailures: GateFailure[];
  scores: ContentScores | null;
  decision: Decision;
  evaluationId: string;
}

export interface EvaluateInput {
  body: string;
  angle?: string;
  hook?: string;
  cta?: string;
  claimIds?: string[];
  platform?: string;
  platformMaxLength?: number;
  platformBannedWords?: string[];
}

export async function evaluateContent(projectId: string, body: EvaluateInput): Promise<EvaluateResult> {
  const res = await apiFetch<{ result: EvaluateResult }>(
    `/projects/${projectId}/content/evaluate`,
    { method: "POST", body },
  );
  return res.result;
}

export interface QueueItem {
  id: string;
  variant_id: string;
  decision: Decision;
  gate_failures: GateFailure[];
  scores: ContentScores | null;
  body: string;
  angle: string | null;
  platform: string | null;
  created_at: string;
}

export async function getQueue(projectId: string): Promise<QueueItem[]> {
  const res = await apiFetch<{ queue: QueueItem[] }>(`/projects/${projectId}/content/queue`);
  return res.queue;
}

export async function humanDecision(
  projectId: string,
  evaluationId: string,
  decision: "accepted" | "edited" | "rejected",
): Promise<void> {
  await apiFetch(`/projects/${projectId}/content/evaluations/${evaluationId}/decision`, {
    method: "POST",
    body: { decision },
  });
}
