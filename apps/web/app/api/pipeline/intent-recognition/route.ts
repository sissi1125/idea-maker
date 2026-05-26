/**
 * Intent Recognition - 薄路由
 *
 * 算法本体在 @harness/rag-core/retrieval/intent-recognition.ts。
 * 路由职责：参数解析 + 上游 query 回退 + LLMChatClient 注入 + 错误翻译。
 */

import { NextRequest, NextResponse } from "next/server";
import { runIntentRecognition, isPipelineError } from "@harness/rag-core";
import {
  IntentRecognitionMethodId,
  IntentRecognitionParamsSchema,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_query: 400,
  missing_client: 500,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: { query?: string } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }

  try {
    const methodId = IntentRecognitionMethodId.parse(body.methodId);
    const params = IntentRecognitionParamsSchema.parse(body.params);

    let llmClient;
    if (methodId === "llm-router") {
      const { client } = await createLLMClient(params.apiKey, params.baseUrl);
      llmClient = client;
    }

    const result = await runIntentRecognition({
      methodId,
      params,
      upstreamQuery: body.upstreamOutput?.query,
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
      { error: { code: "intent_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
