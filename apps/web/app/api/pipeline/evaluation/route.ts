/**
 * Evaluation - 薄路由
 *
 * 算法本体在 @harness/rag-core/generation/evaluation.ts。
 * rag-metrics-with-faithfulness 需要 LLMChatClient；rag-core 内部
 * 缺 client 时降级为纯算法 + warning（不阻塞）。
 */

import { NextRequest, NextResponse } from "next/server";
import { runEvaluation } from "@harness/rag-core";
import {
  EvaluationMethodId,
  EvaluationParamsSchema,
  type EvaluationUpstream,
  type LLMChatClient,
} from "@harness/shared-types";
import { createLLMClient } from "@/lib/providers";

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: EvaluationUpstream | null;
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
          message: "缺少上游 Generation 产物，请先运行 Generation Stage",
        },
      },
      { status: 400 },
    );
  }

  try {
    const methodId = EvaluationMethodId.parse(body.methodId);
    const params = EvaluationParamsSchema.parse(body.params);

    // rag-metrics-with-faithfulness：尝试创建 LLM client，失败不阻塞
    // （rag-core 收到 undefined 会优雅降级到纯算法 + warning）
    let llmClient: LLMChatClient | undefined;
    let defaultModel: string | undefined;
    if (methodId === "rag-metrics-with-faithfulness") {
      try {
        const cfg = await createLLMClient(params.apiKey, params.baseUrl);
        llmClient = cfg.client;
        defaultModel = cfg.defaultModel;
      } catch {
        // 缺 env 时静默；下游 warning 提示
      }
    }

    const result = await runEvaluation({
      methodId,
      params,
      upstream: body.upstreamOutput,
      llmClient,
      defaultModel,
      evidencePackMissing: !body.upstreamOutput.evidencePack,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "evaluation_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
