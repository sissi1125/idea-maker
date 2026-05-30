/**
 * spillIfLarge — tool execute 的"包一层"helper。
 *
 * 用法：
 *   const raw = await someService.fetch();
 *   return spillIfLarge(raw, spillStorage, {
 *     kind: "search-web",
 *     preview: r => ...,
 *     summary: r => ({ itemCount: ... }),
 *   });
 *
 * 行为：
 *   - 序列化 payload 后 < SPILL_THRESHOLD_BYTES：原样返回 payload
 *   - >= 阈值：落盘，**返回两套 ref**：
 *       llmSafe：去掉 path/size/hash，进 ai-sdk messages 给 LLM 看
 *       full   ：完整 ref，由 AgentRunner 写到 agent_steps.output
 *
 * 注意：tool execute 直接 return 的值就是 ai-sdk 拿去塞进 messages 的值，所以本
 * helper 默认 return `llmSafe`。**完整 ref 需要 tool / runner 通过其他渠道
 * 持久化**（feat-300.3 任务 6 在 AgentRunner.onStepFinish 里把 step.toolResults
 * 取出，回查同一份 payload 写库）。
 *
 * 本期 0.7 任务里搞不定"同一份数据两套 view"——LLM 视角和 trace 视角的拆分。
 * 简化方案：本 helper 只返 llmSafe，但**把 full path/size/hash 也带在
 * llmSafe.__trace 隐藏字段里**，AgentRunner 写 step 时把 __trace 剥到 output，
 * 给 LLM 看的版本前端再过滤。
 *
 * 这种"挂隐藏字段透传"是工程实用的折衷——它有一点不优雅但避免了让 tool
 * 知道 RunnerContext，保持 tool 的纯粹性。
 */

import {
  SpillStorage,
  SPILL_THRESHOLD_BYTES,
  SPILL_PREVIEW_CHARS,
  type SpillRefFull,
  type SpillRefLlmSafe,
  toLlmSafe,
} from "../../spill-storage.service";

/**
 * 隐藏的 trace 字段，AgentRunner 在写 step 时剥出。
 * 选 `__trace` 这种带双下划线前缀避免与业务字段冲突。
 */
export const TRACE_FIELD = "__trace" as const;

export interface SpillIfLargeOptions<T> {
  /** payload 类型标识 */
  kind: string;
  /** 生成 LLM 看的预览（最多 SPILL_PREVIEW_CHARS 字符） */
  preview: (payload: T) => string;
  /** 生成结构化 summary */
  summary: (payload: T) => Record<string, unknown>;
  /** 注入的 SpillStorage 实例（tool factory 闭包绑定） */
  storage: SpillStorage;
}

/**
 * 包一层 spill 决策。返回三种可能：
 *   1. 小 payload：原样返回 T
 *   2. 大 payload：返回 SpillRefLlmSafe（带 __trace 隐藏字段供 runner 写库）
 *   3. spill 抛错（payload 超 1MB 硬上限）：把异常透传给 tool execute
 */
export async function spillIfLarge<T>(
  payload: T,
  opts: SpillIfLargeOptions<T>,
): Promise<T | (SpillRefLlmSafe & { [TRACE_FIELD]?: { path: string; size: number; hash: string } })> {
  const size = Buffer.byteLength(JSON.stringify(payload), "utf-8");
  if (size <= SPILL_THRESHOLD_BYTES) return payload;

  // 截断 preview 到上限，防止 preview 本身比阈值还大（罕见但要兜底）
  const previewFull = opts.preview(payload);
  const preview =
    previewFull.length > SPILL_PREVIEW_CHARS
      ? `${previewFull.slice(0, SPILL_PREVIEW_CHARS)}…`
      : previewFull;

  const fullRef: SpillRefFull = await opts.storage.spill(payload, {
    kind: opts.kind,
    preview,
    summary: opts.summary(payload),
  });

  const llmSafe = toLlmSafe(fullRef);
  return {
    ...llmSafe,
    // 隐藏字段：runner 写 agent_steps.output 时剥出，前端永远看不见
    [TRACE_FIELD]: {
      path: fullRef.path,
      size: fullRef.size,
      hash: fullRef.hash,
    },
  };
}
