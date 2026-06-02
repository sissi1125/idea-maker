/**
 * Eval API client — feat-300.6 任务 0
 *
 * 对接后端 EvalController：
 *   POST /projects/:pid/eval/run                                  触发一次 eval
 *   GET  /projects/:pid/eval/runs?limit=                           最近 runs 列表
 *   GET  /projects/:pid/eval/runs/:runId                           单条详情
 *   POST /projects/:pid/eval/golden/from-feedback/:generationId    feedback 升级 golden
 *
 * 注意：runEval 同步阻塞（30 条 golden ≈ 60s+），调用时务必设大 timeout。
 *       MVP 阶段 UI 用 disabled + spinner，未来加 SSE 进度（feat-300.7）。
 */

import { apiFetch } from "./client";

export type EvalRunStatus = "running" | "succeeded" | "failed";

export interface EvalRunSummary {
  evalRunId: string;
  projectId: string;
  totalItems: number;
  passedItems: number;
  avgFaithfulness: number;
  avgCompleteness: number;
  avgStyle: number;
  avgOverall: number;
  deltaVsBaseline: number | null;
  shouldFailCI: boolean;
}

export interface EvalRunRowLite {
  id: string;
  projectId: string;
  status: EvalRunStatus;
  triggeredBy: string;
  gitCommit: string | null;
  gitBranch: string | null;
  baselineRunId: string | null;
  thresholdDrop: number;
  totalItems: number;
  passedItems: number;
  avgFaithfulness: number | null;
  avgCompleteness: number | null;
  avgStyle: number | null;
  avgOverall: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunEvalBody {
  triggeredBy?: "manual" | "cli" | "ci" | "cron";
  gitCommit?: string;
  gitBranch?: string;
  thresholdDrop?: number;
  ids?: string[];
  tags?: string[];
}

export async function runEval(
  projectId: string,
  body: RunEvalBody = {},
): Promise<EvalRunSummary> {
  const res = await apiFetch<{ summary: EvalRunSummary }>(
    `/projects/${projectId}/eval/run`,
    { method: "POST", body },
  );
  return res.summary;
}

export async function listEvalRuns(
  projectId: string,
  opts: { limit?: number } = {},
): Promise<EvalRunRowLite[]> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch<{ runs: EvalRunRowLite[] }>(
    `/projects/${projectId}/eval/runs${qs}`,
  );
  return res.runs;
}

export async function getEvalRun(projectId: string, runId: string): Promise<EvalRunRowLite> {
  const res = await apiFetch<{ run: EvalRunRowLite }>(
    `/projects/${projectId}/eval/runs/${runId}`,
  );
  return res.run;
}

export interface PromoteFeedbackResponse {
  item: {
    id: string;
    query: string;
    expectedTools: string[];
    referenceAnswer: string;
    thresholds: { faithfulness: number; completeness: number; style: number };
    meta?: { source?: string; sourceFeedbackId?: string; tags?: string[] };
  };
  filePath: string;
}

export async function promoteFeedbackToGolden(
  projectId: string,
  generationId: string,
): Promise<PromoteFeedbackResponse> {
  return apiFetch<PromoteFeedbackResponse>(
    `/projects/${projectId}/eval/golden/from-feedback/${generationId}`,
    { method: "POST" },
  );
}
