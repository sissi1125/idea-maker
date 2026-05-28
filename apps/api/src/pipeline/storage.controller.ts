/**
 * StorageController — POST /pipeline/storage
 * pg.Client 注入。lifecycle 由 Controller 管理（connect + finally end）。
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { runStorage, PipelineError } from "@harness/rag-core";
import {
  StorageMethodId,
  StorageParamsSchema,
  type EmbeddedChunk,
} from "@harness/shared-types";
import { ProvidersService } from "./providers.service";

interface UpstreamEmbeddingOutput {
  chunks: EmbeddedChunk[];
  dimension: number;
}

interface RequestBody {
  methodId: string;
  params: Record<string, unknown>;
  pipelineRun: { selectedDocumentId?: string };
  upstreamOutput: UpstreamEmbeddingOutput | null;
  /**
   * feat-200.8.x P0：必填——chunk 严格写入指定 project 隔离区
   * 不传时默认 'legacy-playground'，保留 Playground UI 向后兼容
   */
  projectId?: string;
}

@ApiTags("pipeline")
@Controller("pipeline/storage")
export class StorageController {
  constructor(private readonly providers: ProvidersService) {}

  @Post()
  @HttpCode(200)
  async run(@Body() body: RequestBody) {
    const startMs = Date.now();
    if (!body.upstreamOutput?.chunks?.length) {
      throw new PipelineError(
        "empty_chunks",
        "缺少上游 Embedding 产物，请先成功运行 Embedding Stage",
      );
    }
    const methodId = StorageMethodId.parse(body.methodId);
    const params = StorageParamsSchema.parse(body.params ?? {});

    const db = this.providers.createPgClient(params.connectionString);
    const documentId = body.pipelineRun?.selectedDocumentId ?? "unknown-doc";

    try {
      await db.connect();
      const result = await runStorage({
        methodId,
        params,
        upstreamChunks: body.upstreamOutput.chunks,
        dimension: body.upstreamOutput.dimension,
        documentId,
        projectId: body.projectId?.trim() || "legacy-playground",
        pgClient: db,
      });
      return {
        output: result.output,
        trace: { ...result.trace, durationMs: Date.now() - startMs },
        durationMs: Date.now() - startMs,
        warnings: result.warnings,
      };
    } catch (err) {
      // 翻译 pg 底层错误码到 PipelineError，让全局 filter 兜底处理
      const unwrapped =
        err instanceof AggregateError && err.errors?.length > 0 ? err.errors[0] : err;
      const pgErr = unwrapped as Record<string, unknown>;
      const message =
        typeof pgErr?.message === "string" && pgErr.message ? pgErr.message : String(unwrapped);
      const errno = typeof pgErr?.code === "string" ? pgErr.code : "";

      if (errno === "ECONNREFUSED" || message.includes("ECONNREFUSED")) {
        throw new PipelineError("provider_error", `数据库连接被拒绝: ${message}`);
      }
      if (errno === "28P01" || message.includes("password authentication")) {
        throw new PipelineError("api_auth_failed", `数据库认证失败: ${message}`);
      }
      if (errno === "3D000" || message.includes("does not exist")) {
        throw new PipelineError("provider_error", `数据库对象不存在: ${message}`);
      }
      throw err;
    } finally {
      await db.end().catch(() => {});
    }
  }
}
