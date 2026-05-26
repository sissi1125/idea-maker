import { z } from "zod";
import type { PgClient } from "./storage";
import type { RankedChunk, RerankOutput } from "./rerank";

/**
 * Citation - 共享类型定义
 *
 * 4 method：
 *   chunk-citation        全文引用：chunk 原文整段进 LLM context
 *   page-aware-citation   从 sourceRef 提取页码（"第N页"/"page:N" 模式）
 *   snippet-citation      关键词窗口截取（压缩 token）
 *   section-citation      pg 反查同 sourceRef / 相邻 chunk，扩展上下文
 *                         （等价 parent-child chunking，不改 schema）
 *
 * Evidence Pack 设计：每条 evidence 含稳定 evidenceId（{docId}_v{ver}_c{idx}），
 * LLM 生成时 cite evidenceId，后端可追溯到原始 chunk。
 */

export const CitationMethodId = z.enum([
  "chunk-citation",
  "page-aware-citation",
  "snippet-citation",
  "section-citation",
]);
export type CitationMethodId = z.infer<typeof CitationMethodId>;

export const CitationExpansionMode = z.enum(["adjacent", "section"]);
export type CitationExpansionMode = z.infer<typeof CitationExpansionMode>;

export const CitationParamsSchema = z.object({
  maxEvidencePerClaim: z.number().int().min(1).optional().default(3),
  includePage: z.boolean().optional().default(true),
  snippetLength: z.number().int().min(50).optional().default(200),
  query: z.string().optional().default(""),
  expansionMode: CitationExpansionMode.optional().default("section"),
  /** section-citation 时路由层从 env / 表单解析后注入 pgClient */
  connectionString: z.string().optional(),
});
export type CitationParams = z.infer<typeof CitationParamsSchema>;

export interface EvidenceItem {
  /** 稳定 ID：{documentId}_v{version}_c{chunkIndex} */
  evidenceId: string;
  text: string;
  sourceRef: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  /** 提取失败为 null */
  pageNumber: number | null;
  /** rerank 分数（供 LLM 判断 evidence 可信度） */
  score: number;
  /** snippet-citation 专用 */
  snippet?: string;
}

export interface CitationOutput {
  originalQuery?: string;
  evidencePack: EvidenceItem[];
  totalEvidence: number;
  method: CitationMethodId;
  /** 供 prompt-build 直接拼接的 context（含 evidence-XXX 标注） */
  contextText: string;
  warnings: string[];
}

export interface CitationTrace {
  methodId: CitationMethodId;
  inputMatches: number;
  evidenceCount: number;
  contextLength: number;
  avgEvidenceLength: number;
}

export interface CitationInput {
  methodId: CitationMethodId;
  params: CitationParams;
  upstreamMatches: RankedChunk[];
  /** 优先于 params.query，从上游 rerank.originalQuery 取 */
  originalQuery?: string;
  /** section-citation 时必传 */
  pgClient?: PgClient;
}

export interface CitationResult {
  output: CitationOutput;
  trace: CitationTrace;
  warnings: string[];
}

// Re-export 路由层会用到的 RerankOutput type
export type { RerankOutput };
