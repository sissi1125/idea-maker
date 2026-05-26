import { z } from "zod";
import type { OpenAICompatibleClient } from "./embedding";
import type { PgClient } from "./storage";

/**
 * Retrieval - 共享类型定义
 *
 * 5 method（覆盖稀疏 / 稠密 / 混合）：
 *   dense-vector       pgvector 余弦相似度（需要 embedding query）
 *   postgres-fulltext  pg tsvector（关键词精确匹配，对中文有限）
 *   hybrid-rrf         dense + fulltext RRF 融合
 *   bm25-chinese       jieba 分词 + 纯 JS BM25（中文友好）
 *   hybrid-bm25-rrf    dense + bm25 RRF 融合
 *
 * I/O 注入（按 method 不同需求）：
 *   pgClient        所有 method 必传
 *   openaiClient    embeddingProvider=openai 时必传
 *   hfTeiEndpoint   embeddingProvider=hf-tei 时必传
 *   （embeddingProvider=debug-deterministic 时不需要任何 client）
 *
 * MatchedChunk + RetrievalOutput 是 canonical 共享类型，下游 5+ stage 复用。
 */

export const RetrievalMethodId = z.enum([
  "dense-vector",
  "postgres-fulltext",
  "hybrid-rrf",
  "bm25-chinese",
  "hybrid-bm25-rrf",
]);
export type RetrievalMethodId = z.infer<typeof RetrievalMethodId>;

export const RetrievalEmbeddingProvider = z.enum([
  "debug-deterministic",
  "openai",
  "hf-tei",
]);
export type RetrievalEmbeddingProvider = z.infer<typeof RetrievalEmbeddingProvider>;

export const RetrievalParamsSchema = z.object({
  topK: z.number().int().min(1).max(100).optional().default(10),
  /** dense 相似度下限（hybrid 时强制 0） */
  threshold: z.number().min(0).max(1).optional().default(0.5),
  embeddingProvider: RetrievalEmbeddingProvider.optional().default("openai"),
  embeddingModel: z.string().optional().default("text-embedding-v4"),
  embeddingDimension: z.number().int().min(1).optional().default(1024),
  /** BM25 参数（k1=词频饱和度，b=长度归一化） */
  k1: z.number().min(0).optional().default(1.5),
  b: z.number().min(0).max(1).optional().default(0.75),
  /** 用户表单覆盖 env */
  connectionString: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  teiEndpoint: z.string().optional(),
});
export type RetrievalParams = z.infer<typeof RetrievalParamsSchema>;

/**
 * 检索命中的 chunk。下游 multi-recall-merge / filter / rerank / citation 都依赖。
 */
export interface MatchedChunk {
  chunkId: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  text: string;
  sourceRef: string;
  keywords: string[];
  /** 余弦相似度 / ts_rank / RRF score / BM25 / 归一化分数 */
  score: number;
  retrievalMethod: string;
}

export interface RetrievalOutput {
  originalQuery: string;
  queries: string[];
  matches: MatchedChunk[];
  totalMatches: number;
  method: RetrievalMethodId | string;
  dimension?: number;
  warnings: string[];
}

export interface RetrievalTrace {
  methodId: RetrievalMethodId;
  queryCount: number;
  matchCount: number;
  dimension?: number;
}

export interface RetrievalInput {
  methodId: RetrievalMethodId;
  params: RetrievalParams;
  /** 来自 query-rewrite.rewrittenQueries */
  queries: string[];
  /** 所有 method 必传，已 connect */
  pgClient: PgClient;
  /** embeddingProvider=openai 时必传（路由层 createEmbeddingClient 创建） */
  openaiClient?: OpenAICompatibleClient;
  /** embeddingProvider=hf-tei 时必传 */
  hfTeiEndpoint?: string;
}

export interface RetrievalResult {
  output: RetrievalOutput;
  trace: RetrievalTrace;
  warnings: string[];
}
