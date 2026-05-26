/**
 * TransformController — POST /pipeline/transform
 * 纯算法，零注入。复刻 apps/web/app/api/pipeline/transform/route.ts。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runTransform, PipelineError } from "@harness/rag-core";
import {
  TransformMethodId,
  TransformParamsSchema,
  type TransformInputChunk,
} from "@harness/shared-types";

interface UpstreamChunkOutput {
  chunks: TransformInputChunk[];
  chunkCount: number;
  warnings: string[];
}

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  upstreamOutput: UpstreamChunkOutput | null;
}

@ApiTags("pipeline")
@Controller("pipeline/transform")
export class TransformController {
  @Post()
  @HttpCode(200)
  run(@Body() body: RequestBody) {
    const startedAt = Date.now();
    if (!body.upstreamOutput?.chunks?.length) {
      throw new PipelineError("empty_chunks", "未找到分块输出，请先运行分块 Stage");
    }
    const methodId = TransformMethodId.parse(body.methodId);
    const params = TransformParamsSchema.parse(body.params ?? {});

    const result = runTransform({ methodId, params, upstreamChunks: body.upstreamOutput.chunks });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    };
  }
}
