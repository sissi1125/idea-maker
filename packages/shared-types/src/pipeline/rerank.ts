import { z } from "zod";
import type { FilteredChunk } from "./filter";
import type { LLMChatClient } from "./query-rewrite";

/**
 * Rerank - 共享类型定义
 *
 * 5 method（覆盖从规则到 LLM 的全光谱）：
 *   score-only            按 filter 分数排序（基线对照）
 *   metadata-boost        sourceRef + text 命中 query 关键词加权（规则驱动）
 *   hf-tei-rerank         注入 HF TEI Cross-encoder /rerank endpoint
 *   llm-relevance-rerank  注入 LLMChatClient，每 chunk 单独打 1-10 分
 *   pipeline-rerank       两步：Metadata Boost → TEI（混合策略）
 */

export const RerankMethodId = z.enum([
  "score-only",
  "metadata-boost",
  "hf-tei-rerank",
  "llm-relevance-rerank",
  "pipeline-rerank",
]);
export type RerankMethodId = z.infer<typeof RerankMethodId>;

export const RerankParamsSchema = z.object({
  rerankTopN: z.number().int().min(1).max(50).optional().default(5),
  /** pipeline-rerank: Boost 后送入 TEI 的候选数 */
  boostPassN: z.number().int().min(1).max(100).optional().default(20),
  /** llm-relevance-rerank */
  model: z.string().optional().default("gpt-4o-mini"),
  criteria: z.string().optional().default(""),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  /** hf-tei-rerank / pipeline-rerank */
  endpoint: z.string().optional(),
  /** query 优先来自上游 originalQuery；params.query 是手动覆盖入口 */
  query: z.string().optional().default(""),
});
export type RerankParams = z.infer<typeof RerankParamsSchema>;

/** RankedChunk + RerankOutput 是 canonical 共享类型；citation / prompt-build 依赖 */
export interface RankedChunk extends FilteredChunk {
  rerankScore: number;
  originalRank: number;
  newRank: number;
}

export interface RankChange {
  chunkId: string;
  sourceRef: string;
  originalRank: number;
  newRank: number;
  delta: number;
}

export interface RerankOutput {
  originalQuery?: string;
  rankedMatches: RankedChunk[];
  rankChanges: RankChange[];
  method: RerankMethodId | string;
  warnings: string[];
}

export interface RerankTrace {
  methodId: RerankMethodId;
  inputCount: number;
  outputCount: number;
  topN: number;
  /** 仅 pipeline-rerank：Boost 后总数 + 送 TEI 的数 */
  pipelineSteps?: { afterBoost: number; sentToTEI: number };
}

export interface RerankInput {
  methodId: RerankMethodId;
  params: RerankParams;
  upstreamMatches: FilteredChunk[];
  /** 上游 filter.originalQuery 优先；为空则用 params.query */
  upstreamQuery?: string;
  /** hf-tei-rerank / pipeline-rerank 必传 */
  hfTeiEndpoint?: string;
  /** llm-relevance-rerank 必传 */
  llmClient?: LLMChatClient;
}

export interface RerankResult {
  output: RerankOutput;
  trace: RerankTrace;
  warnings: string[];
}
