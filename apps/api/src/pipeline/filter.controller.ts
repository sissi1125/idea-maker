/**
 * FilterController — POST /pipeline/filter
 * 纯算法。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runFilter, PipelineError } from "@harness/rag-core";
import { FilterMethodId, FilterParamsSchema, type RetrievalOutput } from "@harness/shared-types";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: RetrievalOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/filter")
export class FilterController {
  @Post()
  @HttpCode(200)
  run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_queries", "缺少上游 Retrieval 产物，请先运行 Retrieval Stage");
    }
    const methodId = FilterMethodId.parse(body.methodId);
    const params = FilterParamsSchema.parse(body.params);

    const result = runFilter({
      methodId,
      params,
      upstreamMatches: body.upstreamOutput.matches ?? [],
      originalQuery: body.upstreamOutput.originalQuery ?? "",
      upstreamWarnings: body.upstreamOutput.warnings,
    });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
