/**
 * Fallback - 薄路由
 *
 * 算法本体在 @harness/rag-core/retrieval/fallback.ts。
 * generic-response 需要 LLMChatClient：路由层 try { createLLMClient } catch，
 * 失败时不阻塞——rag-core 内部检测到 llmClient=undefined 会优雅降级到拒答。
 */

import { NextRequest, NextResponse } from "next/server";
import { runFallback } from "@harness/rag-core";
import {
  FallbackMethodId,
  FallbackParamsSchema,
  type LLMChatClient,
  type RerankOutput,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: RerankOutput | null;
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
      { error: { code: "missing_upstream", message: "缺少上游 Rerank 产物，请先运行 Rerank Stage" } },
      { status: 400 },
    );
  }

  try {
    const methodId = FallbackMethodId.parse(body.methodId);
    const params = FallbackParamsSchema.parse(body.params);

    // generic-response 需要 LLM；失败时静默降级（rag-core 会处理 undefined）
    let llmClient: LLMChatClient | undefined;
    if (methodId === "generic-response") {
      try {
        const { client } = await createLLMClient(params.apiKey, params.baseUrl);
        llmClient = client;
      } catch {
        // 路由层 createLLMClient 失败（缺 env / key）→ 不阻塞
        // rag-core 收到 undefined client 会优雅降级（这是 fallback 的语义特性）
      }
    }

    const result = await runFallback({
      methodId,
      params,
      upstream: body.upstreamOutput,
      llmClient,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "fallback_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
