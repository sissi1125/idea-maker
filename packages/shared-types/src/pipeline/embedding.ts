import { z } from "zod";
import type { Chunk } from "./chunk";
// 注意：不在 shared-types 直接 import OpenAI（让 shared-types 保持 framework-zero 依赖）。
// 用结构化 type 表示注入的 client（用 rag-core 的真实 OpenAI 类型会引入 openai 包 dep）。
//
// 路由层和 rag-core 都把传入的 client 强制 cast 成此类型；只要 cast 来源是 OpenAI 实例就 OK。
//
// 这是一个常见的 monorepo schema 包"零依赖"模式：用最小化结构 type 替代具体 class 引用。

/**
 * Embedding - 共享类型定义
 *
 * 4 种 provider：
 *   openai-3-small                OpenAI-compatible API（含 Qwen / DashScope）
 *                                 路由层创建 OpenAI client 后通过 Input.openaiClient 注入
 *
 *   hf-tei-embedding              HuggingFace Text Embeddings Inference 自托管服务
 *                                 路由层从 env HF_TEI_ENDPOINT 读取 URL 注入
 *
 *   hf-transformers-js-embedding  @huggingface/transformers Node.js 本地推理
 *                                 首次下载模型到 ~/.cache/huggingface，离线友好
 *
 *   debug-deterministic           FNV-1a 哈希确定性向量，无外部依赖
 *                                 仅用于流程验证，不携带真实语义
 */

export const EmbeddingMethodId = z.enum([
  "debug-deterministic",
  "openai-3-small",
  "hf-tei-embedding",
  "hf-transformers-js-embedding",
]);
export type EmbeddingMethodId = z.infer<typeof EmbeddingMethodId>;

export const EmbeddingParamsSchema = z.object({
  model: z.string().optional().default(""),
  dimension: z.number().int().min(1).optional().default(4),
  batchSize: z.number().int().min(1).optional().default(10),
  // openai-3-small：用户表单可覆盖 env
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  // hf-tei-embedding：用户表单可覆盖 env
  endpoint: z.string().optional(),
});
export type EmbeddingParams = z.infer<typeof EmbeddingParamsSchema>;

/**
 * embedding 上游可能来自 transform（有 enhancedText 等增强字段）
 * 或直接来自 chunk（无增强）。所以增强字段都是 optional。
 */
export interface EmbeddingInputChunk extends Chunk {
  enhancedText?: string;
  enhancedTokenEstimate?: number;
  injectedPrefix?: string;
  keywords?: string[];
  summary?: string;
}

/** embedding 后的 chunk */
export interface EmbeddedChunk extends EmbeddingInputChunk {
  embedding: number[];
  embeddingDimension: number;
}

export interface EmbeddingOutput {
  chunks: EmbeddedChunk[];
  chunkCount: number;
  dimension: number;
  provider: EmbeddingMethodId;
  model: string;
  totalTokensEstimated: number;
  batchCount: number;
  /** OpenAI 类 provider 的成本估算字符串，其他空 */
  costEstimate: string;
  warnings: string[];
}

export interface EmbeddingTrace {
  methodId: EmbeddingMethodId;
  chunkCount: number;
  dimension: number;
  batchCount: number;
  totalTokensEstimated: number;
}

/**
 * 路由层注入的 OpenAI client 的最小结构契约。
 * 真实使用时传入 `import OpenAI from "openai"` 的实例，结构兼容。
 */
export interface OpenAICompatibleClient {
  embeddings: {
    create(req: {
      model: string;
      input: string | string[];
      dimensions?: number;
    }): Promise<{
      data: Array<{ embedding: number[]; index: number }>;
    }>;
  };
}

export interface EmbeddingInput {
  methodId: EmbeddingMethodId;
  params: EmbeddingParams;
  upstreamChunks: EmbeddingInputChunk[];
  /** openai-3-small 时必传；路由层用 createEmbeddingClient 创建后注入 */
  openaiClient?: OpenAICompatibleClient;
  /** hf-tei-embedding 时必传；路由层从 process.env.HF_TEI_ENDPOINT 读 */
  hfTeiEndpoint?: string;
}

export interface EmbeddingResult {
  output: EmbeddingOutput;
  trace: EmbeddingTrace;
  warnings: string[];
}
