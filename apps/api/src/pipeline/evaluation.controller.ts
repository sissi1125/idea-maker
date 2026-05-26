/**
 * EvaluationController — POST /pipeline/evaluation
 * rag-metrics-with-faithfulness 需要 LLM；缺则降级（rag-core 处理）。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runEvaluation } from "@harness/rag-core";
import {
  EvaluationMethodId,
  EvaluationParamsSchema,
  type EvaluationUpstream,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: EvaluationUpstream | null;
  evidencePackMissing?: boolean;
}

@ApiTags("pipeline")
@Controller("pipeline/evaluation")
export class EvaluationController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    const methodId = EvaluationMethodId.parse(body.methodId);
    const params = EvaluationParamsSchema.parse(body.params);

    let llmClient: LLMChatClient | undefined;
    let defaultModel: string | undefined;
    if (methodId === "rag-metrics-with-faithfulness") {
      try {
        const cfg = this.providers.createLLMClient(params.apiKey, params.baseUrl);
        llmClient = cfg.client;
        defaultModel = cfg.defaultModel;
      } catch {
        // 缺 LLM → rag-core 降级到纯算法
      }
    }

    const result = await runEvaluation({
      methodId,
      params,
      upstream: body.upstreamOutput ?? ({} as EvaluationUpstream),
      llmClient,
      defaultModel,
      evidencePackMissing: body.evidencePackMissing,
    });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
