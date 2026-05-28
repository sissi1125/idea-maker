/**
 * RetrievalController — POST /pipeline/retrieval
 *
 * pipeline 之王：三类 client 注入（pg / openai / tei）。
 * 复刻 apps/web/app/api/pipeline/retrieval/route.ts。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runRetrieval, PipelineError } from "@harness/rag-core";
import {
  RetrievalMethodId,
  RetrievalParamsSchema,
  type OpenAICompatibleClient,
  type QueryRewriteOutput,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RetrievalRequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: QueryRewriteOutput | null;
  /**
   * feat-200.8.x P0：必填——retrieval 严格按 project_id 隔离
   * Playground UI / 旧客户端不传时默认 'legacy-playground'
   */
  projectId?: string;
}

@ApiTags("pipeline")
@Controller("pipeline/retrieval")
export class RetrievalController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RetrievalRequestBody) {
    const startMs = Date.now();

    if (!body.upstreamOutput) {
      throw new PipelineError(
        "empty_queries",
        "缺少上游 Query Rewrite 产物，请先运行 Query Rewrite Stage",
      );
    }
    const queries = body.upstreamOutput.rewrittenQueries;
    if (!queries?.length) {
      throw new PipelineError("empty_queries", "上游未产出任何查询");
    }

    const methodId = RetrievalMethodId.parse(body.methodId);
    const params = RetrievalParamsSchema.parse(body.params);

    // 按 embeddingProvider 决定要注入哪种 embedding client
    const needsEmbedding =
      methodId === "dense-vector" ||
      methodId === "hybrid-rrf" ||
      methodId === "hybrid-bm25-rrf";

    let openaiClient: OpenAICompatibleClient | undefined;
    if (needsEmbedding && params.embeddingProvider === "openai") {
      openaiClient = this.providers.createEmbeddingClient(params.apiKey, params.baseUrl).client;
    }
    const hfTeiEndpoint = this.providers.resolveTeiEndpoint(params.teiEndpoint);

    const db = this.providers.createPgClient(params.connectionString);
    try {
      await db.connect();

      const result = await runRetrieval({
        methodId,
        params,
        queries,
        pgClient: db,
        // 不传则降级到 'legacy-playground'——保留 Playground UI 向后兼容
        projectId: body.projectId?.trim() || "legacy-playground",
        openaiClient,
        hfTeiEndpoint,
      });

      return {
        output: result.output,
        trace: { ...result.trace, durationMs: Date.now() - startMs },
        durationMs: Date.now() - startMs,
        warnings: result.warnings,
      };
    } catch (err) {
      // 把 pg 连接错误翻成 PipelineError，让全局 filter 统一处理
      const unwrapped =
        err instanceof AggregateError ? (err.errors?.[0] ?? err) : err;
      const msg = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
      if (msg.includes("ECONNREFUSED")) {
        throw new PipelineError("provider_error", `数据库连接被拒绝: ${msg}`);
      }
      if (msg.includes("does not exist")) {
        throw new PipelineError("provider_error", `数据库对象不存在: ${msg}`);
      }
      throw err;
    } finally {
      await db.end().catch(() => {});
    }
  }
}
