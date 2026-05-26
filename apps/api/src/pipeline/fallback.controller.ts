/**
 * FallbackController — POST /pipeline/fallback
 * generic-response 需要 LLM；失败时静默降级（rag-core 处理 undefined）。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runFallback, PipelineError } from "@harness/rag-core";
import {
  FallbackMethodId,
  FallbackParamsSchema,
  type RerankOutput,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: RerankOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/fallback")
export class FallbackController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_queries", "缺少上游 Rerank 产物，请先运行 Rerank Stage");
    }
    const methodId = FallbackMethodId.parse(body.methodId);
    const params = FallbackParamsSchema.parse(body.params);

    let llmClient: LLMChatClient | undefined;
    if (methodId === "generic-response") {
      try {
        llmClient = this.providers.createLLMClient(params.apiKey, params.baseUrl).client;
      } catch {
        // 缺 env / key → 不阻塞；rag-core 会优雅降级（fallback 语义特性）
      }
    }

    const result = await runFallback({
      methodId,
      params,
      upstream: body.upstreamOutput,
      llmClient,
    });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
