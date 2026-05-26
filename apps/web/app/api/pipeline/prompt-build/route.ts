/**
 * Prompt Build - 薄路由
 *
 * 算法本体在 @harness/rag-core/generation/prompt-build.ts。
 */

import { NextRequest, NextResponse } from "next/server";
import { runPromptBuild, isPipelineError } from "@harness/rag-core";
import {
  PromptBuildMethodId,
  PromptBuildParamsSchema,
  type CitationOutput,
} from "@harness/shared-types";

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: CitationOutput | null;
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
      { error: { code: "missing_upstream", message: "缺少上游 Citation 产物，请先运行 Citation Stage" } },
      { status: 400 },
    );
  }

  try {
    const methodId = PromptBuildMethodId.parse(body.methodId);
    const params = PromptBuildParamsSchema.parse(body.params);

    const result = runPromptBuild({ methodId, params, upstream: body.upstreamOutput });

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
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "prompt_build_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
