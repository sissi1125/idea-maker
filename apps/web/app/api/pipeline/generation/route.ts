/**
 * Generation - 薄路由
 *
 * 算法本体在 @harness/rag-core/generation/generation.ts。
 * 路由：createLLMClient → 注入 + defaultModel。
 */

import { NextRequest, NextResponse } from "next/server";
import { runGeneration, isPipelineError } from "@harness/rag-core";
import {
  GenerationMethodId,
  GenerationParamsSchema,
  type PromptBuildOutput,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_prompt: 400,
  missing_client: 500,
  api_auth_failed: 401,
  rate_limited: 429,
  invalid_model: 400,
  llm_failed: 502,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: PromptBuildOutput | null;
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
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 Prompt Build 产物，请先运行 Prompt Build Stage",
        },
      },
      { status: 400 },
    );
  }

  try {
    const methodId = GenerationMethodId.parse(body.methodId);
    const params = GenerationParamsSchema.parse(body.params);

    let llmClient, defaultModel;
    try {
      const cfg = await createLLMClient(params.apiKey, params.baseUrl);
      llmClient = cfg.client;
      defaultModel = cfg.defaultModel;
    } catch (err) {
      return NextResponse.json(
        { error: { code: "missing_api_key", message: err instanceof Error ? err.message : String(err) } },
        { status: 400 },
      );
    }

    const result = await runGeneration({
      methodId,
      params,
      upstream: body.upstreamOutput,
      llmClient,
      defaultModel,
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
        { status: PIPELINE_ERROR_STATUS[err.code] ?? 500 },
      );
    }
    return NextResponse.json(
      { error: { code: "llm_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
