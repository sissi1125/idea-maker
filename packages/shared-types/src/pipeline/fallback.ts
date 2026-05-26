import { z } from "zod";
import type { RankedChunk, RerankOutput } from "./rerank";
import type { LLMChatClient } from "./query-rewrite";

/**
 * Fallback - 共享类型定义
 *
 * 作用：检索结果不足/质量低时触发降级，防止 LLM 在无 evidence 时幻觉。
 *
 * 2 method：
 *   reject-answer     返回预设拒答消息
 *   generic-response  注入 LLMChatClient 生成礼貌通用回复
 *                     注意：missing client 时**优雅降级到拒答**（不抛错）——
 *                     不同于 embedding/storage/citation 的"missing 即 fail"模式
 *
 * 触发条件：matches.length < minMatchCount 或 topScore < minScore
 */

export const FallbackMethodId = z.enum(["reject-answer", "generic-response"]);
export type FallbackMethodId = z.infer<typeof FallbackMethodId>;

export const FallbackParamsSchema = z.object({
  minMatchCount: z.number().int().min(0).optional().default(1),
  minScore: z.number().min(0).max(1).optional().default(0.3),
  message: z.string().optional().default("抱歉，我目前没有足够的信息来回答这个问题。"),
  model: z.string().optional().default("gpt-4o-mini"),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});
export type FallbackParams = z.infer<typeof FallbackParamsSchema>;

export interface FallbackOutput {
  /** true = 触发降级，false = 透传上游 */
  triggered: boolean;
  triggerReason: string;
  /** 触发时的降级回复（拒答 / LLM 通用回复） */
  fallbackResponse?: string;
  /** 未触发时透传 rerank 的 rankedMatches */
  rankedMatches: RankedChunk[];
  originalQuery: string;
  warnings: string[];
}

export interface FallbackTrace {
  methodId: FallbackMethodId;
  triggered: boolean;
  triggerReason: string;
  inputCount: number;
}

export interface FallbackInput {
  methodId: FallbackMethodId;
  params: FallbackParams;
  upstream: RerankOutput;
  /**
   * generic-response 时建议传入；缺失时**优雅降级到拒答 + warning**，
   * 不抛 PipelineError（区别于其他 stage 的注入语义）
   */
  llmClient?: LLMChatClient;
}

export interface FallbackResult {
  output: FallbackOutput;
  trace: FallbackTrace;
  warnings: string[];
}
