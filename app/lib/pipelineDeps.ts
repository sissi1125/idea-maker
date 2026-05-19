/**
 * Pipeline Stage 依赖关系图
 *
 * 定义每个 stage 的上游依赖，以及在步骤可选/条件化后的有效上游解析逻辑。
 *
 * Ingestion 链（document-upload 为入口）：
 *   document-upload → idempotency → preprocess → chunk → transform → embedding → storage
 *
 * Query 链（context-management 为链首，实际入口由 resolveEffectiveUpstream 动态决定）：
 *   context-management → intent-recognition → query-rewrite →
 *   retrieval → multi-recall-merge → filter → rerank → fallback →
 *   prompt-build → generation → output-validation → citation
 *
 * 当可选/条件步骤被禁用时，resolveEffectiveUpstream 会沿链向上跳过被禁用的步骤，
 * 找到最近的活跃步骤作为实际上游。required 步骤永远不会被跳过。
 */

import { PipelineRuntimeContext } from "./types";
import { PIPELINE_STAGES, PipelineStage } from "./pipelineStages";

/** stage 依赖配置：key 是当前 stage ID，value 是它的直接上游 stage ID */
export const STAGE_DEPS: Record<string, string> = {
  // Ingestion 链
  "idempotency":         "document-upload",
  "preprocess":          "idempotency",
  "chunk":               "preprocess",
  "transform":           "chunk",
  "embedding":           "transform",
  "storage":             "embedding",

  // Query 链
  "intent-recognition":  "context-management",
  "query-rewrite":       "intent-recognition",
  "retrieval":           "query-rewrite",
  "multi-recall-merge":  "retrieval",
  "filter":              "multi-recall-merge",
  "rerank":              "filter",
  "fallback":            "rerank",
  "prompt-build":        "fallback",
  "generation":          "prompt-build",
  "output-validation":   "generation",
  "citation":            "output-validation",
};

// ─── 步骤激活判断 ─────────────────────────────────────────────────────────────

/**
 * 判断一个 stage 在当前配置下是否"活跃"（不被跳过）。
 *
 * - required：始终活跃
 * - conditional：先看 enabledSteps 里有无用户强制覆盖；没有则读 runtimeContext
 * - optional/optimization：enabledSteps 优先，不存在则用 stage.defaultEnabled
 */
export function isStageActive(
  stage: PipelineStage,
  enabledSteps: Record<string, boolean>,
  runtimeContext: PipelineRuntimeContext
): boolean {
  if (stage.category === "required") return true;

  if (stage.category === "conditional" && stage.conditionKey) {
    // 用户通过 toggle 强制覆盖（无论条件如何）
    if (stage.id in enabledSteps) return enabledSteps[stage.id];
    // 读运行时上下文
    return runtimeContext[stage.conditionKey] === true;
  }

  // optional / optimization：enabledSteps 优先，缺省用 defaultEnabled
  return enabledSteps[stage.id] ?? stage.defaultEnabled;
}

// ─── 有效上游解析 ─────────────────────────────────────────────────────────────

/**
 * 解析 stageId 的"有效上游"：沿 STAGE_DEPS 链向上查找，
 * 跳过被禁用的 optional/conditional 步骤，直到找到活跃步骤。
 *
 * 返回值：
 *   string  — 找到的活跃上游 stageId
 *   null    — 该步骤是当前链的入口（无上游），或所有上游都被禁用
 *
 * 当所有步骤都启用（默认状态）时，行为与直接读 STAGE_DEPS[stageId] 完全一致。
 */
export function resolveEffectiveUpstream(
  stageId: string,
  enabledSteps: Record<string, boolean>,
  runtimeContext: PipelineRuntimeContext
): string | null {
  let current = STAGE_DEPS[stageId];
  while (current) {
    const stage = PIPELINE_STAGES.find((s) => s.id === current);
    if (!stage) return current;          // 未知步骤保守处理：视为活跃
    if (isStageActive(stage, enabledSteps, runtimeContext)) return current;
    current = STAGE_DEPS[current];       // 跳过，继续向上
  }
  return null;
}

/** 兼容旧调用：直接查 STAGE_DEPS，不考虑 enabledSteps（用于上游 stale 检测等简单场景） */
export function getUpstream(stageId: string): string | null {
  return STAGE_DEPS[stageId] ?? null;
}
