/**
 * RAG Pipeline Stage 3 - 文档分块 (Chunk) - 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/chunk.ts。
 * 路由只负责：解析请求 + 校验上游 preprocess 输出 + 包装 trace 和错误。
 */

import { NextRequest, NextResponse } from "next/server";
import { runChunk, isPipelineError } from "@harness/rag-core";
import {
  ChunkMethodId,
  ChunkParamsSchema,
  type ChunkSourceRef,
} from "@harness/shared-types";

interface UpstreamPreprocessOutput {
  cleanText: string;
  sourceRefs?: ChunkSourceRef[];
  metadata?: { fileName?: string };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId: rawMethodId, params: rawParams, upstreamOutput } = body as {
      methodId: string;
      params: Record<string, unknown>;
      upstreamOutput: UpstreamPreprocessOutput | null;
    };

    if (!upstreamOutput?.cleanText) {
      return NextResponse.json(
        { error: { code: "missing_upstream", message: "未找到预处理输出，请先运行预处理 Stage" } },
        { status: 400 },
      );
    }

    const methodId = ChunkMethodId.parse(rawMethodId);
    const params = ChunkParamsSchema.parse(rawParams ?? {});

    const result = runChunk({
      methodId,
      params,
      upstream: {
        cleanText: upstreamOutput.cleanText,
        sourceRefs: upstreamOutput.sourceRefs ?? [],
        fileName: upstreamOutput.metadata?.fileName ?? "",
      },
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    });
  } catch (err) {
    if (isPipelineError(err)) {
      // empty_text 是业务上的"无内容"，给 400 更合适
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
