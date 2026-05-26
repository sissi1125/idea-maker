/**
 * EmbeddingController — POST /pipeline/embedding
 *
 * 复刻 apps/web/app/api/pipeline/embedding/route.ts。
 * openai-3-small 需要 openaiClient；hf-tei-embedding 需要 hfTeiEndpoint。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runEmbedding, PipelineError } from "@harness/rag-core";
import {
  EmbeddingMethodId,
  EmbeddingParamsSchema,
  type EmbeddingInputChunk,
  type OpenAICompatibleClient,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface UpstreamOutput {
  chunks: EmbeddingInputChunk[];
}

interface EmbeddingRequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: UpstreamOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/embedding")
export class EmbeddingController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: EmbeddingRequestBody) {
    const startMs = Date.now();

    if (!body.upstreamOutput?.chunks?.length) {
      throw new PipelineError(
        "empty_chunks",
        "缺少上游 chunk/transform 产物，请先成功运行上游 Stage",
      );
    }

    const methodId = EmbeddingMethodId.parse(body.methodId);
    const params = EmbeddingParamsSchema.parse(body.params ?? {});

    // openai-3-small：路由层创建 client 注入
    let openaiClient: OpenAICompatibleClient | undefined;
    if (methodId === "openai-3-small") {
      openaiClient = this.providers.createEmbeddingClient(params.apiKey, params.baseUrl).client;
    }

    const hfTeiEndpoint = this.providers.resolveTeiEndpoint();

    const result = await runEmbedding({
      methodId,
      params,
      upstreamChunks: body.upstreamOutput.chunks,
      openaiClient,
      hfTeiEndpoint,
    });

    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startMs },
      durationMs: Date.now() - startMs,
      warnings: result.warnings,
    };
  }
}
