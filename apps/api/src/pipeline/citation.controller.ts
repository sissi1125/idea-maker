/**
 * CitationController — POST /pipeline/citation
 * section-citation 需要 pg.Client；其他 method 纯算法。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runCitation, PipelineError } from "@harness/rag-core";
import {
  CitationMethodId,
  CitationParamsSchema,
  type RerankOutput,
} from "@harness/shared-types";
import type { Client as PgClient } from "pg";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: RerankOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/citation")
export class CitationController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_queries", "缺少上游 Rerank 产物，请先运行 Rerank Stage");
    }
    const methodId = CitationMethodId.parse(body.methodId);
    const params = CitationParamsSchema.parse(body.params);

    let pgClient: PgClient | undefined;
    if (methodId === "section-citation") {
      pgClient = this.providers.createPgClient(params.connectionString);
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
      return {
        output: result.output,
        trace: { ...result.trace, durationMs: Date.now() - startMs },
        durationMs: Date.now() - startMs,
        warnings: result.warnings,
      };
    } finally {
      if (pgClient) await pgClient.end().catch(() => {});
    }
  }
}
