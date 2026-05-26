/**
 * PromptBuildController — POST /pipeline/prompt-build
 * 纯算法。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runPromptBuild, PipelineError } from "@harness/rag-core";
import {
  PromptBuildMethodId,
  PromptBuildParamsSchema,
  type CitationOutput,
} from "@harness/shared-types";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: CitationOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/prompt-build")
export class PromptBuildController {
  @Post()
  @HttpCode(200)
  run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_prompt", "缺少上游 Citation 产物，请先运行 Citation Stage");
    }
    const methodId = PromptBuildMethodId.parse(body.methodId);
    const params = PromptBuildParamsSchema.parse(body.params);

    const result = runPromptBuild({ methodId, params, upstream: body.upstreamOutput });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
