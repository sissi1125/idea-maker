/**
 * RerankController — POST /pipeline/rerank
 * 双注入：LLMChatClient（llm-relevance-rerank）+ TEI endpoint（hf-tei-rerank / pipeline-rerank）。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runRerank, PipelineError } from "@harness/rag-core";
import {
  RerankMethodId,
  RerankParamsSchema,
  type FilterOutput,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: FilterOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/rerank")
export class RerankController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput) {
      throw new PipelineError("empty_queries", "缺少上游 Filter 产物，请先运行 Filter Stage");
    }
    const methodId = RerankMethodId.parse(body.methodId);
    const params = RerankParamsSchema.parse(body.params);

    let llmClient: LLMChatClient | undefined;
    if (methodId === "llm-relevance-rerank") {
      llmClient = this.providers.createLLMClient(params.apiKey, params.baseUrl).client;
    }
    const hfTeiEndpoint = this.providers.resolveTeiEndpoint();

    const result = await runRerank({
      methodId,
      params,
      upstreamMatches: body.upstreamOutput.filteredMatches ?? [],
      upstreamQuery: body.upstreamOutput.originalQuery,
      hfTeiEndpoint,
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
