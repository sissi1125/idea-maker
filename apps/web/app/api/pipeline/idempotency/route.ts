/**
 * RAG Pipeline Stage 1 - 文档幂等性检查 (Document Idempotency) - 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/idempotency.ts，本文件只负责：
 *   1. 解析请求 + 校验 pipelineRun.selectedDocumentId
 *   2. 从 docStore 加载 targetDoc + otherDocs（I/O 注入）
 *   3. 调 checkIdempotency
 *   4. 包装 trace.durationMs，翻译 PipelineError 为 HTTP envelope
 *
 * 详见 packages/rag-core/README.md 「提取模式」段。
 */

import { NextRequest, NextResponse } from "next/server";
import { checkIdempotency, isPipelineError } from "@harness/rag-core";
import {
  IdempotencyMethodId,
  IdempotencyParamsSchema,
} from "@harness/shared-types";
import { getDocument, listDocuments } from "@/lib/docStore";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { methodId: rawMethodId, params: rawParams, pipelineRun } = body as {
      methodId: string;
      params: Record<string, unknown>;
      pipelineRun: { selectedDocumentId: string | null };
    };

    if (!pipelineRun?.selectedDocumentId) {
      return NextResponse.json(
        { error: { code: "missing_document", message: "未选择文档，请先在文档库选择一个文档版本" } },
        { status: 400 },
      );
    }

    const targetDoc = getDocument(pipelineRun.selectedDocumentId);
    if (!targetDoc) {
      return NextResponse.json(
        {
          error: {
            code: "document_not_found",
            message: `文档 ${pipelineRun.selectedDocumentId} 不存在`,
          },
        },
        { status: 404 },
      );
    }

    const methodId = IdempotencyMethodId.parse(rawMethodId);
    const params = IdempotencyParamsSchema.parse(rawParams ?? {});
    const otherDocs = listDocuments().filter((d) => d.id !== targetDoc.id);

    const result = checkIdempotency({ methodId, params, targetDoc, otherDocs });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    });
  } catch (err) {
    if (isPipelineError(err)) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, ...(err.details ?? {}) } },
        { status: err.code === "document_not_found" ? 404 : 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "internal_error", message: String(err) } },
      { status: 500 },
    );
  }
}
