import { z } from "zod";

/**
 * Chunk Stage - 共享类型定义
 *
 * 4 种 method：
 *   fixed-size                  固定字符滑动窗口
 *   recursive                   LangChain RecursiveCharacterTextSplitter 思路
 *                               分隔符优先级：段落 > 换行 > 中文句终 > 空格 > 字符
 *   markdown-heading            按 MD 标题边界切分；超长章节降级 fixed-size
 *   markdown-heading-recursive  层级切分：标题边界 + 超长章节用 recursive 语义切分
 *                               （LangChain MarkdownHeader + Recursive 组合）
 */

export const ChunkMethodId = z.enum([
  "fixed-size",
  "recursive",
  "markdown-heading",
  "markdown-heading-recursive",
]);
export type ChunkMethodId = z.infer<typeof ChunkMethodId>;

export const ChunkParamsSchema = z.object({
  chunkSize: z.number().int().min(64).optional().default(512),
  overlap: z.number().int().min(0).optional().default(64),
  // recursive / hierarchical
  separators: z.array(z.string()).optional(),
  minChunkSize: z.number().int().min(0).optional().default(0),
  // markdown-heading
  headingDepth: z.number().int().min(1).max(6).optional().default(2),
});
export type ChunkParams = z.infer<typeof ChunkParamsSchema>;

/** 来自上游 preprocess 的 sourceRef */
export interface ChunkSourceRef {
  type: "heading" | "paragraph" | "page";
  value: string;
  charStart: number;
  charEnd: number;
}

/**
 * 单个 chunk 的输出。被下游 transform / embedding / storage 复用。
 *
 * 注意：本 interface 是 pipeline 内部各 stage 共享的 Chunk 形状，
 * transform 的 TransformInputChunk 应直接复用此类型，避免重复定义。
 */
export interface Chunk {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  charCount: number;
  /** chars/4 近似 token 数；中英混合场景见 estimateTokens 实现 */
  tokenEstimate: number;
  /** 命中的 sourceRef path（如 "产品介绍 > 核心功能"），无则空串 */
  sourceRef: string;
}

export interface ChunkOutput {
  chunks: Chunk[];
  chunkCount: number;
  totalChars: number;
  avgChunkSize: number;
  maxChunkSize: number;
  minChunkSize: number;
  warnings: string[];
}

export interface ChunkTrace {
  method: ChunkMethodId;
  inputChars: number;
  chunkCount: number;
  avgChunkSize: number;
  maxChunkSize: number;
  minChunkSize: number;
  params: {
    chunkSize: number;
    overlap: number;
    headingDepth: number;
    minChunkSize: number;
  };
  sourceFile: string;
}

export interface ChunkInput {
  methodId: ChunkMethodId;
  params: ChunkParams;
  /** 上游 preprocess 的 cleanText + sourceRefs + fileName */
  upstream: {
    cleanText: string;
    sourceRefs: ChunkSourceRef[];
    fileName: string;
  };
}

export interface ChunkResult {
  output: ChunkOutput;
  trace: ChunkTrace;
  warnings: string[];
}
