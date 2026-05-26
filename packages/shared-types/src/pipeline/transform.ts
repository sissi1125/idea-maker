import { z } from "zod";
import type { Chunk } from "./chunk";

/**
 * Chunk Transform - 共享类型定义
 *
 * 3 种 method：
 *   none              透传，不修改 chunk
 *   heading-context   chunk 前缀注入文档标题 + sourceRef 路径
 *                     让 embedding 同时编码"这段属于哪一章"
 *   summary-keywords  jieba TF 提取关键词 + 句子截取摘要，拼到 chunk 末尾
 *                     纯本地计算，不调 LLM
 */

export const TransformMethodId = z.enum([
  "none",
  "heading-context",
  "summary-keywords",
]);
export type TransformMethodId = z.infer<typeof TransformMethodId>;

export const TransformParamsSchema = z.object({
  // heading-context
  includeTitle: z.boolean().optional().default(true),
  includeHeadingPath: z.boolean().optional().default(true),
  documentTitle: z.string().optional().default(""),
  // summary-keywords
  keywordCount: z.number().int().min(1).optional().default(5),
  summaryMaxTokens: z.number().int().min(5).optional().default(100),
  appendToChunk: z.boolean().optional().default(true),
});
export type TransformParams = z.infer<typeof TransformParamsSchema>;

/** 输入 chunk 直接复用 chunk stage 定义的 Chunk 类型 */
export type TransformInputChunk = Chunk;

/** 增强后的 chunk */
export interface TransformedChunk extends Chunk {
  /** 增强后的文本，供 embedding 使用（不替换原始 text） */
  enhancedText: string;
  /** 本次 transform 注入的前缀内容（none/summary-keywords 时为空） */
  injectedPrefix: string;
  /** 关键词列表（summary-keywords 方法） */
  keywords: string[];
  /** 摘要（summary-keywords 方法） */
  summary: string;
  /** 增强后的 token 估算 */
  enhancedTokenEstimate: number;
}

export interface TransformOutput {
  chunks: TransformedChunk[];
  chunkCount: number;
  method: TransformMethodId;
  /** 实际被注入内容的 chunk 数（none 方法为 0） */
  transformedCount: number;
  warnings: string[];
}

export interface TransformTrace {
  method: TransformMethodId;
  inputChunkCount: number;
  transformedCount: number;
  avgEnhancedTokens: number;
}

export interface TransformInput {
  methodId: TransformMethodId;
  params: TransformParams;
  upstreamChunks: TransformInputChunk[];
}

export interface TransformResult {
  output: TransformOutput;
  trace: TransformTrace;
  warnings: string[];
}
