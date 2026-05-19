/**
 * RAG Pipeline Stage 5 - Embedding（向量化）
 *
 * 作用：将 Transform 阶段产出的 enhancedText 转成向量，供向量数据库存储和检索。
 *
 * Pipeline 位置：
 *   Transform → [Embedding] → Storage
 *
 * 四种 provider：
 *
 *   openai-3-small          调用 OpenAI /v1/embeddings API，模型 text-embedding-3-small
 *                            需要环境变量 OPENAI_API_KEY
 *                            默认维度 1536；支持 dimensions 参数降维（节省存储 + 加速检索）
 *
 *   hf-tei-embedding        调用自托管 HuggingFace TEI（Text Embeddings Inference）服务
 *                            需要环境变量 HF_TEI_ENDPOINT，例如 http://localhost:8080
 *                            与 OpenAI 接口格式兼容（/embed endpoint）
 *
 *   hf-transformers-js      使用 @huggingface/transformers 在 Node.js 本地推理
 *                            首次运行时自动下载模型（缓存到 ~/.cache/huggingface）
 *                            不需要 API Key，适合离线调试
 *
 *   debug-deterministic     基于文本哈希生成确定性向量，无需任何外部服务
 *                            同一文本始终产出相同向量（便于测试端到端流程）
 *                            向量仅用于流程验证，无真实语义
 *
 * 为什么 embedding 要用 enhancedText 而非原始 text？
 *   Transform 阶段注入的标题前缀/关键词后缀让向量携带更多上下文语义，
 *   与 query 向量的余弦相似度更高，召回率更好。
 *   检索结果返回给用户时仍展示原始 text（无注入噪音）。
 */

import { NextRequest, NextResponse } from "next/server";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface TransformedChunk {
  index: number;
  text: string;
  enhancedText: string;
  charCount: number;
  tokenEstimate: number;
  enhancedTokenEstimate: number;
  sourceRef: string;
  injectedPrefix: string;
  keywords: string[];
  summary: string;
}

interface TransformOutput {
  chunks: TransformedChunk[];
  chunkCount: number;
  warnings: string[];
}

export interface EmbeddedChunk extends TransformedChunk {
  /** 向量（float32 数组，长度 = dimension） */
  embedding: number[];
  embeddingDimension: number;
}

interface EmbeddingOutput {
  chunks: EmbeddedChunk[];
  chunkCount: number;
  dimension: number;
  provider: string;
  model: string;
  /** 所有 chunk 的 enhancedToken 总计（用于估算 OpenAI 费用） */
  totalTokensEstimated: number;
  /** 实际发出的 batch 次数（debug 始终为 1） */
  batchCount: number;
  /** OpenAI 成本估算字符串，其他 provider 为空字符串 */
  costEstimate: string;
  warnings: string[];
}

// ─── debug-deterministic ──────────────────────────────────────────────────────

/**
 * 基于 FNV-1a 哈希将文本映射到确定性单位向量。
 * 同一文本 → 同一向量（可重复），不依赖任何外部 API。
 * 向量仅保证确定性，不携带语义信息。
 */
