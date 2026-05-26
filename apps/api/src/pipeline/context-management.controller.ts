/**
 * ContextManagementController — POST /pipeline/context-management
 * llm-disambiguate 需要 LLM。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runContextManagement } from "@harness/rag-core";
import {
  ContextManagementMethodId,
  ContextManagementParamsSchema,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
}

@ApiTags("pipeline")
@Controller("pipeline/context-management")
export class ContextManagementController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    const methodId = ContextManagementMethodId.parse(body.methodId);
    const params = ContextManagementParamsSchema.parse(body.params);

    let llmClient: LLMChatClient | undefined;
    if (methodId === "llm-disambiguate") {
      llmClient = this.providers.createLLMClient(params.apiKey, params.baseUrl).client;
    }

    const result = await runContextManagement({ methodId, params, llmClient });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
