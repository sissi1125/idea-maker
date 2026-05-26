/**
 * Rerank - 薄路由
 *
 * 算法本体在 @harness/rag-core/retrieval/rerank.ts。
 * 双 provider 注入：
 *   - hf-tei-rerank / pipeline-rerank：从 env HF_TEI_ENDPOINT 注入 endpoint
 *   - llm-relevance-rerank：createLLMClient 创建 client 注入
 */

import { NextRequest, NextResponse } from "next/server";
import { runRerank, isPipelineError } from "@harness/rag-core";
import {
  RerankMethodId,
  RerankParamsSchema,
  type FilterOutput,
  type LLMChatClient,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_matches: 400,
  missing_endpoint: 400,
  missing_client: 500,
  missing_query: 400,
  provider_error: 502,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: FilterOutput | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }

  if (!body.upstreamOutput) {
    return NextResponse.json(
      { error: { code: "missing_upstream", message: "缺少上游 Filter 产物，请先运行 Filter Stage" } },
      { status: 400 },
    );
  }

  try {
    const methodId = RerankMethodId.parse(body.methodId);
    const params = RerankParamsSchema.parse(body.params);

    // 按 method 决定要注入哪种 client/endpoint
    let llmClient: LLMChatClient | undefined;
    if (methodId === "llm-relevance-rerank") {
      const { client } = await createLLMClient(params.apiKey, params.baseUrl);
      llmClient = client;
    }
    const hfTeiEndpoint = process.env.HF_TEI_ENDPOINT;

    const result = await runRerank({
      methodId,
      params,
      upstreamMatches: body.upstreamOutput.filteredMatches ?? [],
      upstreamQuery: body.upstreamOutput.originalQuery,
      hfTeiEndpoint,
      llmClient,
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
    return NextResponse.json(
      { error: { code: "rerank_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
