/**
 * QueryRewriteController — POST /pipeline/query-rewrite
 *
 * 注入：LLMChatClient（仅 llm-marketing-rewrite）。
 * 注：原 Next.js route 里把算法直接 inline 了；本 controller 改为调 rag-core 的 runQueryRewrite。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runQueryRewrite, PipelineError } from "@harness/rag-core";
import {
  QueryRewriteMethodId,
  QueryRewriteParamsSchema,
  type LLMChatClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
}

@ApiTags("pipeline")
@Controller("pipeline/query-rewrite")
export class QueryRewriteController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    const methodId = QueryRewriteMethodId.parse(body.methodId);
    const params = QueryRewriteParamsSchema.parse(body.params);

    if (!params.query?.trim()) {
      throw new PipelineError("empty_query", "查询不能为空，请在表单中填写 query 字段");
    }

    let llmClient: LLMChatClient | undefined;
    if (methodId === "llm-marketing-rewrite") {
      llmClient = this.providers.createLLMClient(params.apiKey, params.baseUrl).client;
    }

    const result = await runQueryRewrite({ methodId, params, llmClient });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
