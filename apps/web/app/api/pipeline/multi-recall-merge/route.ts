/**
 * Multi-Recall Merge - 薄路由
 *
 * 算法本体在 @harness/rag-core/retrieval/multi-recall-merge.ts。
 */

import { NextRequest, NextResponse } from "next/server";
import { runMultiRecallMerge } from "@harness/rag-core";
import {
  MultiRecallMergeMethodId,
  MultiRecallMergeParamsSchema,
  type MatchedChunk,
  type RetrievalOutput,
} from "@harness/shared-types";

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: RetrievalOutput | null;
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
      { error: { code: "missing_upstream", message: "缺少上游 Retrieval 产物，请先运行 Retrieval Stage" } },
      { status: 400 },
    );
  }

  try {
    const methodId = MultiRecallMergeMethodId.parse(body.methodId);
    const params = MultiRecallMergeParamsSchema.parse(body.params);
    const additionalMatches = Array.isArray(params.additionalMatches)
      ? (params.additionalMatches as MatchedChunk[])
      : undefined;

    const result = runMultiRecallMerge({
      methodId,
      params,
      upstream: body.upstreamOutput,
      additionalMatches,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "merge_failed", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}
