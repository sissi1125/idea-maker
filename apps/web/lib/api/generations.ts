/**
 * Generations API — feat-200.6 Week 6
 *
 * 端点（Week 3-4 后端）：
 *   POST /projects/:pid/generate                    执行一次 RAG generate
 *   GET  /projects/:pid/generations                 列表（cursor 分页）
 *   GET  /projects/:pid/generations/:gid            单条详情
 *
 * 设计：
 *   - generate 是同步请求，前端等完整结果返回（future: SSE stage 推送）
 *   - 列表支持 cursor + limit + status + source 过滤
 */

import { apiFetch } from "./client";

// ── 类型（镜像后端 pipeline-orchestrator.types.ts） ────────────────────────

export interface CostBreakdown {
  costUsd: number;
  llmTokensPrompt: number;
  llmTokensCompletion: number;
  embeddingCalls: number;
  retrievalCalls: number;
  rerankerCalls: number;
}

export interface StageResult {
  stageId: string;
  methodId: string;
  status: "success" | "skipped" | "error";
  durationMs: number;
  output?: unknown;
  trace?: unknown;
  warnings?: string[];
  error?: string;
}

export interface PipelineTrace {
  pipelineName: string;
  pipelineVersion: string;
  stages: StageResult[];
  totalDurationMs: number;
  cost: CostBreakdown;
}

export interface GenerationRow {
  id: string;
  projectId: string;
  query: string;
  status: string;
  source: string;
  pipelineTrace: PipelineTrace | null;
  retrievedChunks: unknown[] | null;
  resultNotes: string | null;
  costBreakdown: CostBreakdown | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateResponse {
  generationId: string;
  status: "succeeded" | "failed";
  query: string;
  resultNotes: string | null;
  pipelineTrace: PipelineTrace;
  retrievedChunks: unknown[];
  costBreakdown: CostBreakdown;
  durationMs: number;
  error?: string;
}

export interface ListGenerationsResponse {
  generations: GenerationRow[];
  nextCursor: string | null;
}

// ── API 函数 ──────────────────────────────────────────────────────────────

/** 执行一次 RAG 生成 */
export async function generate(
  projectId: string,
  query: string,
): Promise<GenerateResponse> {
  return apiFetch<GenerateResponse>(`/projects/${projectId}/generate`, {
    method: "POST",
    body: { query },
  });
}

/** 列出项目的 generation 历史（cursor 分页） */
export async function listGenerations(
  projectId: string,
  options?: {
    cursor?: string;
    limit?: number;
    status?: string;
    source?: string;
  },
): Promise<ListGenerationsResponse> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.status) params.set("status", options.status);
  if (options?.source) params.set("source", options.source);
  const qs = params.toString();
  return apiFetch<ListGenerationsResponse>(
    `/projects/${projectId}/generations${qs ? `?${qs}` : ""}`,
  );
}

/** 获取单条 generation 详情 */
export async function getGeneration(
  projectId: string,
  generationId: string,
): Promise<{ generation: GenerationRow }> {
  return apiFetch<{ generation: GenerationRow }>(
    `/projects/${projectId}/generations/${generationId}`,
  );
}
