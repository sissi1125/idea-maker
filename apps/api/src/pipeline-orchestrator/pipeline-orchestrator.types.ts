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
  /**
   * 可选：本次 generate 要应用的平台规则 ID 列表。
   * 后端按 ID 拉规则 + 自动过滤 disabled；将规则配置注入 prompt + 跑后置 validator。
   * feat-200.8 新增。
   */
  platformRuleIds?: string[];
}

/**
 * 违规条目——RuleValidator 跑完产出，前端 GeneratedResult 用红色 banner 展示。
 * 字段语义与 apps/api/src/platform-rules/platform-rules.types.ts:RuleViolation 一致；
 * 这里独立定义避免 orchestrator/types 反向依赖 platform-rules 模块。
 */
export interface ViolationItem {
  type: "max_length" | "banned_keyword" | "missing_tag";
  ruleId: string;
  ruleName: string;
  message: string;
  detail?: Record<string, unknown>;
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
  /** feat-200.8：平台规则后置校验产出。无规则或全通过时为空数组。 */
  violations: ViolationItem[];
}

// ── Generation DB Row ────────────────────────────────────────────────────

export interface GenerationRow {
  id: string;
  projectId: string;
  query: string;
  status: string;
  /** feat-200.4：manual（用户主动 generate）/ auto（ingestion 完成自动触发） */
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
