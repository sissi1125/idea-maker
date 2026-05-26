/**
 * RAG Pipeline Stage 5 - Embedding - 纯算法
 *
 * 4 种 provider：
 *   debug-deterministic           FNV-1a 哈希向量，无外部依赖
 *   openai-3-small                需要 Input.openaiClient（路由层注入）
 *   hf-tei-embedding              需要 Input.hfTeiEndpoint（路由层从 env 读）
 *   hf-transformers-js-embedding  Node.js 本地推理（首次下载模型）
 *
 * I/O 注入设计：
 *   rag-core 不读 env、不创建 OpenAI 实例。所有外部依赖通过 Input 字段传入。
 *   openai-3-small 缺 openaiClient → PipelineError("missing_client")
 *   hf-tei-embedding 缺 endpoint → PipelineError("missing_endpoint")
 *
 * 为什么 embedding 用 enhancedText 而非 text：
 *   transform 注入的章节前缀让向量同时携带"这段属于哪个章节"，
 *   检索时与 query 的余弦相似度更高。检索结果展示时仍用 text（无注入噪音）。
 */

import type {
  EmbeddingInput,
  EmbeddingInputChunk,
  EmbeddingMethodId,
  EmbeddingResult,
  EmbeddedChunk,
  OpenAICompatibleClient,
} from "@harness/shared-types";
import { PipelineError } from "../errors";
import { embedBatch } from "../util/openai-embed";

// ─── debug-deterministic ──────────────────────────────────────────────────────

/**
 * FNV-1a 哈希展开到 dimension 个分量，归一化为单位向量。
 * 同一文本 → 同一向量（确定性），不携带语义信息。
 * 单测和流程验证场景使用。
 */
function debugDeterministicEmbed(text: string, dimension: number): number[] {
  const raw: number[] = [];
  for (let i = 0; i < dimension; i++) {
    let h = 2166136261 ^ (i * 16777619); // i 作 seed 让每个分量不同
    for (let j = 0; j < text.length; j++) {
      h ^= text.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    raw.push(((h >>> 0) / 0xffffffff) * 2 - 1);
  }
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
  return raw.map((v) => parseFloat((v / norm).toFixed(6)));
}

// ─── openai-3-small ───────────────────────────────────────────────────────────

async function embedOpenAI(
  chunks: EmbeddingInputChunk[],
  model: string,
  dimension: number,
  batchSize: number,
  client: OpenAICompatibleClient,
): Promise<{ vectors: number[][]; batchCount: number; costEstimate: string }> {
  // transform 禁用时 enhancedText 为 undefined，回退到 text
  const texts = chunks.map((c) => c.enhancedText ?? c.text);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // OpenAICompatibleClient 结构与真实 OpenAI client 兼容，cast 安全
    const batchVecs = await embedBatch(
      batch,
      model,
      dimension,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
    );
    vectors.push(...batchVecs);
    batchCount++;
  }

  const totalTokens = chunks.reduce(
    (s, c) => s + (c.enhancedTokenEstimate ?? c.tokenEstimate),
    0,
  );
  const costUSD = ((totalTokens / 1_000_000) * 0.02).toFixed(5);
  const costEstimate = `~$${costUSD} (${totalTokens} tokens × $0.02/1M，仅供参考)`;

  return { vectors, batchCount, costEstimate };
}

// ─── hf-tei-embedding ─────────────────────────────────────────────────────────

/**
 * HuggingFace Text Embeddings Inference（TEI）HTTP 接口
 * 部署：docker run -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:cpu-1.5 \
 *      --model-id BAAI/bge-small-en-v1.5
 */
