/**
 * Retrieval - 共享 canonical 类型
 *
 * 本文件目前仅定义 MatchedChunk + RetrievalOutput 两个被下游 5+ stage
 * 共用的核心类型；retrieval stage 的完整 schema（MethodId / ParamsSchema /
 * Input）将在 retrieval stage 抽取时（feat-100.2 后续 commit）补全。
 *
 * 这是 chunk.ts 同样的"先定义 canonical 类型，后续抽取时复用"模式。
 */

/**
 * 检索命中的 chunk。下游 multi-recall-merge / filter / rerank / citation
 * 都依赖此类型。
 */
export interface MatchedChunk {
  chunkId: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  text: string;
  sourceRef: string;
  keywords: string[];
  /** 余弦相似度（dense）/ ts_rank（fulltext）/ RRF score / 归一化分数等 */
  score: number;
  /** 来源方法标识（dense / fulltext / hybrid / rrf-merged / 等） */
  retrievalMethod: string;
}

export interface RetrievalOutput {
  /** query-rewrite 的第一个查询，下游 filter/rerank/citation 计算相关性时用 */
  originalQuery: string;
  queries: string[];
  matches: MatchedChunk[];
  totalMatches: number;
  method: string;
  dimension?: number;
  warnings: string[];
}
