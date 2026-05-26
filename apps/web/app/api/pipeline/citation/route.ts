/**
 * Citation - 薄路由
 *
 * 算法本体在 @harness/rag-core/retrieval/citation.ts。
 * section-citation 需要 pg.Client 注入：路由层从 env/params 解析 connectionString，
 * new Client + connect + try/finally end()。
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { runCitation, isPipelineError } from "@harness/rag-core";
import {
  CitationMethodId,
  CitationParamsSchema,
  type RerankOutput,
} from "@harness/shared-types";
import { resolveConnectionString, unwrapError } from "@/lib/snapshotDb";

const PIPELINE_ERROR_STATUS: Record<string, number> = {
  empty_matches: 400,
  missing_client: 500,
};

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

  let methodId, params;
  try {
    methodId = CitationMethodId.parse(body.methodId);
    params = CitationParamsSchema.parse(body.params);
  } catch (err) {
    return NextResponse.json(
      { error: { code: "invalid_params", message: err instanceof Error ? err.message : String(err) } },
      { status: 400 },
    );
  }

  // section-citation 需要 pg.Client：路由层解析 connectionString + connect
  let pgClient: Client | undefined;
  if (methodId === "section-citation") {
    const connectionString = resolveConnectionString(params.connectionString);
    if (!connectionString) {
      return NextResponse.json(
        {
          error: {
            code: "missing_connection",
            message: "section-citation 需要数据库连接：请在表单填写 connectionString 或设置 DATABASE_URL 环境变量",
          },
        },
        { status: 400 },
      );
    }
    pgClient = new Client({ connectionString });
    await pgClient.connect();
  }

  try {
    const result = await runCitation({
      methodId,
      params,
      upstreamMatches: body.upstreamOutput.rankedMatches ?? [],
      originalQuery: body.upstreamOutput.originalQuery,
      pgClient,
    });

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
        { status: PIPELINE_ERROR_STATUS[err.code] ?? 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "citation_failed", message: unwrapError(err) } },
      { status: 500 },
    );
  } finally {
    if (pgClient) await pgClient.end().catch(() => {});
  }
}