function debugDeterministicEmbed(text: string, dimension: number): number[] {
  // FNV-1a 32-bit hash，展开到 dimension 个分量
  const raw: number[] = [];
  for (let i = 0; i < dimension; i++) {
    let h = 2166136261 ^ (i * 16777619); // 用 i 作为 seed 偏移，让每个分量不同
    for (let j = 0; j < text.length; j++) {
      h ^= text.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    // 转为 [-1, 1] 范围
    raw.push(((h >>> 0) / 0xffffffff) * 2 - 1);
  }
  // 归一化为单位向量（余弦相似度的标准做法）
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
  return raw.map((v) => parseFloat((v / norm).toFixed(6)));
}

// ─── openai-3-small ───────────────────────────────────────────────────────────

async function embedOpenAI(
  chunks: TransformedChunk[],
  model: string,
  dimension: number,
  batchSize: number,
  /** 表单临时填写的 key，优先于环境变量 */
  paramApiKey?: string
): Promise<{ vectors: number[][]; batchCount: number; costEstimate: string }> {
  const apiKey = paramApiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 OpenAI API Key：请在表单 \"API Key\" 字段中填写，或设置 OPENAI_API_KEY 环境变量后重启 dev server"
    );
  }

  // 动态 import，避免在非 OpenAI provider 时加载 SDK
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const texts = chunks.map((c) => c.enhancedText);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const resp = await client.embeddings.create({
      model,
      input: batch,
      // text-embedding-3-* 支持 dimensions 参数降维；旧模型不支持，需忽略
      ...(model.startsWith("text-embedding-3") ? { dimensions: dimension } : {}),
    });
    // OpenAI 按 index 返回，顺序与输入一致
    resp.data.sort((a, b) => a.index - b.index);
    vectors.push(...resp.data.map((d) => d.embedding));
    batchCount++;
  }

  // text-embedding-3-small 定价：$0.02 / 1M tokens（2024 年）
  const totalTokens = chunks.reduce((s, c) => s + c.enhancedTokenEstimate, 0);
  const costUSD = ((totalTokens / 1_000_000) * 0.02).toFixed(5);
  const costEstimate = `~$${costUSD} (${totalTokens} tokens × $0.02/1M)`;

  return { vectors, batchCount, costEstimate };
}

// ─── hf-tei-embedding ─────────────────────────────────────────────────────────

/**
 * HuggingFace Text Embeddings Inference（TEI）HTTP 接口
 * 部署方式：docker run -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:cpu-1.5 --model-id BAAI/bge-small-en-v1.5
 * endpoint 形如 http://localhost:8080
 */
