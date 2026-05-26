/**
 * Retrieval - 薄路由（pipeline 之王）
 *
 * 算法本体在 @harness/rag-core/retrieval/retrieval.ts。
 * 三类 client 注入：
 *   - pg.Client：所有 method 必传（路由层 new Client + connect + finally end）
 *   - openaiClient：embeddingProvider=openai 时创建
 *   - hfTeiEndpoint：embeddingProvider=hf-tei 时从 env 读
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { runRetrieval, isPipelineError } from "@harness/rag-core";
import {
  RetrievalMethodId,
  RetrievalParamsSchema,
  type OpenAICompatibleClient,
  type QueryRewriteOutput,
} from "@harness/shared-types";
import { createEmbeddingClient } from "@/lib/providers";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_queries: 400,
  missing_client: 500,
  missing_endpoint: 400,
  provider_error: 502,
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: {
    methodId: string;
    params: Record<string, unknown>;
    upstreamOutput: QueryRewriteOutput | null;
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
          message: "缺少上游 Query Rewrite 产物，请先运行 Query Rewrite Stage",
        },
      },
      { status: 400 },
    );
  }

  const queries = body.upstreamOutput.rewrittenQueries;
  if (!queries || queries.length === 0) {
    return NextResponse.json(
      { error: { code: "empty_queries", message: "上游未产出任何查询" } },
      { status: 400 },
    );
  }

  let methodId, params;
  try {
    methodId = RetrievalMethodId.parse(body.methodId);
    params = RetrievalParamsSchema.parse(body.params);
  } catch (err) {
    return NextResponse.json(
      { error: { code: "invalid_params", message: err instanceof Error ? err.message : String(err) } },
      { status: 400 },
    );
  }

  const connectionString = params.connectionString?.trim() || process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json(
      {
        error: {
          code: "missing_connection",
          message: "缺少数据库连接串：请在表单填写或设置 DATABASE_URL 环境变量",
        },
      },
      { status: 400 },
    );
  }

  // 按 embeddingProvider 决定要注入哪种 embedding client
  const needsEmbedding =
    methodId === "dense-vector" || methodId === "hybrid-rrf" || methodId === "hybrid-bm25-rrf";

  let openaiClient: OpenAICompatibleClient | undefined;
  if (needsEmbedding && params.embeddingProvider === "openai") {
    try {
      const { client } = await createEmbeddingClient(params.apiKey, params.baseUrl);
      openaiClient = client;
    } catch (err) {
      return NextResponse.json(
        { error: { code: "missing_client", message: err instanceof Error ? err.message : String(err) } },
        { status: 500 },
      );
    }
  }
  // hf-tei 优先用 params.teiEndpoint，否则读 env
  const hfTeiEndpoint = params.teiEndpoint?.trim() || process.env.HF_TEI_ENDPOINT;

  const db = new Client({ connectionString });
  try {
    await db.connect();

    const result = await runRetrieval({
      methodId,
      params,
      queries,
      pgClient: db,
      openaiClient,
      hfTeiEndpoint,
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

    // pg / 其他错误
    const unwrapped = err instanceof AggregateError ? (err.errors?.[0] ?? err) : err;
    const msg = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
    const code = msg.includes("ECONNREFUSED")
      ? "db_connection_refused"
      : msg.includes("does not exist")
        ? "db_not_found"
        : "retrieval_failed";
    return NextResponse.json({ error: { code, message: msg } }, { status: 500 });
  } finally {
    await db.end().catch(() => {});
  }
}
