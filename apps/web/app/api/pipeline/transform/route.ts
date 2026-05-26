/**
 * RAG Pipeline Stage 4 - Chunk Transform - 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/transform.ts。
 * 本文件只负责解析请求 + 校验上游 chunks + 包装 trace 和错误。
 */

import { NextRequest, NextResponse } from "next/server";
import { runTransform, isPipelineError } from "@harness/rag-core";
import {
  TransformMethodId,
  TransformParamsSchema,
  type TransformInputChunk,
} from "@harness/shared-types";

interface UpstreamChunkOutput {
  chunks: TransformInputChunk[];
  chunkCount: number;
  warnings: string[];
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId: rawMethodId, params: rawParams, upstreamOutput } = body as {
      methodId: string;
      params: Record<string, unknown>;
      upstreamOutput: UpstreamChunkOutput | null;
    };

    if (!upstreamOutput?.chunks?.length) {
      return NextResponse.json(
        { error: { code: "missing_upstream", message: "未找到分块输出，请先运行分块 Stage" } },
        { status: 400 },
      );
    }

    const methodId = TransformMethodId.parse(rawMethodId);
    const params = TransformParamsSchema.parse(rawParams ?? {});

    const result = runTransform({
      methodId,
      params,
      upstreamChunks: upstreamOutput.chunks,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
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
      { error: { code: "internal_error", message: String(err) } },
      { status: 500 },
    );
  }
}
