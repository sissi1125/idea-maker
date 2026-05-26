/**
 * PreprocessController — POST /pipeline/preprocess
 *
 * 复刻 apps/web/app/api/pipeline/preprocess/route.ts。
 * 注入：DocStoreService（取 doc + buffer）+ env PYMUPDF_SERVICE_URL。
 */

import { Body, Controller, HttpCode, NotFoundException, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runPreprocess, PipelineError } from "@harness/rag-core";
import { PreprocessMethodId, PreprocessParamsSchema } from "@harness/shared-types";
import { DocStoreService } from "../documents/doc-store.service";

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  pipelineRun: { selectedDocumentId: string | null };
}

@ApiTags("pipeline")
@Controller("pipeline/preprocess")
export class PreprocessController {
  constructor(private readonly store: DocStoreService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startedAt = Date.now();
    if (!body.pipelineRun?.selectedDocumentId) {
      throw new PipelineError("missing_document", "未选择文档");
    }
    const doc = this.store.get(body.pipelineRun.selectedDocumentId);
    if (!doc) throw new NotFoundException("文档不存在");

    const methodId = PreprocessMethodId.parse(body.methodId);
    const params = PreprocessParamsSchema.parse(body.params ?? {});
    const buffer = this.store.getBuffer(doc);

    const result = await runPreprocess({
      methodId,
      params,
      doc: {
        rawContent: doc.rawContent,
        buffer,
        mimeType: doc.mimeType,
        isBinary: doc.isBinary,
        fileName: doc.fileName,
      },
      pymupdfServiceUrl: process.env.PYMUPDF_SERVICE_URL,
    });

    return {
      output: result.output,
      trace: { ...result.trace, durationMs: Date.now() - startedAt },
      warnings: result.warnings,
    };
  }
}
