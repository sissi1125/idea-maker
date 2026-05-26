import { z } from "zod";
import type { MatchedChunk } from "./retrieval";

/**
 * Filter - 共享类型定义
 *
 * 4 method：
 *   score-threshold   按分数下限 + 每文档上限过滤
 *   metadata-filter   按 sourceRef 路径前缀白名单过滤
 *   mmr-diversity     MMR + Jaccard 词集多样性过滤
 *   pipeline-filter   Metadata → Score → MMR 三步串联（工业标准组合）
 */

export const FilterMethodId = z.enum([
  "score-threshold",
  "metadata-filter",
  "mmr-diversity",
  "pipeline-filter",
]);
export type FilterMethodId = z.infer<typeof FilterMethodId>;

export const FilterParamsSchema = z.object({
  minScore: z.number().min(0).max(1).optional().default(0.6),
  maxPerDocument: z.number().int().min(1).optional().default(3),
  requiredSourceTypes: z.array(z.string()).optional().default([]),
  mmrLambda: z.number().min(0).max(1).optional().default(0.5),
  finalTopK: z.number().int().min(1).optional().default(10),
});
export type FilterParams = z.infer<typeof FilterParamsSchema>;

export interface FilteredChunk extends MatchedChunk {
  filteredRank: number;
}

export interface RemovedChunk {
  chunkId: string;
  text: string;
  score: number;
  reason: string;
}

export interface FilterOutput {
  originalQuery?: string;
  filteredMatches: FilteredChunk[];
  removedMatches: RemovedChunk[];
  keptCount: number;
  removedCount: number;
  method: FilterMethodId;
  warnings: string[];
  /** 仅 pipeline-filter：各步骤后的剩余数量 */
  pipelineSteps?: { afterMetadata: number; afterScore: number; afterMMR: number };
}

export interface FilterTrace {
  methodId: FilterMethodId;
  inputCount: number;
  keptCount: number;
  removedCount: number;
  pipelineSteps?: { afterMetadata: number; afterScore: number; afterMMR: number };
}

export interface FilterInput {
  methodId: FilterMethodId;
  params: FilterParams;
  upstreamMatches: MatchedChunk[];
  originalQuery: string;
  upstreamWarnings?: string[];
}

export interface FilterResult {
  output: FilterOutput;
  trace: FilterTrace;
  warnings: string[];
}
