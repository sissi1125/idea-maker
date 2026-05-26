/**
 * ChunkController — POST /pipeline/chunk
 *
 * 镜像 apps/web/app/api/pipeline/chunk/route.ts 的行为。
 * 算法本体在 @harness/rag-core/ingestion/chunk.ts。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runChunk, PipelineError } from "@harness/rag-core";
import {
  ChunkMethodId,
  ChunkParamsSchema,
  type ChunkSourceRef,
} from "@harness/shared-types";

interface UpstreamPreprocessOutput {
  cleanText: string;
  sourceRefs?: ChunkSourceRef[];
  metadata?: { fileName?: string };
}

interface ChunkRequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: UpstreamPreprocessOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/chunk")
export class ChunkController {
  @Post()
  @HttpCode(200)
  async run(@Body() body: ChunkRequestBody) {
    const startedAt = Date.now();

    if (!body.upstreamOutput?.cleanText) {
      throw new PipelineError(
        "empty_text",
        "未找到预处理输出，请先运行预处理 Stage",
      );
    }

    const methodId = ChunkMethodId.parse(body.methodId);
    const params = ChunkParamsSchema.parse(body.params ?? {});

    const result = runChunk({
      methodId,
      params,
      upstream: {
        cleanText: body.upstreamOutput.cleanText,
        sourceRefs: body.upstreamOutput.sourceRefs ?? [],
        fileName: body.upstreamOutput.metadata?.fileName ?? "",
      },
    });

    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    };
  }
}