async function embedHFTEI(
  chunks: TransformedChunk[],
  batchSize: number,
  /** 表单临时填写的 endpoint，优先于环境变量 */
  paramEndpoint?: string
): Promise<{ vectors: number[][]; batchCount: number }> {
  const endpoint = (paramEndpoint?.trim() || process.env.HF_TEI_ENDPOINT)?.replace(/\/$/, "");
  if (!endpoint) {
    throw new Error(
      "缺少 TEI Endpoint：请在表单 \"TEI Endpoint\" 字段中填写，或设置 HF_TEI_ENDPOINT 环境变量后重启 dev server"
    );
  }

  const texts = chunks.map((c) => c.enhancedText);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const resp = await fetch(`${endpoint}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch }),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`TEI 服务返回错误 ${resp.status}: ${msg}`);
    }
    // TEI /embed 返回 float32[][] 或 { embeddings: float32[][] }
    const data = await resp.json() as number[][] | { embeddings: number[][] };
    const batch_vectors = Array.isArray(data) ? data : data.embeddings;
    vectors.push(...batch_vectors);
    batchCount++;
  }

  return { vectors, batchCount };
}

// ─── hf-transformers-js ───────────────────────────────────────────────────────

/**
 * 使用 @huggingface/transformers 在 Node.js 本地推理。
 * 首次调用会从 HuggingFace Hub 下载模型（约 20–80MB，缓存后不再下载）。
 * 适合开发阶段本地测试，不需要任何 API Key。
 */
async function embedTransformersJS(
  chunks: TransformedChunk[],
  modelId: string,
  batchSize: number
): Promise<{ vectors: number[][]; batchCount: number }> {
  // 动态 import：@huggingface/transformers 体积大，避免影响其他 provider 启动
  const { pipeline, env } = await import("@huggingface/transformers");

  // 禁用浏览器端 WASM fallback，强制使用 Node.js native ort
  env.allowLocalModels = false;

  const extractor = await pipeline("feature-extraction", modelId, {
    dtype: "fp32",
  });

  const texts = chunks.map((c) => c.enhancedText);
  const vectors: number[][] = [];
  let batchCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // mean_pooling + normalize = 标准 sentence embedding 做法
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    // output 是 Tensor，tolist() 返回 number[][]
    const list = output.tolist() as number[][];
    vectors.push(...list);
    batchCount++;
  }

  return { vectors, batchCount };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: TransformOutput | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 }
    );
  }

  const { methodId, params, upstreamOutput } = body;

  if (!upstreamOutput) {
    return NextResponse.json(
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 Transform 产物，请先成功运行 Transform Stage",
        },
      },
      { status: 400 }
    );
  }

  const { chunks } = upstreamOutput;
  if (!chunks || chunks.length === 0) {
    return NextResponse.json(
      { error: { code: "empty_chunks", message: "上游 Transform 未产出任何 chunk" } },
      { status: 400 }
    );
  }

  const dimension = Number(params.dimension ?? 4);
  const batchSize = Number(params.batchSize ?? 10);
  const model = String(params.model ?? "");
  const paramApiKey = typeof params.apiKey === "string" ? params.apiKey : undefined;
  const paramEndpoint = typeof params.endpoint === "string" ? params.endpoint : undefined;
  const warnings: string[] = [];

  try {
    let vectors: number[][] = [];
    let batchCount = 1;
    let costEstimate = "";
    let resolvedModel = model;

    switch (methodId) {
      case "debug-deterministic": {
        resolvedModel = "debug-deterministic";
        vectors = chunks.map((c) => debugDeterministicEmbed(c.enhancedText, dimension));
        warnings.push(
          "debug-deterministic 向量不携带语义，仅用于流程验证。生产环境请换用真实 embedding provider。"
        );
        break;
      }

      case "openai-3-small": {
        resolvedModel = model || "text-embedding-3-small";
        const result = await embedOpenAI(chunks, resolvedModel, dimension, batchSize, paramApiKey);
        vectors = result.vectors;
        batchCount = result.batchCount;
        costEstimate = result.costEstimate;
        break;
      }

      case "hf-tei-embedding": {
        resolvedModel = model || "BAAI/bge-small-en-v1.5";
        const result = await embedHFTEI(chunks, batchSize, paramEndpoint);
        vectors = result.vectors;
        batchCount = result.batchCount;
        break;
      }

      case "hf-transformers-js-embedding": {
        resolvedModel = model || "Xenova/all-MiniLM-L6-v2";
        const result = await embedTransformersJS(chunks, resolvedModel, batchSize);
        vectors = result.vectors;
        batchCount = result.batchCount;
        break;
      }

      default:
        return NextResponse.json(
          { error: { code: "unknown_method", message: `未知方法: ${methodId}` } },
          { status: 400 }
        );
    }

    // 校验：向量数量必须与 chunk 数量一致
    if (vectors.length !== chunks.length) {
      return NextResponse.json(
        {
          error: {
            code: "vector_count_mismatch",
            message: `向量数量 ${vectors.length} 与 chunk 数量 ${chunks.length} 不匹配`,
          },
        },
        { status: 500 }
      );
    }

    const actualDimension = vectors[0]?.length ?? dimension;
    if (actualDimension !== dimension && methodId !== "debug-deterministic") {
      warnings.push(
        `实际向量维度 ${actualDimension} 与配置维度 ${dimension} 不一致，已使用实际维度`
      );
    }

    const embeddedChunks: EmbeddedChunk[] = chunks.map((c, i) => ({
      ...c,
      embedding: vectors[i],
      embeddingDimension: vectors[i].length,
    }));

    const totalTokensEstimated = chunks.reduce(
      (s, c) => s + c.enhancedTokenEstimate,
      0
    );

    const output: EmbeddingOutput = {
      chunks: embeddedChunks,
      chunkCount: embeddedChunks.length,
      dimension: actualDimension,
      provider: methodId,
      model: resolvedModel,
      totalTokensEstimated,
      batchCount,
      costEstimate,
      warnings,
    };

    return NextResponse.json({
      output,
      trace: {
        methodId,
        chunkCount: chunks.length,
        dimension: actualDimension,
        batchCount,
        totalTokensEstimated,
        durationMs: Date.now() - startMs,
      },
      durationMs: Date.now() - startMs,
      warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "embedding_failed", message } },
      { status: 500 }
    );
  }
}
