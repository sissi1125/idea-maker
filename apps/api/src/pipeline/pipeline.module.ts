/**
 * PipelineModule — RAG pipeline 算法端点的 NestJS 模块（Wave 3+4 全 18 stage）。
 *
 * 依赖：DocumentsModule（idempotency / preprocess 需要 DocStoreService）。
 * 导出：ProvidersService（snapshots 模块的 pg 连接也走这里）。
 */

import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { DocumentsModule } from "../documents/documents.module";

import { ChunkController } from "./chunk.controller";
import { EmbeddingController } from "./embedding.controller";
import { RetrievalController } from "./retrieval.controller";
import { GenerationController } from "./generation.controller";

import { IdempotencyController } from "./idempotency.controller";
import { PreprocessController } from "./preprocess.controller";
import { TransformController } from "./transform.controller";
import { QueryRewriteController } from "./query-rewrite.controller";
import { IntentRecognitionController } from "./intent-recognition.controller";
import { MultiRecallMergeController } from "./multi-recall-merge.controller";
import { FilterController } from "./filter.controller";
import { RerankController } from "./rerank.controller";
import { StorageController } from "./storage.controller";
import { CitationController } from "./citation.controller";
import { FallbackController } from "./fallback.controller";
import { ContextManagementController } from "./context-management.controller";
import { PromptBuildController } from "./prompt-build.controller";
import { EvaluationController } from "./evaluation.controller";

@Module({
  imports: [DocumentsModule],
  providers: [ProvidersService],
  exports: [ProvidersService], // SnapshotsModule 复用
  controllers: [
    // Wave 3
    ChunkController,
    EmbeddingController,
    RetrievalController,
    GenerationController,
    // Wave 4
    IdempotencyController,
    PreprocessController,
    TransformController,
    QueryRewriteController,
    IntentRecognitionController,
    MultiRecallMergeController,
    FilterController,
    RerankController,
    StorageController,
    CitationController,
    FallbackController,
    ContextManagementController,
    PromptBuildController,
    EvaluationController,
  ],
})
export class PipelineModule {}
