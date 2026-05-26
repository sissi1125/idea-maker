import { z } from "zod";
import type { MatchedChunk, RetrievalOutput } from "./retrieval";

/**
 * Multi-Recall Merge - 多路召回合并 / 去重
 *
 * Pipeline 触发条件：runtimeContext.multipleRetrievalSources = true
 * 或手动启用对单路结果做归一化处理。
 *
 * 2 method：
 *   rrf-merge    按 retrievalMethod 分组重新排名 → RRF 融合（适合 dense + fulltext）
 *   score-merge  Min-Max 归一化 + 取每 chunk 最高分（适合分数量纲不同）
 */

export const MultiRecallMergeMethodId = z.enum(["rrf-merge", "score-merge"]);
export type MultiRecallMergeMethodId = z.infer<typeof MultiRecallMergeMethodId>;

export const MultiRecallMergeParamsSchema = z.object({
  topK: z.number().int().min(1).max(100).optional().default(10),
  /** RRF 的 k 参数；默认 60（业界经验值） */
  k: z.number().int().min(1).optional().default(60),
  /** 第二路（或更多路）检索结果，作为附加候选输入 */
  additionalMatches: z.array(z.unknown()).optional(),
});
export type MultiRecallMergeParams = z.infer<typeof MultiRecallMergeParamsSchema>;

export interface MultiRecallMergeOutput {
  originalQuery: string;
  queries: string[];
  matches: MatchedChunk[];
  totalMatches: number;
  /** 去重数 = 输入总数 - 输出数 */
  deduplicatedCount: number;
  method: MultiRecallMergeMethodId;
  warnings: string[];
}

export interface MultiRecallMergeTrace {
  methodId: MultiRecallMergeMethodId;
  inputCount: number;
  outputCount: number;
  deduplicatedCount: number;
}

export interface MultiRecallMergeInput {
  methodId: MultiRecallMergeMethodId;
  params: MultiRecallMergeParams;
  upstream: RetrievalOutput;
  /** 附加路检索结果（与 params.additionalMatches 二选一；路由层负责合并） */
  additionalMatches?: MatchedChunk[];
}

export interface MultiRecallMergeResult {
  output: MultiRecallMergeOutput;
  trace: MultiRecallMergeTrace;
  warnings: string[];
}
