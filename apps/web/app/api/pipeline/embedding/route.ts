/**
 * RAG Pipeline Stage 5 - Embedding（向量化）- 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/embedding.ts。
 * 路由职责：
 *   1. 解析请求 + 校验上游 transform/chunk 输出
 *   2. openai-3-small：用 createEmbeddingClient（读 env / 表单）创建 client，注入到 rag-core
 *   3. hf-tei-embedding：从 env 读 HF_TEI_ENDPOINT，注入到 rag-core
 *   4. 包装 trace.durationMs，翻译 PipelineError 为 HTTP envelope
 */

import { NextRequest, NextResponse } from "next/server";
import { runEmbedding, isPipelineError } from "@harness/rag-core";
import {
  EmbeddingMethodId,
  EmbeddingParamsSchema,
  type EmbeddingInputChunk,
} from "@harness/shared-types";
import { createEmbeddingClient } from "@/lib/providers";

interface UpstreamOutput {
  chunks: EmbeddingInputChunk[];
}

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_chunks: 400,
  missing_client: 400,
  missing_endpoint: 400,
  provider_error: 502,
  vector_count_mismatch: 500,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: UpstreamOutput | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }

  const { methodId: rawMethodId, params: rawParams, upstreamOutput } = body;

  if (!upstreamOutput?.chunks?.length) {
    return NextResponse.json(
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 chunk/transform 产物，请先成功运行上游 Stage",
        },
      },
      { status: 400 },
    );
  }

  try {
    const methodId = EmbeddingMethodId.parse(rawMethodId);
    const params = EmbeddingParamsSchema.parse(rawParams ?? {});

    // openai-3-small：路由层创建 client 注入
    let openaiClient;
    if (methodId === "openai-3-small") {
      const { client } = await createEmbeddingClient(params.apiKey, params.baseUrl);
      openaiClient = client;
    }

    // hf-tei-embedding：从 env 读 endpoint
    const hfTeiEndpoint = process.env.HF_TEI_ENDPOINT;

    const result = await runEmbedding({
      methodId,
      params,
      upstreamChunks: upstreamOutput.chunks,
      openaiClient,
      hfTeiEndpoint,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    if (isPipelineError(err)) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, ...(err.details ?? {}) } },
        { status: PIPELINE_ERROR_STATUS[err.code] ?? 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "embedding_failed", message } },
      { status: 500 },
    );
  }
}
