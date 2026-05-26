/**
 * RAG Pipeline Stage 6 - Storage - 薄路由
 *
 * 算法本体在 @harness/rag-core/ingestion/storage.ts。
 * 路由职责：
 *   1. 解析请求 + 校验上游 embedding 输出
 *   2. 解析 connectionString（params 表单 / DATABASE_URL env）
 *   3. 创建 pg.Client、connect()，注入到 rag-core
 *   4. finally end()
 *   5. PipelineError code → HTTP status 映射；pg 错误码额外解释
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { runStorage, isPipelineError } from "@harness/rag-core";
import {
  StorageMethodId,
  StorageParamsSchema,
  type EmbeddedChunk,
} from "@harness/shared-types";

interface UpstreamEmbeddingOutput {
  chunks: EmbeddedChunk[];
  dimension: number;
}

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_chunks: 400,
  missing_client: 500, // 路由层 bug 才会出现；用户视角是 500
  dimension_mismatch: 409,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    pipelineRun: { selectedDocumentId?: string };
    upstreamOutput: UpstreamEmbeddingOutput | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }

  const { methodId: rawMethodId, params: rawParams, pipelineRun, upstreamOutput } = body;

  if (!upstreamOutput?.chunks?.length) {
    return NextResponse.json(
      {
        error: {
          code: "missing_upstream",
          message: "缺少上游 Embedding 产物，请先成功运行 Embedding Stage",
        },
      },
      { status: 400 },
    );
  }

  let methodId, params;
  try {
    methodId = StorageMethodId.parse(rawMethodId);
    params = StorageParamsSchema.parse(rawParams ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "invalid_params", message } },
      { status: 400 },
    );
  }

  const connectionString =
    (params.connectionString?.trim()) || process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json(
      {
        error: {
          code: "missing_connection",
          message:
            "缺少数据库连接串：请在表单 \"数据库连接串\" 字段中填写，或设置 DATABASE_URL 环境变量",
        },
      },
      { status: 400 },
    );
  }

  const documentId = pipelineRun?.selectedDocumentId ?? "unknown-doc";
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const result = await runStorage({
      methodId,
      params,
      upstreamChunks: upstreamOutput.chunks,
      dimension: upstreamOutput.dimension,
      documentId,
      pgClient: client,
    });

    return NextResponse.json({
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    });
  } catch (err) {
    // PipelineError：rag-core 自检失败
    if (isPipelineError(err)) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, ...(err.details ?? {}) } },
        { status: PIPELINE_ERROR_STATUS[err.code] ?? 500 },
      );
    }

    // pg 错误：解析 errno + message 给出语义化 code
    // Node 18+ 的 AggregateError 包含多个底层错误，取第一个有意义的 message
    const unwrapped =
      err instanceof AggregateError && err.errors?.length > 0 ? err.errors[0] : err;
    const pgErr = unwrapped as Record<string, unknown>;
    const message =
      typeof pgErr?.message === "string" && pgErr.message
        ? pgErr.message
        : typeof pgErr?.toString === "function"
          ? pgErr.toString()
          : "未知错误";
    const errno = typeof pgErr?.code === "string" ? pgErr.code : "";

    let code = "storage_failed";
    if (errno === "ECONNREFUSED" || message.includes("ECONNREFUSED")) code = "db_connection_refused";
    else if (errno === "23505" || message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate")) code = "unique_violation";
    else if (errno === "28P01" || message.includes("password authentication")) code = "db_auth_failed";
    else if (errno === "3D000" || message.includes("does not exist")) code = "db_not_found";

    return NextResponse.json({ error: { code, message } }, { status: 500 });
  } finally {
    // lifecycle 由路由层管理（symmetric to connect）
    await client.end().catch(() => {});
  }
}
