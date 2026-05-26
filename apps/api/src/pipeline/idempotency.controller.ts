/**
 * IdempotencyController — POST /pipeline/idempotency
 *
 * 复刻 apps/web/app/api/pipeline/idempotency/route.ts。
 * I/O 注入：DocStoreService.get + list（targetDoc / otherDocs）。
 */

import { Body, Controller, HttpCode, NotFoundException, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { checkIdempotency, PipelineError } from "@harness/rag-core";
import { IdempotencyMethodId, IdempotencyParamsSchema } from "@harness/shared-types";
import { DocStoreService } from "../documents/doc-store.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  pipelineRun: { selectedDocumentId: string | null };
}

@ApiTags("pipeline")
@Controller("pipeline/idempotency")
export class IdempotencyController {
  constructor(private readonly store: DocStoreService) {}

  @Post()
  @HttpCode(200)
  run(@Body() body: RequestBody) {
    const startedAt = Date.now();
    if (!body.pipelineRun?.selectedDocumentId) {
      throw new PipelineError("missing_document", "未选择文档，请先在文档库选择一个文档版本");
    }
    const targetDoc = this.store.get(body.pipelineRun.selectedDocumentId);
    if (!targetDoc) {
      throw new NotFoundException(`文档 ${body.pipelineRun.selectedDocumentId} 不存在`);
    }
    const methodId = IdempotencyMethodId.parse(body.methodId);
    const params = IdempotencyParamsSchema.parse(body.params ?? {});
    const otherDocs = this.store.list().filter((d) => d.id !== targetDoc.id);

    const result = checkIdempotency({ methodId, params, targetDoc, otherDocs });
    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    };
  }
}
