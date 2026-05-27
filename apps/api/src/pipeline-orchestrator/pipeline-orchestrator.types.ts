/**
 * Pipeline Orchestrator 类型定义 — feat-200.3 Week 3
 *
 * 核心概念：
 *   - PipelineConfig：从 YAML 解析出来的编排配置（stage 顺序 + 默认 method/params）
 *   - StageResult：单 stage 执行后的标准化结果（output + trace + 耗时 + warnings）
 *   - PipelineTrace：完整 pipeline 的执行轨迹（所有 stage results + 总耗时 + cost）
 *   - GenerateRequest：POST /projects/:id/generate 的请求体
 */

import type { CostBreakdown } from "../common/trace-context.service";

// ── YAML 配置结构 ──────────────────────────────────────────────────────────

export interface StageConfig {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface PipelineConfig {
  name: string;
  description: string;
  version: string;
  stages: StageConfig[];
}

// ── 执行结果 ──────────────────────────────────────────────────────────────

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

// ── 请求/响应 ──────────────────────────────────────────────────────────────

export interface GenerateRequest {
  query: string;
  /** 可选：覆盖默认 pipeline 配置（暂不暴露给前端，留给 Week 5 Settings） */
  pipelineOverrides?: Partial<StageConfig>[];
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

// ── Generation DB Row ────────────────────────────────────────────────────

export interface GenerationRow {
  id: string;
  projectId: string;
  query: string;
  status: string;
  pipelineTrace: PipelineTrace | null;
  retrievedChunks: unknown[] | null;
  resultNotes: string | null;
  costBreakdown: CostBreakdown | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}
