/**
 * MultiRecallMergeController — POST /pipeline/multi-recall-merge
 * 纯算法。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runMultiRecallMerge, PipelineError } from "@harness/rag-core";
import {
  MultiRecallMergeMethodId,
  MultiRecallMergeParamsSchema,
  type MatchedChunk,
  type RetrievalOutput,
} from "@harness/shared-types";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown> & { additionalMatches?: MatchedChunk[] };
  upstreamOutput: RetrievalOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/multi-recall-merge")
export class MultiRecallMergeController {
  @Post()
  @HttpCode(200)
  run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_queries", "缺少上游 Retrieval 产物，请先运行 Retrieval Stage");
    }
    const methodId = MultiRecallMergeMethodId.parse(body.methodId);
    const params = MultiRecallMergeParamsSchema.parse(body.params);
    const additionalMatches = Array.isArray(params.additionalMatches)
      ? (params.additionalMatches as MatchedChunk[])
      : undefined;

    const result = runMultiRecallMerge({
      methodId,
      params,
      upstream: body.upstreamOutput,
      additionalMatches,
    });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
