/**
 * IntentRecognitionController — POST /pipeline/intent-recognition
 * 注入：LLMChatClient（仅 llm-router）。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runIntentRecognition } from "@harness/rag-core";
import {
  IntentRecognitionMethodId,
  IntentRecognitionParamsSchema,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput?: { query?: string };
}

@ApiTags("pipeline")
@Controller("pipeline/intent-recognition")
export class IntentRecognitionController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    const methodId = IntentRecognitionMethodId.parse(body.methodId);
    const params = IntentRecognitionParamsSchema.parse(body.params);

    let llmClient: LLMChatClient | undefined;
    if (methodId === "llm-router") {
      llmClient = this.providers.createLLMClient(params.apiKey, params.baseUrl).client;
    }

    const result = await runIntentRecognition({
      methodId,
      params,
      upstreamQuery: body.upstreamOutput?.query,
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
