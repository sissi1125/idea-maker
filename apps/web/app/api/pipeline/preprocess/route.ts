/**
 * RAG Pipeline Stage 2 - 文档预处理 (Preprocess) - 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/preprocess.ts，本文件只负责：
 *   1. 解析请求 + 校验 pipelineRun.selectedDocumentId
 *   2. 从 docStore 加载 doc + buffer（I/O 注入）
 *   3. 从 env 读 PYMUPDF_SERVICE_URL 注入到 rag-core
 *   4. 调 runPreprocess
 *   5. 包装 trace.durationMs，翻译 PipelineError 为 HTTP envelope
 */

import { NextRequest, NextResponse } from "next/server";
import { runPreprocess, isPipelineError } from "@harness/rag-core";
import {
  PreprocessMethodId,
  PreprocessParamsSchema,
} from "@harness/shared-types";
import { getDocument, getDocumentBuffer } from "@/lib/docStore";

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
        { error: { code: "missing_document", message: "未选择文档" } },
        { status: 400 },
      );
    }

    const doc = getDocument(pipelineRun.selectedDocumentId);
    if (!doc) {
      return NextResponse.json(
        { error: { code: "document_not_found", message: "文档不存在" } },
        { status: 404 },
      );
    }

    const methodId = PreprocessMethodId.parse(rawMethodId);
    const params = PreprocessParamsSchema.parse(rawParams ?? {});
    const buffer = getDocumentBuffer(doc);

    const result = await runPreprocess({
      methodId,
      params,
      doc: {
        rawContent: doc.rawContent,
        buffer,
        mimeType: doc.mimeType,
        isBinary: doc.isBinary,
        fileName: doc.fileName,
      },
      pymupdfServiceUrl: process.env.PYMUPDF_SERVICE_URL,
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
        { status: err.code === "document_not_found" ? 404 : 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "internal_error", message: String(err) } },
      { status: 500 },
    );
  }
}
