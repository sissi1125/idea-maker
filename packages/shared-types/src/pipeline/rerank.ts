/**
 * Rerank - 共享 canonical 类型
 *
 * 本文件目前仅定义 RankedChunk + RerankOutput 两个被下游 citation /
 * prompt-build 共用的核心类型；rerank stage 的完整 schema 将在
 * rerank stage 抽取时（feat-100.2 后续 commit）补全。
 *
 * 沿用 retrieval.ts / chunk.ts 同样的"先定义 canonical 类型，
 * 后续抽取时复用"模式。
 */

import type { FilteredChunk } from "./filter";

export interface RankedChunk extends FilteredChunk {
  rerankScore: number;
  originalRank: number;
  newRank: number;
}

export interface RerankOutput {
  originalQuery?: string;
  rankedMatches: RankedChunk[];
  /** 重排前后对比，用于 Playground 展示 */
  rankChanges: Array<{
    chunkId: string;
    sourceRef: string;
    originalRank: number;
    newRank: number;
    delta: number;
  }>;
  method: string;
  warnings: string[];
}
