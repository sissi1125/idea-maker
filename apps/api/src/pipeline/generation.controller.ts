/**
 * GenerationController — POST /pipeline/generation
 *
 * 复刻 apps/web/app/api/pipeline/generation/route.ts。
 * 4 个 LLM method 都需要 LLM client + defaultModel。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runGeneration, PipelineError } from "@harness/rag-core";
import {
  GenerationMethodId,
  GenerationParamsSchema,
  type PromptBuildOutput,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface GenerationRequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: PromptBuildOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/generation")
export class GenerationController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: GenerationRequestBody) {
    const startMs = Date.now();

    if (!body.upstreamOutput) {
      throw new PipelineError(
        "empty_prompt",
        "缺少上游 Prompt Build 产物，请先运行 Prompt Build Stage",
      );
    }

    const methodId = GenerationMethodId.parse(body.methodId);
    const params = GenerationParamsSchema.parse(body.params);

    const { client: llmClient, defaultModel } = this.providers.createLLMClient(
      params.apiKey,
      params.baseUrl,
    );

    const result = await runGeneration({
      methodId,
      params,
      upstream: body.upstreamOutput,
      llmClient,
      defaultModel,
    });

    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