async function embedHFTEI(
  chunks: EmbeddingInputChunk[],
  batchSize: number,
  endpoint: string,
): Promise<{ vectors: number[][]; batchCount: number }> {
  const normalized = endpoint.replace(/\/$/, "");
  const texts = chunks.map((c) => c.enhancedText ?? c.text);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const resp = await fetch(`${normalized}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch }),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new PipelineError(
        "provider_error",
        `TEI 服务返回错误 ${resp.status}: ${msg}`,
      );
    }
    // TEI /embed 返回 float32[][] 或 { embeddings: float32[][] }
    const data = (await resp.json()) as number[][] | { embeddings: number[][] };
    const batchVectors = Array.isArray(data) ? data : data.embeddings;
    vectors.push(...batchVectors);
    batchCount++;
  }

  return { vectors, batchCount };
}

// ─── hf-transformers-js ───────────────────────────────────────────────────────

/**
 * @huggingface/transformers Node.js 本地推理。
 * 首次调用从 HuggingFace Hub 下载模型（20-80MB，缓存到 ~/.cache/huggingface）。
 * 离线友好但首次启动慢。
 */
async function embedTransformersJS(
  chunks: EmbeddingInputChunk[],
  modelId: string,
  batchSize: number,
): Promise<{ vectors: number[][]; batchCount: number }> {
  // 动态 import：transformers 包体积大，避免影响其他 provider 启动
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;

  const extractor = await pipeline("feature-extraction", modelId, { dtype: "fp32" });

  const texts = chunks.map((c) => c.enhancedText ?? c.text);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // mean_pooling + normalize = 标准 sentence embedding 做法
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    const list = output.tolist() as number[][];
    vectors.push(...list);
    batchCount++;
  }

  return { vectors, batchCount };
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL: Record<EmbeddingMethodId, string> = {
  "debug-deterministic": "debug-deterministic",
  "openai-3-small": "text-embedding-v4",
  "hf-tei-embedding": "BAAI/bge-small-en-v1.5",
  "hf-transformers-js-embedding": "Xenova/all-MiniLM-L6-v2",
};

export async function runEmbedding(input: EmbeddingInput): Promise<EmbeddingResult> {
  const { methodId, params, upstreamChunks, openaiClient, hfTeiEndpoint } = input;

  if (!upstreamChunks || upstreamChunks.length === 0) {
    throw new PipelineError("empty_chunks", "上游未产出任何 chunk");
  }

  const { dimension, batchSize, model } = params;
  const warnings: string[] = [];
  let vectors: number[][] = [];
  let batchCount = 1;
  let costEstimate = "";
  const resolvedModel = model || DEFAULT_MODEL[methodId];

  switch (methodId) {
    case "debug-deterministic":
      vectors = upstreamChunks.map((c) =>
        debugDeterministicEmbed(c.enhancedText ?? c.text, dimension),
      );
      warnings.push(
        "debug-deterministic 向量不携带语义，仅用于流程验证。生产环境请换用真实 embedding provider。",
      );
      break;

    case "openai-3-small": {
      if (!openaiClient) {
        throw new PipelineError(
          "missing_client",
          "openai-3-small 需要注入 OpenAI client；路由层应通过 createEmbeddingClient 创建后传入 Input.openaiClient",
        );
      }
      const result = await embedOpenAI(upstreamChunks, resolvedModel, dimension, batchSize, openaiClient);
      vectors = result.vectors;
      batchCount = result.batchCount;
      costEstimate = result.costEstimate;
      break;
    }

    case "hf-tei-embedding": {
      const endpoint = params.endpoint?.trim() || hfTeiEndpoint;
      if (!endpoint) {
        throw new PipelineError(
          "missing_endpoint",
          "hf-tei-embedding 需要 endpoint；请在表单填写或设置 HF_TEI_ENDPOINT 环境变量",
        );
      }
      const result = await embedHFTEI(upstreamChunks, batchSize, endpoint);
      vectors = result.vectors;
      batchCount = result.batchCount;
      break;
    }

    case "hf-transformers-js-embedding": {
      const result = await embedTransformersJS(upstreamChunks, resolvedModel, batchSize);
      vectors = result.vectors;
      batchCount = result.batchCount;
      break;
    }
  }

  // 数量校验：向量数 === chunk 数
  if (vectors.length !== upstreamChunks.length) {
    throw new PipelineError(
      "vector_count_mismatch",
      `向量数量 ${vectors.length} 与 chunk 数量 ${upstreamChunks.length} 不匹配`,
    );
  }

  const actualDimension = vectors[0]?.length ?? dimension;
  if (actualDimension !== dimension && methodId !== "debug-deterministic") {
    warnings.push(
      `实际向量维度 ${actualDimension} 与配置维度 ${dimension} 不一致，已使用实际维度`,
    );
  }

  const embeddedChunks: EmbeddedChunk[] = upstreamChunks.map((c, i) => ({
    ...c,
    embedding: vectors[i],
    embeddingDimension: vectors[i].length,
  }));

  const totalTokensEstimated = upstreamChunks.reduce(
    (s, c) => s + (c.enhancedTokenEstimate ?? c.tokenEstimate),
    0,
  );

  return {
    output: {
      chunks: embeddedChunks,
      chunkCount: embeddedChunks.length,
      dimension: actualDimension,
      provider: methodId,
      model: resolvedModel,
      totalTokensEstimated,
      batchCount,
      costEstimate,
      warnings,
    },
    trace: {
      methodId,
      chunkCount: upstreamChunks.length,
      dimension: actualDimension,
      batchCount,
      totalTokensEstimated,
    },
    warnings,
  };
}
