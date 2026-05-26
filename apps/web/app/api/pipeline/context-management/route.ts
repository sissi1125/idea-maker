/**
 * Context Management - 薄路由
 *
 * 算法本体在 @harness/rag-core/generation/context-management.ts。
 */

import { NextRequest, NextResponse } from "next/server";
import { runContextManagement, isPipelineError } from "@harness/rag-core";
import {
  ContextManagementMethodId,
  ContextManagementParamsSchema,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_message: 400,
  missing_client: 500,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: { methodId: string; params: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }

  try {
    const methodId = ContextManagementMethodId.parse(body.methodId);
    const params = ContextManagementParamsSchema.parse(body.params);

    let llmClient;
    if (methodId === "llm-disambiguate") {
      const { client } = await createLLMClient(params.apiKey, params.baseUrl);
      llmClient = client;
    }

    const result = await runContextManagement({ methodId, params, llmClient });

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
      { error: { code: "context_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
